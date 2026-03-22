import type {
  D1Database,
  D1PreparedStatement,
} from "@cloudflare/workers-types";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { interactionRouter } from "../../src/routes/interactions";
import type {
  ChallengeRow,
  Env,
  HonoEnv,
  ProjectRow,
  SlackInteractionPayload,
  UserPreferencesRow,
  UserRow,
} from "../../src/types";

// ---------------------------------------------------------------------------
// Mock Slack API — prevents real HTTP calls
// ---------------------------------------------------------------------------

vi.mock("../../src/utils/slack-api", () => ({
  openModal: vi.fn().mockResolvedValue(undefined),
  publishHome: vi.fn().mockResolvedValue(undefined),
  postMessage: vi.fn().mockResolvedValue(undefined),
  postEphemeral: vi.fn().mockResolvedValue(undefined),
  postDm: vi.fn().mockResolvedValue(undefined),
  slackPost: vi.fn().mockResolvedValue({ ok: true }),
}));

import { openModal } from "../../src/utils/slack-api";

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
  (
    stmt as unknown as { first: ReturnType<typeof vi.fn> }
  ).first.mockResolvedValue(opts.firstResult ?? null);
  (stmt as unknown as { run: ReturnType<typeof vi.fn> }).run.mockResolvedValue(
    opts.runResult ?? { success: true, meta: { last_row_id: 1 }, results: [] },
  );
  (stmt as unknown as { all: ReturnType<typeof vi.fn> }).all.mockResolvedValue(
    opts.allResult ?? { results: [] },
  );

  return stmt;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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

const PROJECT_ROW: ProjectRow = {
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

function makeDb(prepareImpl: (sql: string) => D1PreparedStatement): D1Database {
  return {
    prepare: vi.fn().mockImplementation(prepareImpl),
    exec: vi.fn(),
    batch: vi.fn(),
    dump: vi.fn(),
  } as unknown as D1Database;
}

/**
 * Standard DB mock that covers the most common query patterns used across
 * all interaction handlers.
 */
function makeStandardDb(): D1Database {
  return makeDb((sql: string) => {
    // user_preferences — SELECT or UPDATE
    if (sql.includes("user_preferences")) {
      return makePreparedStatement({ firstResult: PREFS_ROW });
    }
    // users — SELECT by slack_user_id or by id
    if (sql.includes("FROM users")) {
      return makePreparedStatement({ firstResult: USER_ROW });
    }
    // projects — SELECT single by primary key (assertProjectOwner)
    if (sql.includes("FROM projects WHERE id =")) {
      return makePreparedStatement({ firstResult: PROJECT_ROW });
    }
    // challenges — sub-SELECT from getProjectsWithChallenges
    if (sql.includes("FROM challenges WHERE project_id IN")) {
      return makePreparedStatement({
        allResult: { results: [CHALLENGE_ROW] },
      });
    }
    // projects — list by user_id/year/month (getProjectsWithChallenges)
    if (sql.includes("FROM projects")) {
      return makePreparedStatement({
        allResult: { results: [PROJECT_ROW] },
        firstResult: PROJECT_ROW,
      });
    }
    // challenges — any remaining challenge query
    if (sql.includes("FROM challenges") || sql.includes("challenges")) {
      return makePreparedStatement({
        allResult: { results: [CHALLENGE_ROW] },
        firstResult: CHALLENGE_ROW,
      });
    }
    // INSERT / UPDATE / DELETE — default to success
    return makePreparedStatement({ firstResult: null });
  });
}

// ---------------------------------------------------------------------------
// Test app factory
// ---------------------------------------------------------------------------

function makeTestApp() {
  const app = new Hono<HonoEnv>();

  // Simulate the rawBody middleware
  app.use("/slack/interactions", async (c, next) => {
    const body = await c.req.text();
    c.set("rawBody" as never, body as never);
    await next();
  });

  app.post("/slack/interactions", interactionRouter);
  return app;
}

function makeEnv(db: D1Database): Env {
  return {
    DB: db,
    SLACK_BOT_TOKEN: "xoxb-test",
    SLACK_SIGNING_SECRET: "secret",
    SLACK_POST_CHANNEL_ID: "C123",
  };
}

/** Encode a SlackInteractionPayload as URL-encoded form body (Slack format). */
function encodePayload(payload: SlackInteractionPayload): string {
  return `payload=${encodeURIComponent(JSON.stringify(payload))}`;
}

function makeBlockActionPayload(
  actionId: string,
  value = "10",
): SlackInteractionPayload {
  return {
    type: "block_actions",
    trigger_id: "T123",
    user: { id: "U123", username: "testuser", name: "testuser" },
    actions: [
      {
        action_id: actionId,
        block_id: "b1",
        value,
        type: "button",
      },
    ],
  };
}

function makeViewSubmissionPayload(
  callbackId: string,
  stateValues: SlackInteractionPayload["view"] extends
    | { state: { values: infer V } }
    | undefined
    ? V
    : Record<string, Record<string, { type: string; value?: string }>> = {},
): SlackInteractionPayload {
  return {
    type: "view_submission",
    trigger_id: "T123",
    user: { id: "U123", username: "testuser", name: "testuser" },
    view: {
      id: "V123",
      callback_id: callbackId,
      private_metadata: "10",
      state: { values: stateValues },
    },
  };
}

// ---------------------------------------------------------------------------
// Tests: block_actions routing
// ---------------------------------------------------------------------------

describe("interactionRouter — block_actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 for home_nav_prev", async () => {
    const db = makeStandardDb();
    const app = makeTestApp();
    const payload = makeBlockActionPayload("home_nav_prev", "2026-2");

    const res = await app.request(
      "/slack/interactions",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: encodePayload(payload),
      },
      makeEnv(db),
    );

    expect(res.status).toBe(200);
  });

  it("returns 200 for home_nav_next", async () => {
    const db = makeStandardDb();
    const app = makeTestApp();
    const payload = makeBlockActionPayload("home_nav_next", "2026-4");

    const res = await app.request(
      "/slack/interactions",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: encodePayload(payload),
      },
      makeEnv(db),
    );

    expect(res.status).toBe(200);
  });

  it("returns 200 for challenge_set_not_started", async () => {
    const db = makeStandardDb();
    const app = makeTestApp();
    const payload = makeBlockActionPayload("challenge_set_not_started", "100");

    const res = await app.request(
      "/slack/interactions",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: encodePayload(payload),
      },
      makeEnv(db),
    );

    expect(res.status).toBe(200);
  });

  it("returns 200 for challenge_set_in_progress", async () => {
    const db = makeStandardDb();
    const app = makeTestApp();
    const payload = makeBlockActionPayload("challenge_set_in_progress", "100");

    const res = await app.request(
      "/slack/interactions",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: encodePayload(payload),
      },
      makeEnv(db),
    );

    expect(res.status).toBe(200);
  });

  it("returns 200 for challenge_set_completed", async () => {
    const db = makeStandardDb();
    const app = makeTestApp();
    const payload = makeBlockActionPayload("challenge_set_completed", "100");

    const res = await app.request(
      "/slack/interactions",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: encodePayload(payload),
      },
      makeEnv(db),
    );

    expect(res.status).toBe(200);
  });

  it("returns 200 and opens modal_challenge_comment for challenge_open_comment", async () => {
    const db = makeStandardDb();
    const app = makeTestApp();

    const payload: SlackInteractionPayload = {
      type: "block_actions",
      trigger_id: "T123",
      user: { id: "U123", username: "testuser", name: "testuser" },
      actions: [
        {
          action_id: "challenge_open_comment",
          block_id: "b1",
          value: "100",
          type: "overflow",
          selected_option: { value: "100" },
        },
      ],
    };

    const res = await app.request(
      "/slack/interactions",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: encodePayload(payload),
      },
      makeEnv(db),
    );

    expect(res.status).toBe(200);
    expect(openModal).toHaveBeenCalledOnce();
    const [, , view] = (openModal as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, string, { callback_id: string }];
    expect(view.callback_id).toBe("modal_challenge_comment");
  });

  it("returns 200 and opens new project modal for home_open_new_project", async () => {
    const db = makeStandardDb();
    const app = makeTestApp();
    const payload = makeBlockActionPayload("home_open_new_project");

    const res = await app.request(
      "/slack/interactions",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: encodePayload(payload),
      },
      makeEnv(db),
    );

    expect(res.status).toBe(200);
    expect(openModal).toHaveBeenCalledOnce();
    const [, , view] = (openModal as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, string, { callback_id: string }];
    expect(view.callback_id).toBe("modal_new_project_standard");
  });

  it("returns 200 and opens add challenge modal for home_open_add_challenge", async () => {
    const db = makeStandardDb();
    const app = makeTestApp();
    const payload = makeBlockActionPayload("home_open_add_challenge", "10");

    const res = await app.request(
      "/slack/interactions",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: encodePayload(payload),
      },
      makeEnv(db),
    );

    expect(res.status).toBe(200);
    expect(openModal).toHaveBeenCalledOnce();
    const [, , view] = (openModal as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, string, { callback_id: string }];
    expect(view.callback_id).toBe("modal_add_challenge");
  });

  it("returns 200 and opens settings modal for home_open_settings", async () => {
    const db = makeStandardDb();
    const app = makeTestApp();
    const payload = makeBlockActionPayload("home_open_settings");

    const res = await app.request(
      "/slack/interactions",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: encodePayload(payload),
      },
      makeEnv(db),
    );

    expect(res.status).toBe(200);
    expect(openModal).toHaveBeenCalledOnce();
    const [, , view] = (openModal as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, string, { callback_id: string }];
    expect(view.callback_id).toBe("modal_settings");
  });

  it("returns 200 and opens edit modal for home_open_edit_project", async () => {
    const db = makeStandardDb();
    const app = makeTestApp();
    const payload = makeBlockActionPayload("home_open_edit_project", "10");

    const res = await app.request(
      "/slack/interactions",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: encodePayload(payload),
      },
      makeEnv(db),
    );

    expect(res.status).toBe(200);
    expect(openModal).toHaveBeenCalledOnce();
    const [, , view] = (openModal as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, string, { callback_id: string }];
    expect(view.callback_id).toBe("modal_edit_project");
  });

  it("returns 200 and opens delete confirm modal for home_confirm_delete_project", async () => {
    const db = makeStandardDb();
    const app = makeTestApp();
    const payload = makeBlockActionPayload("home_confirm_delete_project", "10");

    const res = await app.request(
      "/slack/interactions",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: encodePayload(payload),
      },
      makeEnv(db),
    );

    expect(res.status).toBe(200);
    expect(openModal).toHaveBeenCalledOnce();
    const [, , view] = (openModal as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, string, { callback_id: string }];
    expect(view.callback_id).toBe("modal_delete_project_confirm");
  });

  it("returns 200 for home_publish", async () => {
    const db = makeStandardDb();
    const app = makeTestApp();
    const payload = makeBlockActionPayload("home_publish", "10");

    const res = await app.request(
      "/slack/interactions",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: encodePayload(payload),
      },
      makeEnv(db),
    );

    expect(res.status).toBe(200);
  });

  it("returns 200 for home_review_complete", async () => {
    const db = makeStandardDb();
    const app = makeTestApp();
    const payload = makeBlockActionPayload("home_review_complete", "10");

    const res = await app.request(
      "/slack/interactions",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: encodePayload(payload),
      },
      makeEnv(db),
    );

    expect(res.status).toBe(200);
  });

  it("returns 200 for unknown action_id", async () => {
    const db = makeStandardDb();
    const app = makeTestApp();
    const payload = makeBlockActionPayload("unknown_action");

    const res = await app.request(
      "/slack/interactions",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: encodePayload(payload),
      },
      makeEnv(db),
    );

    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Tests: view_submission routing
// ---------------------------------------------------------------------------

describe("interactionRouter — view_submission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 for modal_new_project_standard", async () => {
    const db = makeStandardDb();
    const app = makeTestApp();
    const payload = makeViewSubmissionPayload("modal_new_project_standard", {
      input_project_title: {
        input_project_title: { type: "plain_text_input", value: "英語学習" },
      },
      input_challenge_name_0: {
        input_challenge_name_0: {
          type: "plain_text_input",
          value: "Anki 30分",
        },
      },
    });

    const res = await app.request(
      "/slack/interactions",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: encodePayload(payload),
      },
      makeEnv(db),
    );

    expect(res.status).toBe(200);
  });

  it("returns 200 for modal_new_project_markdown", async () => {
    const db = makeStandardDb();
    const app = makeTestApp();
    const payload = makeViewSubmissionPayload("modal_new_project_markdown", {
      input_markdown_text: {
        input_markdown_text: {
          type: "plain_text_input",
          value: "# 英語学習\n- Anki 30分",
        },
      },
    });

    const res = await app.request(
      "/slack/interactions",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: encodePayload(payload),
      },
      makeEnv(db),
    );

    expect(res.status).toBe(200);
  });

  it("returns 200 for modal_settings", async () => {
    const db = makeStandardDb();
    const app = makeTestApp();
    const payload = makeViewSubmissionPayload("modal_settings", {
      toggle_markdown_mode: {
        toggle_markdown_mode: {
          type: "static_select",
          selected_option: { value: "true" },
        },
      },
      toggle_personal_reminder: {
        toggle_personal_reminder: {
          type: "static_select",
          selected_option: { value: "false" },
        },
      },
    });

    const res = await app.request(
      "/slack/interactions",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: encodePayload(payload),
      },
      makeEnv(db),
    );

    expect(res.status).toBe(200);
  });

  it("returns 200 for modal_challenge_comment", async () => {
    const db = makeStandardDb();
    const app = makeTestApp();
    const payload = makeViewSubmissionPayload("modal_challenge_comment", {
      input_progress_comment: {
        input_progress_comment: {
          type: "plain_text_input",
          value: "順調に進んでいます",
        },
      },
    });

    const res = await app.request(
      "/slack/interactions",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: encodePayload(payload),
      },
      makeEnv(db),
    );

    expect(res.status).toBe(200);
  });

  it("returns 200 for modal_edit_project", async () => {
    const db = makeStandardDb();
    const app = makeTestApp();
    const payload = makeViewSubmissionPayload("modal_edit_project", {
      input_project_title: {
        input_project_title: {
          type: "plain_text_input",
          value: "英語学習（更新）",
        },
      },
    });

    const res = await app.request(
      "/slack/interactions",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: encodePayload(payload),
      },
      makeEnv(db),
    );

    expect(res.status).toBe(200);
  });

  it("returns 200 for modal_delete_project_confirm", async () => {
    const db = makeStandardDb();
    const app = makeTestApp();
    const payload = makeViewSubmissionPayload("modal_delete_project_confirm");

    const res = await app.request(
      "/slack/interactions",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: encodePayload(payload),
      },
      makeEnv(db),
    );

    expect(res.status).toBe(200);
  });

  it("returns 200 for modal_progress_report", async () => {
    const db = makeStandardDb();
    const app = makeTestApp();
    const payload = makeViewSubmissionPayload("modal_progress_report", {
      progress_comment_100: {
        progress_comment_100: {
          type: "plain_text_input",
          value: "今週は3回できた",
        },
      },
    });

    const res = await app.request(
      "/slack/interactions",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: encodePayload(payload),
      },
      makeEnv(db),
    );

    expect(res.status).toBe(200);
  });

  it("returns 200 for modal_review", async () => {
    const db = makeStandardDb();
    const app = makeTestApp();
    const payload = makeViewSubmissionPayload("modal_review", {
      select_challenge_result_100: {
        select_challenge_result_100: {
          type: "static_select",
          selected_option: { value: "completed" },
        },
      },
      input_review_comment_100: {
        input_review_comment_100: {
          type: "plain_text_input",
          value: "毎日続けられた",
        },
      },
    });

    const res = await app.request(
      "/slack/interactions",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: encodePayload(payload),
      },
      makeEnv(db),
    );

    expect(res.status).toBe(200);
  });

  it("returns 200 for modal_add_challenge", async () => {
    const db = makeStandardDb();
    const app = makeTestApp();
    const payload = makeViewSubmissionPayload("modal_add_challenge", {
      input_challenge_name: {
        input_challenge_name: {
          type: "plain_text_input",
          value: "新しいチャレンジ",
        },
      },
    });

    const res = await app.request(
      "/slack/interactions",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: encodePayload(payload),
      },
      makeEnv(db),
    );

    expect(res.status).toBe(200);
  });

  it("returns 200 for unknown callback_id", async () => {
    const db = makeStandardDb();
    const app = makeTestApp();
    const payload = makeViewSubmissionPayload("modal_unknown");

    const res = await app.request(
      "/slack/interactions",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: encodePayload(payload),
      },
      makeEnv(db),
    );

    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Tests: view_closed and unknown type
// ---------------------------------------------------------------------------

describe("interactionRouter — other types", () => {
  it("returns 200 for view_closed", async () => {
    const db = makeStandardDb();
    const app = makeTestApp();

    const payload = {
      type: "view_closed" as const,
      trigger_id: "T123",
      user: { id: "U123", username: "testuser", name: "testuser" },
    };

    const res = await app.request(
      "/slack/interactions",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `payload=${encodeURIComponent(JSON.stringify(payload))}`,
      },
      makeEnv(db),
    );

    expect(res.status).toBe(200);
  });

  it("returns 200 for unknown interaction type", async () => {
    const db = makeStandardDb();
    const app = makeTestApp();

    const payload = { type: "unknown_type", trigger_id: "T123" };

    const res = await app.request(
      "/slack/interactions",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `payload=${encodeURIComponent(JSON.stringify(payload))}`,
      },
      makeEnv(db),
    );

    expect(res.status).toBe(200);
  });
});
