import { describe, it, expect, vi, beforeEach } from "vitest";
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import type { UserRow, UserPreferencesRow } from "../../src/types";
import {
  lazyProvision,
  findUserBySlackId,
  updatePreferences,
} from "../../src/services/user";

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
  };

  // bind() returns the same statement (chaining)
  (stmt as unknown as { bind: ReturnType<typeof vi.fn> }).bind.mockReturnValue(stmt);

  if (opts.error) {
    (stmt as unknown as { first: ReturnType<typeof vi.fn> }).first.mockRejectedValue(opts.error);
    (stmt as unknown as { run: ReturnType<typeof vi.fn> }).run.mockRejectedValue(opts.error);
  } else {
    (stmt as unknown as { first: ReturnType<typeof vi.fn> }).first.mockResolvedValue(opts.firstResult ?? null);
    (stmt as unknown as { run: ReturnType<typeof vi.fn> }).run.mockResolvedValue(
      opts.runResult ?? { success: true, meta: { last_row_id: 1 }, results: [] },
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

const USER_ROW: UserRow = {
  id: 1,
  slack_user_id: "U123",
  user_name: "taro",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const PREFS_ROW: UserPreferencesRow = {
  id: 1,
  user_id: 1,
  markdown_mode: 0,
  personal_reminder: 0,
  viewed_year: null,
  viewed_month: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

// ---------------------------------------------------------------------------
// lazyProvision
// ---------------------------------------------------------------------------

describe("lazyProvision", () => {
  it("returns wasCreated=true when user does not exist", async () => {
    let callCount = 0;
    const db = makeDb((sql) => {
      if (sql.startsWith("SELECT * FROM users WHERE slack_user_id")) {
        callCount++;
        // First call returns null (user not found); should not be called again in happy path
        return makePreparedStatement({ firstResult: null });
      }
      if (sql.startsWith("INSERT INTO users")) {
        return makePreparedStatement({
          runResult: { success: true, meta: { last_row_id: 42 }, results: [] },
        });
      }
      if (sql.startsWith("INSERT INTO user_preferences")) {
        return makePreparedStatement({
          runResult: { success: true, meta: { last_row_id: 1 }, results: [] },
        });
      }
      if (sql.startsWith("SELECT * FROM users WHERE id")) {
        return makePreparedStatement({ firstResult: { ...USER_ROW, id: 42 } });
      }
      if (sql.startsWith("SELECT * FROM user_preferences WHERE user_id")) {
        return makePreparedStatement({ firstResult: { ...PREFS_ROW, user_id: 42 } });
      }
      return makePreparedStatement({});
    });

    const result = await lazyProvision(db, "U123", "taro");

    expect(result.wasCreated).toBe(true);
    expect(result.user.slack_user_id).toBe("U123");
    expect(result.preferences.user_id).toBe(42);
  });

  it("returns wasCreated=false when user already exists", async () => {
    const db = makeDb((sql) => {
      if (sql.startsWith("SELECT * FROM users WHERE slack_user_id")) {
        return makePreparedStatement({ firstResult: USER_ROW });
      }
      if (sql.startsWith("SELECT * FROM user_preferences WHERE user_id")) {
        return makePreparedStatement({ firstResult: PREFS_ROW });
      }
      return makePreparedStatement({});
    });

    const result = await lazyProvision(db, "U123", "taro");

    expect(result.wasCreated).toBe(false);
    expect(result.user).toEqual(USER_ROW);
    expect(result.preferences).toEqual(PREFS_ROW);
  });

  it("handles UNIQUE constraint race condition gracefully", async () => {
    const uniqueError = new Error("UNIQUE constraint failed: users.slack_user_id");

    let selectCount = 0;
    const db = makeDb((sql) => {
      if (sql.startsWith("SELECT * FROM users WHERE slack_user_id")) {
        selectCount++;
        if (selectCount === 1) {
          // First check: user not found (triggering insert attempt)
          return makePreparedStatement({ firstResult: null });
        }
        // Retry after UNIQUE violation: returns existing user
        return makePreparedStatement({ firstResult: USER_ROW });
      }
      if (sql.startsWith("INSERT INTO users")) {
        return makePreparedStatement({ error: uniqueError });
      }
      if (sql.startsWith("SELECT * FROM user_preferences WHERE user_id")) {
        return makePreparedStatement({ firstResult: PREFS_ROW });
      }
      return makePreparedStatement({});
    });

    const result = await lazyProvision(db, "U123", "taro");

    expect(result.wasCreated).toBe(false);
    expect(result.user).toEqual(USER_ROW);
  });

  it("uses slackUserId as fallback when userName is empty", async () => {
    let capturedUserName: string | undefined;

    const db = makeDb((sql) => {
      if (sql.startsWith("SELECT * FROM users WHERE slack_user_id")) {
        return makePreparedStatement({ firstResult: null });
      }
      if (sql.startsWith("INSERT INTO users")) {
        const stmt = makePreparedStatement({
          runResult: { success: true, meta: { last_row_id: 10 }, results: [] },
        });
        const originalBind = (stmt as unknown as { bind: ReturnType<typeof vi.fn> }).bind;
        originalBind.mockImplementation((_slackId: string, name: string) => {
          capturedUserName = name;
          return stmt;
        });
        return stmt;
      }
      if (sql.startsWith("INSERT INTO user_preferences")) {
        return makePreparedStatement({
          runResult: { success: true, meta: { last_row_id: 1 }, results: [] },
        });
      }
      if (sql.startsWith("SELECT * FROM users WHERE id")) {
        return makePreparedStatement({
          firstResult: { ...USER_ROW, id: 10, user_name: "U_EMPTY" },
        });
      }
      if (sql.startsWith("SELECT * FROM user_preferences WHERE user_id")) {
        return makePreparedStatement({ firstResult: { ...PREFS_ROW, user_id: 10 } });
      }
      return makePreparedStatement({});
    });

    await lazyProvision(db, "U_EMPTY", "");

    expect(capturedUserName).toBe("U_EMPTY");
  });

  it("truncates userName longer than 255 characters", async () => {
    const longName = "a".repeat(300);
    let capturedUserName: string | undefined;

    const db = makeDb((sql) => {
      if (sql.startsWith("SELECT * FROM users WHERE slack_user_id")) {
        return makePreparedStatement({ firstResult: null });
      }
      if (sql.startsWith("INSERT INTO users")) {
        const stmt = makePreparedStatement({
          runResult: { success: true, meta: { last_row_id: 5 }, results: [] },
        });
        const originalBind = (stmt as unknown as { bind: ReturnType<typeof vi.fn> }).bind;
        originalBind.mockImplementation((_slackId: string, name: string) => {
          capturedUserName = name;
          return stmt;
        });
        return stmt;
      }
      if (sql.startsWith("INSERT INTO user_preferences")) {
        return makePreparedStatement({
          runResult: { success: true, meta: { last_row_id: 1 }, results: [] },
        });
      }
      if (sql.startsWith("SELECT * FROM users WHERE id")) {
        return makePreparedStatement({ firstResult: { ...USER_ROW, id: 5 } });
      }
      if (sql.startsWith("SELECT * FROM user_preferences WHERE user_id")) {
        return makePreparedStatement({ firstResult: { ...PREFS_ROW, user_id: 5 } });
      }
      return makePreparedStatement({});
    });

    await lazyProvision(db, "U123", longName);

    expect(capturedUserName).toHaveLength(255);
  });
});

// ---------------------------------------------------------------------------
// findUserBySlackId
// ---------------------------------------------------------------------------

describe("findUserBySlackId", () => {
  it("returns user when found", async () => {
    const db = makeDb(() =>
      makePreparedStatement({ firstResult: USER_ROW }),
    );

    const result = await findUserBySlackId(db, "U123");

    expect(result).toEqual(USER_ROW);
  });

  it("returns null when user not found", async () => {
    const db = makeDb(() =>
      makePreparedStatement({ firstResult: null }),
    );

    const result = await findUserBySlackId(db, "U_NOTFOUND");

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// updatePreferences
// ---------------------------------------------------------------------------

describe("updatePreferences", () => {
  it("updates only the provided fields", async () => {
    let capturedSql: string | undefined;
    let capturedValues: unknown[] | undefined;

    const db = makeDb((sql) => {
      if (sql.startsWith("UPDATE")) {
        capturedSql = sql;
        const stmt = {
          bind: vi.fn(),
          run: vi.fn().mockResolvedValue({ success: true, meta: {}, results: [] }),
          first: vi.fn(),
          all: vi.fn(),
          raw: vi.fn(),
        } as unknown as D1PreparedStatement;
        (stmt as unknown as { bind: ReturnType<typeof vi.fn> }).bind.mockImplementation((...args: unknown[]) => {
          capturedValues = args;
          return stmt;
        });
        return stmt;
      }
      if (sql.startsWith("SELECT * FROM user_preferences WHERE user_id")) {
        return makePreparedStatement({
          firstResult: { ...PREFS_ROW, markdown_mode: 1 },
        });
      }
      return makePreparedStatement({});
    });

    const result = await updatePreferences(db, 1, { markdown_mode: true });

    expect(capturedSql).toContain("markdown_mode = ?");
    expect(capturedSql).not.toContain("personal_reminder");
    expect(capturedValues).toContain(1); // true → 1
    expect(result.markdown_mode).toBe(1);
  });

  it("converts boolean true to 1 and false to 0 for SQLite", async () => {
    let capturedValues: unknown[] | undefined;

    const db = makeDb((sql) => {
      if (sql.startsWith("UPDATE")) {
        const stmt = {
          bind: vi.fn(),
          run: vi.fn().mockResolvedValue({ success: true, meta: {}, results: [] }),
          first: vi.fn(),
          all: vi.fn(),
          raw: vi.fn(),
        } as unknown as D1PreparedStatement;
        (stmt as unknown as { bind: ReturnType<typeof vi.fn> }).bind.mockImplementation((...args: unknown[]) => {
          capturedValues = args;
          return stmt;
        });
        return stmt;
      }
      if (sql.startsWith("SELECT * FROM user_preferences WHERE user_id")) {
        return makePreparedStatement({
          firstResult: { ...PREFS_ROW, markdown_mode: 0, personal_reminder: 0 },
        });
      }
      return makePreparedStatement({});
    });

    await updatePreferences(db, 1, { markdown_mode: true, personal_reminder: false });

    expect(capturedValues).toContain(1); // markdown_mode: true → 1
    expect(capturedValues).toContain(0); // personal_reminder: false → 0
  });
});
