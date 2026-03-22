import type {
  D1Database,
  D1PreparedStatement,
} from "@cloudflare/workers-types";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildReviewModal,
  handleCemReview,
  handleReviewSubmit,
} from "../../src/handlers/commands/cem-review";
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

const REVIEWED_PROJECT: ProjectRow = {
  ...PUBLISHED_PROJECT,
  status: "reviewed",
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

  app.post("/test/cem-review", async (c) => {
    const rawBody = await c.req.text();
    const params = new URLSearchParams(rawBody);
    return handleCemReview(c, params);
  });

  app.post("/test/review-submit", async (c) => {
    const rawBody = await c.req.text();
    const payload = JSON.parse(rawBody) as SlackInteractionPayload;
    return handleReviewSubmit(c, payload);
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
    if (sql.includes("UPDATE projects")) {
      return makePreparedStatement({ firstResult: REVIEWED_PROJECT });
    }
    if (sql.includes("FROM challenges") || sql.includes("UPDATE challenges")) {
      return makePreparedStatement({
        allResult: { results: [CHALLENGE_ROW] },
        firstResult: { ...CHALLENGE_ROW, status: "completed" },
      });
    }
    return makePreparedStatement({ firstResult: null });
  });
}

// ─── Tests: buildReviewModal ──────────────────────────────────────────────────

describe("buildReviewModal", () => {
  it("returns a modal with callback_id=modal_review", () => {
    const modal = buildReviewModal(10, []) as { callback_id: string };
    expect(modal.callback_id).toBe("modal_review");
  });

  it("includes a block per challenge with select and comment input", () => {
    const challenges = [
      {
        id: 100,
        name: "Anki 30分",
        status: "in_progress",
        review_comment: null,
      },
      {
        id: 101,
        name: "単語帳",
        status: "completed",
        review_comment: "良い感じ",
      },
    ];
    const modal = buildReviewModal(10, challenges) as { blocks: unknown[] };
    // Each challenge creates 2 blocks (select + comment input), plus 1 header block
    expect(modal.blocks.length).toBe(1 + challenges.length * 2);
  });

  it("stores projectId in private_metadata", () => {
    const modal = buildReviewModal(42, []) as { private_metadata: string };
    expect(modal.private_metadata).toBe("42");
  });

  it("pre-selects completed as initial option for completed challenge", () => {
    const challenges = [
      { id: 100, name: "Test", status: "completed", review_comment: null },
    ];
    const modal = buildReviewModal(10, challenges);
    const blocksStr = JSON.stringify(modal);
    expect(blocksStr).toContain("completed");
  });

  it("pre-selects incompleted as initial option for non-completed challenge", () => {
    const challenges = [
      { id: 100, name: "Test", status: "in_progress", review_comment: null },
    ];
    const modal = buildReviewModal(10, challenges);
    const blocksStr = JSON.stringify(modal);
    expect(blocksStr).toContain("incompleted");
  });
});

// ─── Tests: handleCemReview ───────────────────────────────────────────────────

describe("handleCemReview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens modal_review when published project exists", async () => {
    const db = makeStandardDb();
    const { app, env } = makeTestApp(db);

    const body = new URLSearchParams({
      user_id: "U123",
      user_name: "testuser",
      trigger_id: "T123",
      channel_id: "C123",
    }).toString();

    const res = await app.request(
      "/test/cem-review",
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
    expect(view.callback_id).toBe("modal_review");
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
      "/test/cem-review",
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
    expect(text).toContain("振り返り対象のプロジェクトが見つかりません");
  });
});

// ─── Tests: handleReviewSubmit ────────────────────────────────────────────────

describe("handleReviewSubmit", () => {
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
        callback_id: "modal_review",
        private_metadata: "10",
        state: {
          values: {
            select_challenge_result_100: {
              select_challenge_result_100: {
                type: "static_select",
                selected_option: { value: "completed" },
              },
            },
            input_review_comment_100: {
              input_review_comment_100: {
                type: "plain_text_input",
                value: "達成できました！",
              },
            },
          },
        },
      },
    };

    const res = await app.request(
      "/test/review-submit",
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
