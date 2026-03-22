import { describe, it, expect, vi } from "vitest";
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import type { ProjectRow, ChallengeRow } from "../../src/types";
import {
  assertProjectOwner,
  assertChallengeOwner,
} from "../../src/services/authorization";

// ---------------------------------------------------------------------------
// D1 mock helpers
// ---------------------------------------------------------------------------

function makePreparedStatement(opts: {
  firstResult?: unknown;
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
  };

  (stmt as unknown as { bind: ReturnType<typeof vi.fn> }).bind.mockReturnValue(stmt);

  if (opts.error) {
    (stmt as unknown as { first: ReturnType<typeof vi.fn> }).first.mockRejectedValue(opts.error);
  } else {
    (stmt as unknown as { first: ReturnType<typeof vi.fn> }).first.mockResolvedValue(opts.firstResult ?? null);
  }

  return stmt;
}

function makeDb(
  prepareImpl: (sql: string) => D1PreparedStatement,
): D1Database {
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

const PROJECT_ROW: ProjectRow = {
  id: 1,
  user_id: 10,
  title: "テストプロジェクト",
  year: 2026,
  month: 3,
  status: "draft",
  is_inbox: 0,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

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
// assertProjectOwner
// ---------------------------------------------------------------------------

describe("assertProjectOwner", () => {
  it("returns the project when the user is the owner", async () => {
    const db = makeDb(() =>
      makePreparedStatement({ firstResult: PROJECT_ROW }),
    );

    const result = await assertProjectOwner(db, 1, 10);

    expect(result).toEqual(PROJECT_ROW);
  });

  it("throws PROJECT_NOT_FOUND (404) when project does not exist", async () => {
    const db = makeDb(() =>
      makePreparedStatement({ firstResult: null }),
    );

    await expect(assertProjectOwner(db, 999, 10)).rejects.toMatchObject({
      code: "PROJECT_NOT_FOUND",
      status: 404,
    });
  });

  it("throws FORBIDDEN (403) when the user does not own the project", async () => {
    const db = makeDb(() =>
      makePreparedStatement({ firstResult: PROJECT_ROW }), // project owned by user_id=10
    );

    await expect(assertProjectOwner(db, 1, 99)).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    });
  });
});

// ---------------------------------------------------------------------------
// assertChallengeOwner
// ---------------------------------------------------------------------------

describe("assertChallengeOwner", () => {
  it("returns the challenge when the user is the owner", async () => {
    const joinedRow = { ...CHALLENGE_ROW, project_user_id: 10 };

    const db = makeDb(() =>
      makePreparedStatement({ firstResult: joinedRow }),
    );

    const result = await assertChallengeOwner(db, 100, 10);

    expect(result.id).toBe(CHALLENGE_ROW.id);
    expect(result.name).toBe(CHALLENGE_ROW.name);
    // The joined field should not appear on the returned ChallengeRow
    expect((result as unknown as Record<string, unknown>)["project_user_id"]).toBeUndefined();
  });

  it("throws CHALLENGE_NOT_FOUND (404) when challenge does not exist", async () => {
    const db = makeDb(() =>
      makePreparedStatement({ firstResult: null }),
    );

    await expect(assertChallengeOwner(db, 999, 10)).rejects.toMatchObject({
      code: "CHALLENGE_NOT_FOUND",
      status: 404,
    });
  });

  it("throws FORBIDDEN (403) when the user does not own the challenge", async () => {
    const joinedRow = { ...CHALLENGE_ROW, project_user_id: 10 };

    const db = makeDb(() =>
      makePreparedStatement({ firstResult: joinedRow }),
    );

    await expect(assertChallengeOwner(db, 100, 99)).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    });
  });
});
