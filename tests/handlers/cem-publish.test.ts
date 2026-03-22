import type {
  D1Database,
  D1PreparedStatement,
} from "@cloudflare/workers-types";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  handleCemPublish,
  handleHomePublish,
} from "../../src/handlers/commands/cem-publish";
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

import { postEphemeral } from "../../src/utils/slack-api";

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

const DRAFT_PROJECT: ProjectRow = {
  id: 10,
  user_id: 1,
  title: "英語学習",
  year: 2026,
  month: 3,
  status: "draft",
  is_inbox: 0,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const PUBLISHED_PROJECT: ProjectRow = {
  ...DRAFT_PROJECT,
  status: "published",
};

const CHALLENGE_ROW: ChallengeRow = {
  id: 100,
  project_id: 10,
  name: "Anki 30分",
  status: "not_started",
  due_on: null,
  progress_comment: null,
  review_comment: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

// ─── Test app helpers ────────────────────────────────────────────────────────

function makeTestApp(db: D1Database, token = "xoxb-test") {
  const app = new Hono<{ Bindings: Env }>();

  app.post("/test/cem-publish", async (c) => {
    const rawBody = await c.req.text();
    const params = new URLSearchParams(rawBody);
    return handleCemPublish(c, params);
  });

  app.post("/test/home-publish", async (c) => {
    const rawBody = await c.req.text();
    const payload = JSON.parse(rawBody) as SlackInteractionPayload;
    return handleHomePublish(c, payload);
  });

  const env: Env = {
    DB: db,
    SLACK_BOT_TOKEN: token,
    SLACK_SIGNING_SECRET: "secret",
    SLACK_POST_CHANNEL_ID: "C_POST",
  };

  return { app, env };
}

// ─── Tests: handleCemPublish ─────────────────────────────────────────────────

describe("handleCemPublish", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200", async () => {
    const db = makeDb((sql: string) => {
      if (sql.includes("user_preferences"))
        return makePreparedStatement({ firstResult: PREFS_ROW });
      if (sql.includes("FROM users") || sql.includes("SELECT * FROM users"))
        return makePreparedStatement({ firstResult: USER_ROW });
      if (sql.includes("FROM projects") && sql.includes("IN (")) {
        return makePreparedStatement({
          allResult: { results: [CHALLENGE_ROW] },
        });
      }
      if (sql.includes("FROM projects")) {
        return makePreparedStatement({
          allResult: { results: [DRAFT_PROJECT] },
        });
      }
      if (sql.includes("UPDATE projects")) {
        return makePreparedStatement({ firstResult: PUBLISHED_PROJECT });
      }
      if (sql.includes("FROM challenges") || sql.includes("challenges")) {
        return makePreparedStatement({
          allResult: { results: [CHALLENGE_ROW] },
        });
      }
      return makePreparedStatement({ firstResult: null });
    });

    const { app, env } = makeTestApp(db);
    const body = new URLSearchParams({
      user_id: "U123",
      user_name: "testuser",
      channel_id: "C123",
    }).toString();

    const res = await app.request(
      "/test/cem-publish",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      },
      env,
    );

    expect(res.status).toBe(200);
  });

  it("sends ephemeral error when no draft project found", async () => {
    const db = makeDb((sql: string) => {
      if (sql.includes("user_preferences"))
        return makePreparedStatement({ firstResult: PREFS_ROW });
      if (sql.includes("FROM users") || sql.includes("SELECT * FROM users"))
        return makePreparedStatement({ firstResult: USER_ROW });
      if (sql.includes("FROM projects")) {
        // Return a published project (not draft)
        return makePreparedStatement({
          allResult: { results: [PUBLISHED_PROJECT] },
        });
      }
      if (sql.includes("FROM challenges") || sql.includes("challenges")) {
        return makePreparedStatement({ allResult: { results: [] } });
      }
      return makePreparedStatement({ firstResult: null });
    });

    const { app, env } = makeTestApp(db);
    const body = new URLSearchParams({
      user_id: "U123",
      user_name: "testuser",
      channel_id: "C123",
    }).toString();

    const res = await app.request(
      "/test/cem-publish",
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
    expect(text).toContain("公開できるプロジェクトが見つかりません");
  });
});

// ─── Tests: handleHomePublish ────────────────────────────────────────────────

describe("handleHomePublish", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200", async () => {
    const db = makeDb((sql: string) => {
      if (sql.includes("user_preferences"))
        return makePreparedStatement({ firstResult: PREFS_ROW });
      if (sql.includes("FROM users") || sql.includes("SELECT * FROM users"))
        return makePreparedStatement({ firstResult: USER_ROW });
      if (sql.includes("FROM projects WHERE id ="))
        return makePreparedStatement({ firstResult: DRAFT_PROJECT });
      if (sql.includes("FROM projects") && sql.includes("IN (")) {
        return makePreparedStatement({
          allResult: { results: [CHALLENGE_ROW] },
        });
      }
      if (sql.includes("FROM projects")) {
        return makePreparedStatement({
          allResult: { results: [DRAFT_PROJECT] },
        });
      }
      if (sql.includes("UPDATE projects")) {
        return makePreparedStatement({ firstResult: PUBLISHED_PROJECT });
      }
      if (sql.includes("FROM challenges") || sql.includes("challenges")) {
        return makePreparedStatement({
          allResult: { results: [CHALLENGE_ROW] },
        });
      }
      return makePreparedStatement({ firstResult: null });
    });

    const { app, env } = makeTestApp(db);

    const payload: SlackInteractionPayload = {
      type: "block_actions",
      trigger_id: "T123",
      user: { id: "U123", username: "testuser", name: "testuser" },
      actions: [
        {
          action_id: "home_publish",
          block_id: "b1",
          value: "10",
          type: "button",
        },
      ],
    };

    const res = await app.request(
      "/test/home-publish",
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
