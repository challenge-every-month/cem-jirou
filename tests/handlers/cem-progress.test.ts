import type {
  D1Database,
  D1PreparedStatement,
} from "@cloudflare/workers-types";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  handleCemProgress,
  handleProgressSubmit,
} from "../../src/handlers/commands/cem-progress";
import type {
  ChallengeRow,
  Env,
  ProjectRow,
  SlackInteractionPayload,
  UserPreferencesRow,
  UserRow,
} from "../../src/types";

// ─── Mock slack-api ──────────────────────────────────────────────────────────

vi.mock("../../src/utils/slack-api", () => ({
  openModal: vi.fn().mockResolvedValue(undefined),
  publishHome: vi.fn().mockResolvedValue(undefined),
  postMessage: vi.fn().mockResolvedValue(undefined),
  postEphemeral: vi.fn().mockResolvedValue(undefined),
  postDm: vi.fn().mockResolvedValue(undefined),
  slackPost: vi.fn().mockResolvedValue({ ok: true }),
}));

import { openModal, postEphemeral } from "../../src/utils/slack-api";

// ─── D1 mock helpers ─────────────────────────────────────────────────────────

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

// ─── Fixtures ────────────────────────────────────────────────────────────────

const USER_ROW: UserRow = {
  id: 1,
  slack_user_id: "U123",
  user_name: "testuser",
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

const PUBLISHED_PROJECT: ProjectRow = {
  id: 10,
  user_id: 1,
  title: "英語学習",
  year: 2026,
  month: 3,
  status: "published",
  is_inbox: 0,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const CHALLENGE_ROW: ChallengeRow = {
  id: 100,
  project_id: 10,
  name: "Anki 30分",
  status: "in_progress",
  due_on: null,
  progress_comment: null,
  review_comment: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

// ─── Test app helpers ────────────────────────────────────────────────────────

function makeTestApp(db: D1Database, token = "xoxb-test") {
  const app = new Hono<{ Bindings: Env }>();

  app.post("/test/cem-progress", async (c) => {
    const rawBody = await c.req.text();
    const params = new URLSearchParams(rawBody);
    return handleCemProgress(c, params);
  });

  app.post("/test/progress-submit", async (c) => {
    const rawBody = await c.req.text();
    const payload = JSON.parse(rawBody) as SlackInteractionPayload;
    return handleProgressSubmit(c, payload);
  });

  const env: Env = {
    DB: db,
    SLACK_BOT_TOKEN: token,
    SLACK_SIGNING_SECRET: "secret",
    SLACK_POST_CHANNEL_ID: "C_POST",
  };

  return { app, env };
}

function makeStandardDb(): D1Database {
  return makeDb((sql: string) => {
    if (sql.includes("user_preferences"))
      return makePreparedStatement({ firstResult: PREFS_ROW });
    if (sql.includes("FROM users") || sql.includes("SELECT * FROM users"))
      return makePreparedStatement({ firstResult: USER_ROW });
    if (sql.includes("FROM projects") && sql.includes("IN (")) {
      return makePreparedStatement({ allResult: { results: [CHALLENGE_ROW] } });
    }
    if (sql.includes("FROM projects")) {
      return makePreparedStatement({
        allResult: { results: [PUBLISHED_PROJECT] },
      });
    }
    if (sql.includes("FROM challenges") || sql.includes("UPDATE challenges")) {
      return makePreparedStatement({
        allResult: { results: [CHALLENGE_ROW] },
        firstResult: CHALLENGE_ROW,
      });
    }
    return makePreparedStatement({ firstResult: null });
  });
}

// ─── Tests: handleCemProgress ────────────────────────────────────────────────

describe("handleCemProgress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens modal_progress_report when published project exists", async () => {
    const db = makeStandardDb();
    const { app, env } = makeTestApp(db);

    const body = new URLSearchParams({
      user_id: "U123",
      user_name: "testuser",
      trigger_id: "T123",
      channel_id: "C123",
    }).toString();

    const res = await app.request(
      "/test/cem-progress",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(openModal).toHaveBeenCalledOnce();
    const [, , view] = (openModal as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, string, { callback_id: string }];
    expect(view.callback_id).toBe("modal_progress_report");
  });

  it("sends ephemeral error when no published project found", async () => {
    const db = makeDb((sql: string) => {
      if (sql.includes("user_preferences"))
        return makePreparedStatement({ firstResult: PREFS_ROW });
      if (sql.includes("FROM users") || sql.includes("SELECT * FROM users"))
        return makePreparedStatement({ firstResult: USER_ROW });
      if (sql.includes("FROM projects") && sql.includes("IN (")) {
        return makePreparedStatement({ allResult: { results: [] } });
      }
      if (sql.includes("FROM projects")) {
        // Return only draft projects
        return makePreparedStatement({
          allResult: { results: [{ ...PUBLISHED_PROJECT, status: "draft" }] },
        });
      }
      return makePreparedStatement({ firstResult: null });
    });

    const { app, env } = makeTestApp(db);

    const body = new URLSearchParams({
      user_id: "U123",
      user_name: "testuser",
      trigger_id: "T123",
      channel_id: "C123",
    }).toString();

    const res = await app.request(
      "/test/cem-progress",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(postEphemeral).toHaveBeenCalledOnce();
    const [, , , text] = (postEphemeral as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, string, string, string];
    expect(text).toContain("進行中のプロジェクトが見つかりません");
  });

  it("returns 200 immediately (not waiting for DB)", async () => {
    const db = makeStandardDb();
    const { app, env } = makeTestApp(db);

    const body = new URLSearchParams({
      user_id: "U123",
      user_name: "testuser",
      trigger_id: "T123",
      channel_id: "C123",
    }).toString();

    const res = await app.request(
      "/test/cem-progress",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      },
      env,
    );

    expect(res.status).toBe(200);
  });
});

// ─── Tests: handleProgressSubmit ─────────────────────────────────────────────

describe("handleProgressSubmit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200", async () => {
    const db = makeStandardDb();
    const { app, env } = makeTestApp(db);

    const payload: SlackInteractionPayload = {
      type: "view_submission",
      trigger_id: "T123",
      user: { id: "U123", username: "testuser", name: "testuser" },
      view: {
        id: "V123",
        callback_id: "modal_progress_report",
        private_metadata: "10",
        state: {
          values: {
            progress_comment_100: {
              progress_comment_100: {
                type: "plain_text_input",
                value: "順調に進んでいます",
              },
            },
          },
        },
      },
    };

    const res = await app.request(
      "/test/progress-submit",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      env,
    );

    expect(res.status).toBe(200);
  });
});
