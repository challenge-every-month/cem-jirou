import type {
  D1Database,
  D1PreparedStatement,
} from "@cloudflare/workers-types";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  handleCemSettings,
  handleSettingsSubmit,
} from "../../src/handlers/commands/cem-settings";
import type {
  Env,
  HonoEnv,
  SlackInteractionPayload,
  UserPreferencesRow,
  UserRow,
} from "../../src/types";

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

const USER_ROW: UserRow = {
  id: 1,
  slack_user_id: "U123",
  user_name: "testuser",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function makePrefsRow(
  overrides: Partial<UserPreferencesRow> = {},
): UserPreferencesRow {
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

// ---------------------------------------------------------------------------
// Test app factory
// ---------------------------------------------------------------------------

function makeTestApp(db: D1Database, token = "xoxb-test") {
  const app = new Hono<HonoEnv>();

  app.post("/test/cem-settings", async (c) => {
    const rawBody = await c.req.text();
    const params = new URLSearchParams(rawBody);
    return handleCemSettings(c, params);
  });

  app.post("/test/settings-submit", async (c) => {
    const rawBody = await c.req.text();
    const payload = JSON.parse(rawBody) as SlackInteractionPayload;
    return handleSettingsSubmit(c, payload);
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

describe("handleCemSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens settings modal with callback_id: modal_settings", async () => {
    const prefs = makePrefsRow({ markdown_mode: 0, personal_reminder: 0 });
    const db = makeDb((sql: string) => {
      if (sql.includes("user_preferences")) {
        return makePreparedStatement({ firstResult: prefs });
      }
      return makePreparedStatement({ firstResult: USER_ROW });
    });

    const { app, env } = makeTestApp(db);

    const body = new URLSearchParams({
      user_id: "U123",
      user_name: "testuser",
      trigger_id: "T123",
    }).toString();

    const res = await app.request(
      "/test/cem-settings",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(openModal).toHaveBeenCalledOnce();
    const [, triggerId, view] = (openModal as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, string, { callback_id: string }];
    expect(triggerId).toBe("T123");
    expect(view.callback_id).toBe("modal_settings");
  });

  it("initial_option reflects markdown_mode=1 when preference is ON", async () => {
    const prefs = makePrefsRow({ markdown_mode: 1, personal_reminder: 0 });
    const db = makeDb((sql: string) => {
      if (sql.includes("user_preferences")) {
        return makePreparedStatement({ firstResult: prefs });
      }
      return makePreparedStatement({ firstResult: USER_ROW });
    });

    const { app, env } = makeTestApp(db);

    const body = new URLSearchParams({
      user_id: "U123",
      user_name: "testuser",
      trigger_id: "T456",
    }).toString();

    const res = await app.request(
      "/test/cem-settings",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      },
      env,
    );

    expect(res.status).toBe(200);
    const [, , view] = (openModal as ReturnType<typeof vi.fn>).mock
      .calls[0] as [
      string,
      string,
      {
        blocks: Array<{
          block_id: string;
          element: { initial_option: { value: string } };
        }>;
      },
    ];
    const markdownBlock = view.blocks.find(
      (b) => b.block_id === "toggle_markdown_mode",
    );
    expect(markdownBlock?.element.initial_option.value).toBe("true");
  });

  it("initial_option reflects personal_reminder=1 when preference is ON", async () => {
    const prefs = makePrefsRow({ markdown_mode: 0, personal_reminder: 1 });
    const db = makeDb((sql: string) => {
      if (sql.includes("user_preferences")) {
        return makePreparedStatement({ firstResult: prefs });
      }
      return makePreparedStatement({ firstResult: USER_ROW });
    });

    const { app, env } = makeTestApp(db);

    const body = new URLSearchParams({
      user_id: "U123",
      user_name: "testuser",
      trigger_id: "T789",
    }).toString();

    await app.request(
      "/test/cem-settings",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      },
      env,
    );

    const [, , view] = (openModal as ReturnType<typeof vi.fn>).mock
      .calls[0] as [
      string,
      string,
      {
        blocks: Array<{
          block_id: string;
          element: { initial_option: { value: string } };
        }>;
      },
    ];
    const reminderBlock = view.blocks.find(
      (b) => b.block_id === "toggle_personal_reminder",
    );
    expect(reminderBlock?.element.initial_option.value).toBe("true");
  });
});

describe("handleSettingsSubmit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeSettingsPayload(
    markdownMode: string,
    personalReminder: string,
  ): SlackInteractionPayload {
    return {
      type: "view_submission",
      trigger_id: "T123",
      user: { id: "U123", username: "testuser", name: "testuser" },
      view: {
        id: "V123",
        callback_id: "modal_settings",
        state: {
          values: {
            toggle_markdown_mode: {
              toggle_markdown_mode: {
                type: "radio_buttons",
                selected_option: { value: markdownMode },
              },
            },
            toggle_personal_reminder: {
              toggle_personal_reminder: {
                type: "radio_buttons",
                selected_option: { value: personalReminder },
              },
            },
          },
        },
      },
    };
  }

  it("calls updatePreferences with markdown_mode=true when value is 'true'", async () => {
    const _prefs = makePrefsRow({ markdown_mode: 0, personal_reminder: 0 });
    const updatedPrefs = makePrefsRow({
      markdown_mode: 1,
      personal_reminder: 0,
    });

    const db = makeDb((sql: string) => {
      if (sql.includes("SELECT * FROM users")) {
        return makePreparedStatement({ firstResult: USER_ROW });
      }
      if (sql.startsWith("UPDATE user_preferences")) {
        return makePreparedStatement({
          runResult: { success: true, meta: { last_row_id: 1 }, results: [] },
        });
      }
      if (sql.includes("user_preferences")) {
        // Return updated prefs after update
        return makePreparedStatement({ firstResult: updatedPrefs });
      }
      return makePreparedStatement({ firstResult: USER_ROW });
    });

    const { app, env } = makeTestApp(db);
    const payload = makeSettingsPayload("true", "false");

    const res = await app.request(
      "/test/settings-submit",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      env,
    );

    expect(res.status).toBe(200);
    const prepareMock = db.prepare as ReturnType<typeof vi.fn>;
    const updateCall = prepareMock.mock.calls.find((args: unknown[]) =>
      (args[0] as string).startsWith("UPDATE user_preferences"),
    );
    expect(updateCall).toBeDefined();
    // The UPDATE SQL should set markdown_mode to 1 (true)
    const updateSql = (updateCall as unknown[])[0] as string;
    expect(updateSql).toContain("markdown_mode");
  });

  it("calls updatePreferences with personal_reminder=true when value is 'true'", async () => {
    const updatedPrefs = makePrefsRow({
      markdown_mode: 0,
      personal_reminder: 1,
    });

    const db = makeDb((sql: string) => {
      if (sql.includes("SELECT * FROM users")) {
        return makePreparedStatement({ firstResult: USER_ROW });
      }
      if (sql.startsWith("UPDATE user_preferences")) {
        return makePreparedStatement({
          runResult: { success: true, meta: { last_row_id: 1 }, results: [] },
        });
      }
      if (sql.includes("user_preferences")) {
        return makePreparedStatement({ firstResult: updatedPrefs });
      }
      return makePreparedStatement({ firstResult: USER_ROW });
    });

    const { app, env } = makeTestApp(db);
    const payload = makeSettingsPayload("false", "true");

    const res = await app.request(
      "/test/settings-submit",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      env,
    );

    expect(res.status).toBe(200);
    const prepareMock = db.prepare as ReturnType<typeof vi.fn>;
    const updateCall = prepareMock.mock.calls.find((args: unknown[]) =>
      (args[0] as string).startsWith("UPDATE user_preferences"),
    );
    expect(updateCall).toBeDefined();
    const updateSql = (updateCall as unknown[])[0] as string;
    expect(updateSql).toContain("personal_reminder");
  });
});
