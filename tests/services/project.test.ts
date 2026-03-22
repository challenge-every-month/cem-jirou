import { describe, it, expect, vi } from "vitest";
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import type { ProjectRow, ChallengeRow } from "../../src/types";
import { AppError } from "../../src/types";
import {
  getProjectsWithChallenges,
  createProject,
  getOrCreateInboxProject,
  updateProject,
  deleteProject,
} from "../../src/services/project";

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

  (stmt as unknown as { bind: ReturnType<typeof vi.fn> }).bind.mockReturnValue(stmt);

  if (opts.error) {
    (stmt as unknown as { first: ReturnType<typeof vi.fn> }).first.mockRejectedValue(opts.error);
    (stmt as unknown as { run: ReturnType<typeof vi.fn> }).run.mockRejectedValue(opts.error);
    (stmt as unknown as { all: ReturnType<typeof vi.fn> }).all.mockRejectedValue(opts.error);
  } else {
    (stmt as unknown as { first: ReturnType<typeof vi.fn> }).first.mockResolvedValue(opts.firstResult ?? null);
    (stmt as unknown as { run: ReturnType<typeof vi.fn> }).run.mockResolvedValue(
      opts.runResult ?? { success: true, meta: { last_row_id: 1 }, results: [] },
    );
    (stmt as unknown as { all: ReturnType<typeof vi.fn> }).all.mockResolvedValue(
      opts.allResult ?? { results: [] },
    );
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
// createProject
// ---------------------------------------------------------------------------

describe("createProject", () => {
  it("creates a project with valid input", async () => {
    const db = makeDb((sql) => {
      if (sql.startsWith("INSERT INTO projects")) {
        return makePreparedStatement({
          runResult: { success: true, meta: { last_row_id: 1 }, results: [] },
        });
      }
      if (sql.startsWith("SELECT * FROM projects WHERE id")) {
        return makePreparedStatement({ firstResult: PROJECT_ROW });
      }
      return makePreparedStatement({});
    });

    const result = await createProject(db, {
      user_id: 10,
      title: "テストプロジェクト",
      year: 2026,
      month: 3,
    });

    expect(result).toEqual(PROJECT_ROW);
  });

  it("throws INVALID_YEAR_MONTH when year < 2020", async () => {
    const db = makeDb(() => makePreparedStatement({}));

    await expect(
      createProject(db, {
        user_id: 10,
        title: "古いプロジェクト",
        year: 2019,
        month: 3,
      }),
    ).rejects.toThrow(AppError);

    await expect(
      createProject(db, {
        user_id: 10,
        title: "古いプロジェクト",
        year: 2019,
        month: 3,
      }),
    ).rejects.toMatchObject({ code: "INVALID_YEAR_MONTH", status: 400 });
  });

  it("throws INVALID_YEAR_MONTH when month is 13", async () => {
    const db = makeDb(() => makePreparedStatement({}));

    await expect(
      createProject(db, {
        user_id: 10,
        title: "無効な月",
        year: 2026,
        month: 13,
      }),
    ).rejects.toMatchObject({ code: "INVALID_YEAR_MONTH", status: 400 });
  });

  it("throws when title exceeds 100 characters", async () => {
    const db = makeDb(() => makePreparedStatement({}));
    const longTitle = "あ".repeat(101);

    await expect(
      createProject(db, {
        user_id: 10,
        title: longTitle,
        year: 2026,
        month: 3,
      }),
    ).rejects.toThrow(AppError);
  });
});

// ---------------------------------------------------------------------------
// getOrCreateInboxProject
// ---------------------------------------------------------------------------

describe("getOrCreateInboxProject", () => {
  it("creates an inbox project when none exists", async () => {
    const inboxRow: ProjectRow = {
      ...PROJECT_ROW,
      id: 99,
      title: "その他",
      is_inbox: 1,
    };

    const db = makeDb((sql) => {
      if (
        sql.includes("is_inbox = 1") ||
        sql.includes("is_inbox=1")
      ) {
        return makePreparedStatement({ firstResult: null });
      }
      if (sql.startsWith("INSERT INTO projects")) {
        return makePreparedStatement({
          runResult: { success: true, meta: { last_row_id: 99 }, results: [] },
        });
      }
      if (sql.startsWith("SELECT * FROM projects WHERE id")) {
        return makePreparedStatement({ firstResult: inboxRow });
      }
      return makePreparedStatement({});
    });

    const result = await getOrCreateInboxProject(db, 10, 2026, 3);

    expect(result.title).toBe("その他");
    expect(result.is_inbox).toBe(1);
  });

  it("returns the existing inbox project without creating a duplicate", async () => {
    const inboxRow: ProjectRow = {
      ...PROJECT_ROW,
      id: 5,
      title: "その他",
      is_inbox: 1,
    };

    let insertCalled = false;
    const db = makeDb((sql) => {
      if (sql.includes("is_inbox = 1")) {
        return makePreparedStatement({ firstResult: inboxRow });
      }
      if (sql.startsWith("INSERT INTO projects")) {
        insertCalled = true;
        return makePreparedStatement({
          runResult: { success: true, meta: { last_row_id: 999 }, results: [] },
        });
      }
      return makePreparedStatement({});
    });

    const result = await getOrCreateInboxProject(db, 10, 2026, 3);

    expect(result).toEqual(inboxRow);
    expect(insertCalled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// updateProject
// ---------------------------------------------------------------------------

describe("updateProject", () => {
  it("throws PROJECT_ALREADY_REVIEWED when project status is reviewed", async () => {
    const reviewedProject: ProjectRow = { ...PROJECT_ROW, status: "reviewed" };

    const db = makeDb((sql) => {
      if (sql.startsWith("SELECT * FROM projects WHERE id")) {
        return makePreparedStatement({ firstResult: reviewedProject });
      }
      return makePreparedStatement({});
    });

    await expect(
      updateProject(db, 1, { title: "新しいタイトル" }),
    ).rejects.toMatchObject({ code: "PROJECT_ALREADY_REVIEWED", status: 409 });
  });

  it("updates a draft project successfully", async () => {
    const updatedRow: ProjectRow = { ...PROJECT_ROW, title: "更新後タイトル" };
    let selectCallCount = 0;

    const db = makeDb((sql) => {
      if (sql.startsWith("SELECT * FROM projects WHERE id")) {
        selectCallCount++;
        // First SELECT: return original (for status check)
        // Second SELECT: return updated row (after UPDATE)
        return makePreparedStatement({
          firstResult: selectCallCount === 1 ? PROJECT_ROW : updatedRow,
        });
      }
      if (sql.startsWith("UPDATE projects")) {
        return makePreparedStatement({
          runResult: { success: true, meta: { last_row_id: 1 }, results: [] },
        });
      }
      return makePreparedStatement({});
    });

    const result = await updateProject(db, 1, { title: "更新後タイトル" });

    expect(result.title).toBe("更新後タイトル");
  });
});

// ---------------------------------------------------------------------------
// getProjectsWithChallenges
// ---------------------------------------------------------------------------

describe("getProjectsWithChallenges", () => {
  it("returns projects with nested challenges", async () => {
    const db = makeDb((sql) => {
      if (sql.startsWith("SELECT * FROM projects WHERE user_id")) {
        return makePreparedStatement({
          allResult: { results: [PROJECT_ROW] },
        });
      }
      if (sql.includes("FROM challenges WHERE project_id")) {
        return makePreparedStatement({
          allResult: { results: [CHALLENGE_ROW] },
        });
      }
      return makePreparedStatement({});
    });

    const result = await getProjectsWithChallenges(db, 10, 2026, 3);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
    expect(result[0].challenges).toHaveLength(1);
    expect(result[0].challenges[0].name).toBe("テストチャレンジ");
  });

  it("returns empty array when no projects exist", async () => {
    const db = makeDb((sql) => {
      if (sql.startsWith("SELECT * FROM projects WHERE user_id")) {
        return makePreparedStatement({ allResult: { results: [] } });
      }
      return makePreparedStatement({});
    });

    const result = await getProjectsWithChallenges(db, 10, 2026, 3);

    expect(result).toHaveLength(0);
  });

  it("returns projects with empty challenges array when no challenges exist", async () => {
    const db = makeDb((sql) => {
      if (sql.startsWith("SELECT * FROM projects WHERE user_id")) {
        return makePreparedStatement({
          allResult: { results: [PROJECT_ROW] },
        });
      }
      if (sql.includes("FROM challenges WHERE project_id")) {
        return makePreparedStatement({ allResult: { results: [] } });
      }
      return makePreparedStatement({});
    });

    const result = await getProjectsWithChallenges(db, 10, 2026, 3);

    expect(result).toHaveLength(1);
    expect(result[0].challenges).toHaveLength(0);
  });
});
