import type {
  D1Database,
  D1PreparedStatement,
} from "@cloudflare/workers-types";
import { describe, expect, it, vi } from "vitest";
import {
  countChallenges,
  createChallenge,
  updateChallenge,
} from "../../src/services/challenge";
import type { ChallengeRow } from "../../src/types";
import { AppError } from "../../src/types";

// ---------------------------------------------------------------------------
// D1 mock helpers
// ---------------------------------------------------------------------------

type D1RunResult = {
  success: boolean;
  meta: { last_row_id: number };
  results: unknown[];
};

function makePreparedStatement(opts: {
  firstResult?: unknown;
  allResult?: { results: unknown[] };
  runResult?: D1RunResult;
  error?: Error;
}): D1PreparedStatement {
  const stmt = {
    bind: vi.fn(),
    first: vi.fn(),
    run: vi.fn(),
    all: vi.fn(),
    raw: vi.fn(),
  } as unknown as D1PreparedStatement & {
    bind: ReturnType<typeof vi.fn>;
    first: ReturnType<typeof vi.fn>;
    run: ReturnType<typeof vi.fn>;
    all: ReturnType<typeof vi.fn>;
  };

  (stmt as unknown as { bind: ReturnType<typeof vi.fn> }).bind.mockReturnValue(
    stmt,
  );

  if (opts.error) {
    (
      stmt as unknown as { first: ReturnType<typeof vi.fn> }
    ).first.mockRejectedValue(opts.error);
    (
      stmt as unknown as { run: ReturnType<typeof vi.fn> }
    ).run.mockRejectedValue(opts.error);
    (
      stmt as unknown as { all: ReturnType<typeof vi.fn> }
    ).all.mockRejectedValue(opts.error);
  } else {
    (
      stmt as unknown as { first: ReturnType<typeof vi.fn> }
    ).first.mockResolvedValue(opts.firstResult ?? null);
    (
      stmt as unknown as { run: ReturnType<typeof vi.fn> }
    ).run.mockResolvedValue(
      opts.runResult ?? {
        success: true,
        meta: { last_row_id: 1 },
        results: [],
      },
    );
    (
      stmt as unknown as { all: ReturnType<typeof vi.fn> }
    ).all.mockResolvedValue(opts.allResult ?? { results: [] });
  }

  return stmt;
}

function makeDb(prepareImpl: (sql: string) => D1PreparedStatement): D1Database {
  return {
    prepare: vi.fn().mockImplementation(prepareImpl),
    exec: vi.fn(),
    batch: vi.fn(),
    dump: vi.fn(),
  } as unknown as D1Database;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CHALLENGE_ROW: ChallengeRow = {
  id: 100,
  project_id: 1,
  name: "テストチャレンジ",
  status: "draft",
  due_on: null,
  progress_comment: null,
  review_comment: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

// ---------------------------------------------------------------------------
// countChallenges
// ---------------------------------------------------------------------------

describe("countChallenges", () => {
  it("returns the correct count", async () => {
    const db = makeDb(() =>
      makePreparedStatement({ firstResult: { count: 7 } }),
    );

    const result = await countChallenges(db, 1);

    expect(result).toBe(7);
  });

  it("returns 0 when no challenges exist", async () => {
    const db = makeDb(() =>
      makePreparedStatement({ firstResult: { count: 0 } }),
    );

    const result = await countChallenges(db, 1);

    expect(result).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// createChallenge
// ---------------------------------------------------------------------------

describe("createChallenge", () => {
  it("creates a challenge with valid input", async () => {
    const db = makeDb((sql) => {
      if (sql.includes("COUNT(*)")) {
        return makePreparedStatement({ firstResult: { count: 0 } });
      }
      if (sql.startsWith("INSERT INTO challenges")) {
        return makePreparedStatement({
          runResult: { success: true, meta: { last_row_id: 100 }, results: [] },
        });
      }
      if (sql.startsWith("SELECT * FROM challenges WHERE id")) {
        return makePreparedStatement({ firstResult: CHALLENGE_ROW });
      }
      return makePreparedStatement({});
    });

    const result = await createChallenge(db, {
      project_id: 1,
      name: "テストチャレンジ",
    });

    expect(result).toEqual(CHALLENGE_ROW);
  });

  it("throws CHALLENGE_LIMIT_EXCEEDED when project already has 20 challenges", async () => {
    const db = makeDb((sql) => {
      if (sql.includes("COUNT(*)")) {
        return makePreparedStatement({ firstResult: { count: 20 } });
      }
      return makePreparedStatement({});
    });

    await expect(
      createChallenge(db, { project_id: 1, name: "21個目" }),
    ).rejects.toMatchObject({ code: "CHALLENGE_LIMIT_EXCEEDED", status: 409 });
  });

  it("throws when name exceeds 200 characters", async () => {
    const db = makeDb((sql) => {
      if (sql.includes("COUNT(*)")) {
        return makePreparedStatement({ firstResult: { count: 0 } });
      }
      return makePreparedStatement({});
    });

    const longName = "あ".repeat(201);

    await expect(
      createChallenge(db, { project_id: 1, name: longName }),
    ).rejects.toThrow(AppError);
  });
});

// ---------------------------------------------------------------------------
// updateChallenge
// ---------------------------------------------------------------------------

describe("updateChallenge", () => {
  it("partially updates only provided fields", async () => {
    let capturedSql: string | undefined;

    const db = makeDb((sql) => {
      if (sql.startsWith("UPDATE challenges")) {
        capturedSql = sql;
        return makePreparedStatement({
          runResult: { success: true, meta: { last_row_id: 100 }, results: [] },
        });
      }
      if (sql.startsWith("SELECT * FROM challenges WHERE id")) {
        return makePreparedStatement({
          firstResult: { ...CHALLENGE_ROW, name: "更新後" },
        });
      }
      return makePreparedStatement({});
    });

    const result = await updateChallenge(db, 100, { name: "更新後" });

    expect(capturedSql).toContain("name = ?");
    expect(capturedSql).not.toContain("due_on");
    expect(result.name).toBe("更新後");
  });

  it("updates due_on when provided", async () => {
    let capturedSql: string | undefined;

    const db = makeDb((sql) => {
      if (sql.startsWith("UPDATE challenges")) {
        capturedSql = sql;
        return makePreparedStatement({
          runResult: { success: true, meta: { last_row_id: 100 }, results: [] },
        });
      }
      if (sql.startsWith("SELECT * FROM challenges WHERE id")) {
        return makePreparedStatement({
          firstResult: { ...CHALLENGE_ROW, due_on: "2026-03-31" },
        });
      }
      return makePreparedStatement({});
    });

    const result = await updateChallenge(db, 100, { due_on: "2026-03-31" });

    expect(capturedSql).toContain("due_on = ?");
    expect(result.due_on).toBe("2026-03-31");
  });
});
