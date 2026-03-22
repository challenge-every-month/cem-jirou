import { describe, it, expect, vi, beforeEach } from "vitest";
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import type { UserRow, UserPreferencesRow, ProjectRow, ChallengeRow } from "../../src/types";
import { Hono } from "hono";
import type { Env, SlackInteractionPayload } from "../../src/types";
import { handleCemNew, handleNewProjectStandardSubmit, handleNewProjectMarkdownSubmit } from "../../src/handlers/commands/cem-new";

// ---------------------------------------------------------------------------
// Mock slack-api module
// ---------------------------------------------------------------------------

vi.mock("../../src/utils/slack-api", () => ({
  openModal: vi.fn().mockResolvedValue(undefined),
  publishHome: vi.fn().mockResolvedValue(undefined),
  postMessage: vi.fn().mockResolvedValue(undefined),
  postEphemeral: vi.fn().mockResolvedValue(undefined),
  postDm: vi.fn().mockResolvedValue(undefined),
  slackPost: vi.fn().mockResolvedValue({ ok: true }),
}));

// Import after vi.mock so we get the mocked version
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

const USER_ROW: UserRow = {
  id: 1,
  slack_user_id: "U123",
  user_name: "testuser",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function makePrefsRow(overrides: Partial<UserPreferencesRow> = {}): UserPreferencesRow {
  return {
    id: 1,
    user_id: 1,
    markdown_mode: 0,
    personal_reminder: 0,
    viewed_year: null,
    viewed_month: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const PROJECT_ROW: ProjectRow = {
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

const INBOX_PROJECT_ROW: ProjectRow = {
  id: 11,
  user_id: 1,
  title: "その他",
  year: 2026,
  month: 3,
  status: "draft",
  is_inbox: 1,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const CHALLENGE_ROW: ChallengeRow = {
  id: 100,
  project_id: 10,
  name: "Anki 30分",
  status: "draft",
  due_on: null,
  progress_comment: null,
  review_comment: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

// ---------------------------------------------------------------------------
// Context helper
// ---------------------------------------------------------------------------

function makeContext(db: D1Database, token = "xoxb-test") {
  const app = new Hono<{ Bindings: Env }>();
  let capturedContext: ReturnType<typeof app.request> | null = null;

  // We need to capture the hono context — use a minimal approach
  const env: Env = {
    DB: db,
    SLACK_BOT_TOKEN: token,
    SLACK_SIGNING_SECRET: "secret",
    SLACK_POST_CHANNEL_ID: "C123",
  };

  return env;
}

// We use a different approach: call handlers via a test app
function makeTestApp(db: D1Database, token = "xoxb-test") {
  const app = new Hono<{ Bindings: Env }>();

  app.post("/test/cem-new", async (c) => {
    const rawBody = await c.req.text();
    const params = new URLSearchParams(rawBody);
    return handleCemNew(c, params);
  });

  app.post("/test/new-standard-submit", async (c) => {
    const rawBody = await c.req.text();
    const payload = JSON.parse(rawBody) as SlackInteractionPayload;
    return handleNewProjectStandardSubmit(c, payload);
  });

  app.post("/test/new-markdown-submit", async (c) => {
    const rawBody = await c.req.text();
    const payload = JSON.parse(rawBody) as SlackInteractionPayload;
    return handleNewProjectMarkdownSubmit(c, payload);
  });

  const env: Env = {
    DB: db,
    SLACK_BOT_TOKEN: token,
    SLACK_SIGNING_SECRET: "secret",
    SLACK_POST_CHANNEL_ID: "C123",
  };

  return { app, env };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("handleCemNew", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens standard modal when markdown_mode=0", async () => {
    const prefs = makePrefsRow({ markdown_mode: 0 });
    const db = makeDb(() => makePreparedStatement({ firstResult: USER_ROW }));
    // lazyProvision calls: SELECT users, SELECT user_preferences
    let callCount = 0;
    const dbMulti = makeDb((sql: string) => {
      if (sql.includes("user_preferences")) {
        return makePreparedStatement({ firstResult: prefs });
      }
      return makePreparedStatement({ firstResult: USER_ROW });
    });

    const { app, env } = makeTestApp(dbMulti);

    const body = new URLSearchParams({
      user_id: "U123",
      user_name: "testuser",
      trigger_id: "T123",
    }).toString();

    const res = await app.request("/test/cem-new", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    }, env);

    expect(res.status).toBe(200);
    expect(openModal).toHaveBeenCalledOnce();
    const [, triggerId, view] = (openModal as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string, { callback_id: string }];
    expect(triggerId).toBe("T123");
    expect(view.callback_id).toBe("modal_new_project_standard");
  });

  it("opens markdown modal when markdown_mode=1", async () => {
    const prefs = makePrefsRow({ markdown_mode: 1 });
    const dbMulti = makeDb((sql: string) => {
      if (sql.includes("user_preferences")) {
        return makePreparedStatement({ firstResult: prefs });
      }
      return makePreparedStatement({ firstResult: USER_ROW });
    });

    const { app, env } = makeTestApp(dbMulti);

    const body = new URLSearchParams({
      user_id: "U123",
      user_name: "testuser",
      trigger_id: "T456",
    }).toString();

    const res = await app.request("/test/cem-new", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    }, env);

    expect(res.status).toBe(200);
    expect(openModal).toHaveBeenCalledOnce();
    const [, triggerId, view] = (openModal as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string, { callback_id: string }];
    expect(triggerId).toBe("T456");
    expect(view.callback_id).toBe("modal_new_project_markdown");
  });
});

describe("handleNewProjectStandardSubmit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeSubmitPayload(title: string, challengeName: string, dueOn: string | null = null): SlackInteractionPayload {
    return {
      type: "view_submission",
      trigger_id: "T123",
      user: { id: "U123", username: "testuser", name: "testuser" },
      view: {
        id: "V123",
        callback_id: "modal_new_project_standard",
        state: {
          values: {
            input_project_title: {
              input_project_title: { type: "plain_text_input", value: title || undefined },
            },
            input_challenge_name_0: {
              input_challenge_name_0: { type: "plain_text_input", value: challengeName },
            },
            input_due_on_0: {
              input_due_on_0: { type: "datepicker", selected_date: dueOn ?? undefined },
            },
          },
        },
      },
    };
  }

  it("creates project with given title when title is provided", async () => {
    const createProjectMock = vi.fn().mockResolvedValue(PROJECT_ROW);
    const createChallengeMock = vi.fn().mockResolvedValue(CHALLENGE_ROW);
    const countMock = vi.fn().mockResolvedValue(0);

    // We need to mock service modules for this test approach
    // Instead, use DB mock that simulates the behavior
    const prefs = makePrefsRow();
    let prepareCallIndex = 0;
    const dbMulti = makeDb((sql: string) => {
      if (sql.includes("SELECT * FROM users")) {
        return makePreparedStatement({ firstResult: USER_ROW });
      }
      if (sql.includes("user_preferences")) {
        return makePreparedStatement({ firstResult: prefs });
      }
      if (sql.includes("COUNT(*)")) {
        return makePreparedStatement({ firstResult: { count: 0 } });
      }
      if (sql.includes("INSERT INTO projects")) {
        return makePreparedStatement({
          runResult: { success: true, meta: { last_row_id: 10 }, results: [] },
          firstResult: PROJECT_ROW,
        });
      }
      if (sql.includes("SELECT * FROM projects")) {
        return makePreparedStatement({ firstResult: PROJECT_ROW });
      }
      if (sql.includes("INSERT INTO challenges")) {
        return makePreparedStatement({
          runResult: { success: true, meta: { last_row_id: 100 }, results: [] },
          firstResult: CHALLENGE_ROW,
        });
      }
      if (sql.includes("SELECT * FROM challenges")) {
        return makePreparedStatement({ firstResult: CHALLENGE_ROW });
      }
      return makePreparedStatement({ firstResult: null });
    });

    const { app, env } = makeTestApp(dbMulti);
    const payload = makeSubmitPayload("英語学習", "Anki 30分");

    const res = await app.request("/test/new-standard-submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }, env);

    expect(res.status).toBe(200);
    // Verify INSERT INTO projects was called
    const prepareMock = dbMulti.prepare as ReturnType<typeof vi.fn>;
    const insertProjectCall = prepareMock.mock.calls.find(
      (args: unknown[]) => (args[0] as string).includes("INSERT INTO projects"),
    );
    expect(insertProjectCall).toBeDefined();
  });

  it("uses inbox project when title is empty", async () => {
    const prefs = makePrefsRow();
    const dbMulti = makeDb((sql: string) => {
      if (sql.includes("SELECT * FROM users")) {
        return makePreparedStatement({ firstResult: USER_ROW });
      }
      if (sql.includes("user_preferences")) {
        return makePreparedStatement({ firstResult: prefs });
      }
      if (sql.includes("COUNT(*)")) {
        return makePreparedStatement({ firstResult: { count: 0 } });
      }
      if (sql.includes("is_inbox = 1")) {
        // getOrCreateInboxProject SELECT
        return makePreparedStatement({ firstResult: INBOX_PROJECT_ROW });
      }
      if (sql.includes("INSERT INTO projects")) {
        return makePreparedStatement({
          runResult: { success: true, meta: { last_row_id: 11 }, results: [] },
          firstResult: INBOX_PROJECT_ROW,
        });
      }
      if (sql.includes("SELECT * FROM projects")) {
        return makePreparedStatement({ firstResult: INBOX_PROJECT_ROW });
      }
      if (sql.includes("INSERT INTO challenges")) {
        return makePreparedStatement({
          runResult: { success: true, meta: { last_row_id: 100 }, results: [] },
          firstResult: CHALLENGE_ROW,
        });
      }
      if (sql.includes("SELECT * FROM challenges")) {
        return makePreparedStatement({ firstResult: CHALLENGE_ROW });
      }
      return makePreparedStatement({ firstResult: null });
    });

    const { app, env } = makeTestApp(dbMulti);
    const payload = makeSubmitPayload("", "Anki 30分");

    const res = await app.request("/test/new-standard-submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }, env);

    expect(res.status).toBe(200);
    // Verify inbox query (no INSERT INTO projects for named project)
    const prepareMock = dbMulti.prepare as ReturnType<typeof vi.fn>;
    const insertNamedProjectCall = prepareMock.mock.calls.find(
      (args: unknown[]) => (args[0] as string).includes("INSERT INTO projects") && !(args[0] as string).includes("is_inbox"),
    );
    // Named project should NOT be created when title is empty
    expect(insertNamedProjectCall).toBeUndefined();
  });
});

describe("handleNewProjectMarkdownSubmit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses markdown text and creates projects and challenges", async () => {
    const prefs = makePrefsRow();
    const dbMulti = makeDb((sql: string) => {
      if (sql.includes("SELECT * FROM users")) {
        return makePreparedStatement({ firstResult: USER_ROW });
      }
      if (sql.includes("user_preferences")) {
        return makePreparedStatement({ firstResult: prefs });
      }
      if (sql.includes("COUNT(*)")) {
        return makePreparedStatement({ firstResult: { count: 0 } });
      }
      if (sql.includes("INSERT INTO projects")) {
        return makePreparedStatement({
          runResult: { success: true, meta: { last_row_id: 10 }, results: [] },
          firstResult: PROJECT_ROW,
        });
      }
      if (sql.includes("SELECT * FROM projects")) {
        return makePreparedStatement({ firstResult: PROJECT_ROW });
      }
      if (sql.includes("INSERT INTO challenges")) {
        return makePreparedStatement({
          runResult: { success: true, meta: { last_row_id: 100 }, results: [] },
          firstResult: CHALLENGE_ROW,
        });
      }
      if (sql.includes("SELECT * FROM challenges")) {
        return makePreparedStatement({ firstResult: CHALLENGE_ROW });
      }
      return makePreparedStatement({ firstResult: null });
    });

    const { app, env } = makeTestApp(dbMulti);

    const markdownText = "# 英語学習\n- Anki 30分\n- 単語帳 20分";
    const payload: SlackInteractionPayload = {
      type: "view_submission",
      trigger_id: "T123",
      user: { id: "U123", username: "testuser", name: "testuser" },
      view: {
        id: "V123",
        callback_id: "modal_new_project_markdown",
        state: {
          values: {
            input_markdown_text: {
              input_markdown_text: { type: "plain_text_input", value: markdownText },
            },
          },
        },
      },
    };

    const res = await app.request("/test/new-markdown-submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }, env);

    expect(res.status).toBe(200);
    // Verify project and challenges were created
    const prepareMock = dbMulti.prepare as ReturnType<typeof vi.fn>;
    const insertProjectCall = prepareMock.mock.calls.find(
      (args: unknown[]) => (args[0] as string).includes("INSERT INTO projects"),
    );
    expect(insertProjectCall).toBeDefined();
    const insertChallengeCalls = prepareMock.mock.calls.filter(
      (args: unknown[]) => (args[0] as string).includes("INSERT INTO challenges"),
    );
    expect(insertChallengeCalls.length).toBe(2);
  });
});
