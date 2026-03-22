import type {
  D1Database,
  D1PreparedStatement,
} from "@cloudflare/workers-types";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { usersRouter } from "../../src/routes/users";
import type {
  Env,
  HonoEnv,
  UserPreferencesRow,
  UserRow,
} from "../../src/types";

// ---------------------------------------------------------------------------
// D1 mock helpers
// ---------------------------------------------------------------------------

function makePreparedStatement(opts: {
  firstResult?: unknown;
  runResult?: {
    success: boolean;
    meta: { last_row_id: number };
    results: unknown[];
  };
}): D1PreparedStatement {
  const stmt = {
    bind: vi.fn(),
    first: vi.fn().mockResolvedValue(opts.firstResult ?? null),
    run: vi.fn().mockResolvedValue(
      opts.runResult ?? {
        success: true,
        meta: { last_row_id: 1 },
        results: [],
      },
    ),
    all: vi.fn(),
    raw: vi.fn(),
  } as unknown as D1PreparedStatement;

  (stmt as unknown as { bind: ReturnType<typeof vi.fn> }).bind.mockReturnValue(
    stmt,
  );

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
// Test app factory
// ---------------------------------------------------------------------------

function makeTestApp(_db: D1Database) {
  const app = new Hono<HonoEnv>();
  app.route("/users", usersRouter);
  return app;
}

function makeEnv(db: D1Database): Env {
  return {
    DB: db,
    SLACK_SIGNING_SECRET: "x",
    SLACK_BOT_TOKEN: "x",
    SLACK_POST_CHANNEL_ID: "x",
  };
}

// ---------------------------------------------------------------------------
// GET /users/:slack_user_id
// ---------------------------------------------------------------------------

describe("GET /users/:slack_user_id", () => {
  it("returns 200 with user data (no id field)", async () => {
    const db = makeDb(() => makePreparedStatement({ firstResult: USER_ROW }));
    const app = makeTestApp(db);
    const env = makeEnv(db);

    const res = await app.request("/users/U123", {}, env);

    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.slack_user_id).toBe("U123");
    expect(data.user_name).toBe("taro");
    expect(data.created_at).toBe("2026-01-01T00:00:00Z");
    expect(data).not.toHaveProperty("id");
  });

  it("returns 404 for a nonexistent user", async () => {
    const db = makeDb(() => makePreparedStatement({ firstResult: null }));
    const app = makeTestApp(db);
    const env = makeEnv(db);

    const res = await app.request("/users/U_UNKNOWN", {}, env);

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// PATCH /users/:slack_user_id/preferences
// ---------------------------------------------------------------------------

describe("PATCH /users/:slack_user_id/preferences", () => {
  it("returns 200 with updated preferences as booleans", async () => {
    const updatedPrefs: UserPreferencesRow = {
      ...PREFS_ROW,
      markdown_mode: 1,
      personal_reminder: 0,
    };

    const db = makeDb((sql) => {
      if (sql.startsWith("SELECT * FROM users WHERE slack_user_id")) {
        return makePreparedStatement({ firstResult: USER_ROW });
      }
      if (sql.startsWith("UPDATE")) {
        return makePreparedStatement({
          runResult: { success: true, meta: { last_row_id: 1 }, results: [] },
        });
      }
      if (sql.startsWith("SELECT * FROM user_preferences WHERE user_id")) {
        return makePreparedStatement({ firstResult: updatedPrefs });
      }
      return makePreparedStatement({});
    });
    const app = makeTestApp(db);
    const env = makeEnv(db);

    const res = await app.request(
      "/users/U123/preferences",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markdown_mode: true }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.markdown_mode).toBe(true);
    expect(data.personal_reminder).toBe(false);
    expect(data.viewed_year).toBeNull();
    expect(data.viewed_month).toBeNull();
  });

  it("returns 404 for a nonexistent user", async () => {
    const db = makeDb(() => makePreparedStatement({ firstResult: null }));
    const app = makeTestApp(db);
    const env = makeEnv(db);

    const res = await app.request(
      "/users/U_UNKNOWN/preferences",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markdown_mode: true }),
      },
      env,
    );

    expect(res.status).toBe(404);
  });
});
