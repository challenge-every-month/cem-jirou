import type {
  D1Database,
  D1PreparedStatement,
} from "@cloudflare/workers-types";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { commandRouter } from "../../src/routes/commands";
import type {
  Env,
  HonoEnv,
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

import { postEphemeral } from "../../src/utils/slack-api";

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
  (stmt as unknown as { all: ReturnType<typeof vi.fn> }).all.mockResolvedValue({
    results: [],
  });

  return stmt;
}

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

function makeDb(): D1Database {
  return {
    prepare: vi.fn().mockImplementation((sql: string) => {
      if (sql.includes("user_preferences")) {
        return makePreparedStatement({ firstResult: PREFS_ROW });
      }
      return makePreparedStatement({ firstResult: USER_ROW });
    }),
    exec: vi.fn(),
    batch: vi.fn(),
    dump: vi.fn(),
  } as unknown as D1Database;
}

// ---------------------------------------------------------------------------
// Test app factory
// ---------------------------------------------------------------------------

function makeTestApp() {
  const app = new Hono<HonoEnv>();

  // Inject rawBody into context before routing (simulates middleware)
  app.use("/slack/commands", async (c, next) => {
    const body = await c.req.text();
    c.set("rawBody" as never, body as never);
    await next();
  });

  app.post("/slack/commands", commandRouter);
  return app;
}

function makeEnv(): Env {
  return {
    DB: makeDb(),
    SLACK_BOT_TOKEN: "xoxb-test",
    SLACK_SIGNING_SECRET: "secret",
    SLACK_POST_CHANNEL_ID: "C123",
  };
}

function makeFormBody(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("commandRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ephemeral 'Unknown command' for an unrecognised command", async () => {
    const app = makeTestApp();
    const body = makeFormBody({ command: "/unknown", text: "" });

    const res = await app.request(
      "/slack/commands",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      },
      makeEnv(),
    );

    expect(res.status).toBe(200);
    const data = (await res.json()) as { response_type: string; text: string };
    expect(data.response_type).toBe("ephemeral");
    expect(data.text).toContain("Unknown command");
  });

  it("returns 200 for /cem_new", async () => {
    const app = makeTestApp();
    const body = makeFormBody({
      command: "/cem_new",
      text: "",
      user_id: "U123",
      user_name: "testuser",
      trigger_id: "T123",
    });

    const res = await app.request(
      "/slack/commands",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      },
      makeEnv(),
    );

    expect(res.status).toBe(200);
  });

  it("returns 200 for /cem_settings", async () => {
    const app = makeTestApp();
    const body = makeFormBody({
      command: "/cem_settings",
      text: "",
      user_id: "U123",
      user_name: "testuser",
      trigger_id: "T123",
    });

    const res = await app.request(
      "/slack/commands",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      },
      makeEnv(),
    );

    expect(res.status).toBe(200);
  });

  it("returns 200 for /cem_publish", async () => {
    const app = makeTestApp();
    const body = makeFormBody({
      command: "/cem_publish",
      text: "",
      user_id: "U123",
      user_name: "testuser",
      channel_id: "C123",
    });

    const res = await app.request(
      "/slack/commands",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      },
      makeEnv(),
    );

    expect(res.status).toBe(200);
  });

  it("returns 200 for /cem_progress", async () => {
    const app = makeTestApp();
    const body = makeFormBody({
      command: "/cem_progress",
      text: "",
      user_id: "U123",
      user_name: "testuser",
      trigger_id: "T123",
      channel_id: "C123",
    });

    const res = await app.request(
      "/slack/commands",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      },
      makeEnv(),
    );

    expect(res.status).toBe(200);
  });

  it("returns 200 for /cem_review", async () => {
    const app = makeTestApp();
    const body = makeFormBody({
      command: "/cem_review",
      text: "",
      user_id: "U123",
      user_name: "testuser",
      trigger_id: "T123",
      channel_id: "C123",
    });

    const res = await app.request(
      "/slack/commands",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      },
      makeEnv(),
    );

    expect(res.status).toBe(200);
  });

  it("returns 200 and sends ephemeral for /cem_edit", async () => {
    const app = makeTestApp();
    const body = makeFormBody({
      command: "/cem_edit",
      text: "",
      user_id: "U123",
      user_name: "testuser",
      channel_id: "C123",
    });

    const res = await app.request(
      "/slack/commands",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      },
      makeEnv(),
    );

    expect(res.status).toBe(200);
    expect(postEphemeral).toHaveBeenCalledOnce();
    const [, , , text] = (postEphemeral as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, string, string, string];
    expect(text).toContain("App Home");
  });

  it("returns 200 and sends ephemeral for /cem_delete", async () => {
    const app = makeTestApp();
    const body = makeFormBody({
      command: "/cem_delete",
      text: "",
      user_id: "U123",
      user_name: "testuser",
      channel_id: "C123",
    });

    const res = await app.request(
      "/slack/commands",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      },
      makeEnv(),
    );

    expect(res.status).toBe(200);
    expect(postEphemeral).toHaveBeenCalledOnce();
    const [, , , text] = (postEphemeral as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, string, string, string];
    expect(text).toContain("App Home");
  });
});
