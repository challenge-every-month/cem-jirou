import { describe, it, expect, vi, beforeEach } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import type { Env } from "../../src/types";
import { handleScheduled } from "../../src/handlers/scheduled";

// ─── Mock slack-api ──────────────────────────────────────────────────────────

vi.mock("../../src/utils/slack-api", () => ({
  postMessage: vi.fn().mockResolvedValue(undefined),
  postDm: vi.fn().mockResolvedValue(undefined),
  postEphemeral: vi.fn().mockResolvedValue(undefined),
  openModal: vi.fn().mockResolvedValue(undefined),
  publishHome: vi.fn().mockResolvedValue(undefined),
  slackPost: vi.fn().mockResolvedValue({ ok: true }),
}));

import { postMessage, postDm } from "../../src/utils/slack-api";

// ─── D1 Mock Helpers ──────────────────────────────────────────────────────────

function makeD1Mock(opts: {
  allResults?: Record<string, unknown>[];
  firstResult?: Record<string, unknown> | null;
} = {}): D1Database {
  const mockAll = vi.fn().mockResolvedValue({ results: opts.allResults ?? [] });
  const mockFirst = vi.fn().mockResolvedValue(opts.firstResult ?? null);
  const mockRun = vi.fn().mockResolvedValue({ success: true });
  const mockBind = vi.fn().mockReturnValue({ run: mockRun, first: mockFirst, all: mockAll });
  const mockPrepare = vi.fn().mockReturnValue({ bind: mockBind });

  return {
    prepare: mockPrepare,
    exec: vi.fn(),
    batch: vi.fn(),
    dump: vi.fn(),
  } as unknown as D1Database;
}

function makeD1MockWithImpl(
  prepareImpl: (sql: string) => {
    bind: (...args: unknown[]) => {
      all: () => Promise<{ results: unknown[] }>;
      first: () => Promise<unknown>;
      run: () => Promise<{ success: boolean }>;
    };
  },
): D1Database {
  return {
    prepare: vi.fn().mockImplementation(prepareImpl),
    exec: vi.fn(),
    batch: vi.fn(),
    dump: vi.fn(),
  } as unknown as D1Database;
}

// ─── Mock Env ─────────────────────────────────────────────────────────────────

function makeEnv(db: D1Database): Env {
  return {
    DB: db,
    SLACK_BOT_TOKEN: "xoxb-test",
    SLACK_POST_CHANNEL_ID: "C123",
    SLACK_SIGNING_SECRET: "test-secret",
  };
}

function makeScheduledEvent(cron: string): ScheduledEvent {
  return {
    cron,
    scheduledTime: Date.now(),
    type: "scheduled",
    waitUntil: vi.fn(),
  } as unknown as ScheduledEvent;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("handleScheduled", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Month-start channel post ──────────────────────────────────────────────

  describe("0 0 1 * * (month-start channel)", () => {
    it("posts a month-start announcement to the channel", async () => {
      const db = makeD1Mock();
      const env = makeEnv(db);
      const event = makeScheduledEvent("0 0 1 * *");

      await handleScheduled(event, env);

      expect(postMessage).toHaveBeenCalledOnce();
      const [token, channel] = (postMessage as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        string,
        string,
        unknown[],
      ];
      expect(token).toBe("xoxb-test");
      expect(channel).toBe("C123");
    });

    it("includes '新月チャレンジ開始' in the message text", async () => {
      const db = makeD1Mock();
      const env = makeEnv(db);
      const event = makeScheduledEvent("0 0 1 * *");

      await handleScheduled(event, env);

      const [, , text] = (postMessage as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        string,
        string,
      ];
      expect(text).toContain("新月チャレンジ開始");
    });
  });

  // ── Month-start personal DM ───────────────────────────────────────────────

  describe("0 1 1 * * (month-start DM)", () => {
    it("sends no DMs when no users have personal_reminder enabled", async () => {
      const db = makeD1Mock({ allResults: [] });
      const env = makeEnv(db);
      const event = makeScheduledEvent("0 1 1 * *");

      await handleScheduled(event, env);

      expect(postDm).not.toHaveBeenCalled();
    });

    it("sends DM to each user with personal_reminder = 1", async () => {
      const db = makeD1Mock({
        allResults: [
          { slack_user_id: "U001" },
          { slack_user_id: "U002" },
        ],
      });
      const env = makeEnv(db);
      const event = makeScheduledEvent("0 1 1 * *");

      await handleScheduled(event, env);

      expect(postDm).toHaveBeenCalledTimes(2);
      const calls = (postDm as ReturnType<typeof vi.fn>).mock.calls as [string, string, string][];
      expect(calls[0][1]).toBe("U001");
      expect(calls[1][1]).toBe("U002");
    });

    it("includes reminder text in DM", async () => {
      const db = makeD1Mock({
        allResults: [{ slack_user_id: "U001" }],
      });
      const env = makeEnv(db);
      const event = makeScheduledEvent("0 1 1 * *");

      await handleScheduled(event, env);

      const [, , text] = (postDm as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string, string];
      expect(text).toContain("今月のチャレンジを登録しましょう");
    });
  });

  // ── Mid-month channel post ────────────────────────────────────────────────

  describe("0 0 15 * * (mid-month channel)", () => {
    it("posts mid-month message to channel when no projects exist", async () => {
      const db = makeD1Mock({ allResults: [] });
      const env = makeEnv(db);
      const event = makeScheduledEvent("0 0 15 * *");

      await handleScheduled(event, env);

      expect(postMessage).toHaveBeenCalledOnce();
      const [token, channel] = (postMessage as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        string,
        string,
      ];
      expect(token).toBe("xoxb-test");
      expect(channel).toBe("C123");
    });

    it("posts mid-month message with published projects", async () => {
      const db = makeD1MockWithImpl((sql: string) => {
        const mockAll = vi.fn();
        const mockFirst = vi.fn().mockResolvedValue(null);
        const mockRun = vi.fn().mockResolvedValue({ success: true });

        if (sql.includes("FROM projects p") && sql.includes("JOIN users u")) {
          mockAll.mockResolvedValue({
            results: [
              {
                id: 10,
                user_id: 1,
                title: "英語学習",
                year: 2026,
                month: 3,
                status: "published",
                is_inbox: 0,
                user_name: "testuser",
                slack_user_id: "U001",
                created_at: "2026-01-01",
                updated_at: "2026-01-01",
              },
            ],
          });
        } else if (sql.includes("FROM challenges")) {
          mockAll.mockResolvedValue({
            results: [
              {
                id: 100,
                project_id: 10,
                name: "Anki 30分",
                status: "in_progress",
                due_on: null,
                progress_comment: null,
                review_comment: null,
                created_at: "2026-01-01",
                updated_at: "2026-01-01",
              },
            ],
          });
        } else {
          mockAll.mockResolvedValue({ results: [] });
        }

        const mockBind = vi.fn().mockReturnValue({ run: mockRun, first: mockFirst, all: mockAll });
        return { bind: mockBind };
      });
      const env = makeEnv(db);
      const event = makeScheduledEvent("0 0 15 * *");

      await handleScheduled(event, env);

      expect(postMessage).toHaveBeenCalledOnce();
    });
  });

  // ── Month-end channel post ────────────────────────────────────────────────

  describe("0 0 25 * * (month-end channel)", () => {
    it("posts month-end message to channel", async () => {
      const db = makeD1Mock({ allResults: [] });
      const env = makeEnv(db);
      const event = makeScheduledEvent("0 0 25 * *");

      await handleScheduled(event, env);

      expect(postMessage).toHaveBeenCalledOnce();
      const [, channel] = (postMessage as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        string,
      ];
      expect(channel).toBe("C123");
    });
  });

  // ── Month-end personal DM ─────────────────────────────────────────────────

  describe("0 1 25 * * (month-end DM)", () => {
    it("sends no DMs when no users have personal_reminder enabled", async () => {
      const db = makeD1Mock({ allResults: [] });
      const env = makeEnv(db);
      const event = makeScheduledEvent("0 1 25 * *");

      await handleScheduled(event, env);

      expect(postDm).not.toHaveBeenCalled();
    });

    it("sends month-end reminder DM to each user with personal_reminder = 1", async () => {
      const db = makeD1MockWithImpl((sql: string) => {
        const mockFirst = vi.fn();
        const mockRun = vi.fn().mockResolvedValue({ success: true });
        const mockAll = vi.fn();

        if (sql.includes("personal_reminder")) {
          // Return 2 users with reminder enabled
          mockAll.mockResolvedValue({
            results: [{ slack_user_id: "U001" }, { slack_user_id: "U002" }],
          });
        } else if (sql.includes("FROM users WHERE slack_user_id")) {
          // Return user row for published project query
          mockFirst.mockResolvedValue({
            id: 1,
            slack_user_id: "U001",
            user_name: "testuser",
          });
          mockAll.mockResolvedValue({ results: [] });
        } else {
          mockFirst.mockResolvedValue(null);
          mockAll.mockResolvedValue({ results: [] });
        }

        const mockBind = vi.fn().mockReturnValue({ run: mockRun, first: mockFirst, all: mockAll });
        return { bind: mockBind };
      });
      const env = makeEnv(db);
      const event = makeScheduledEvent("0 1 25 * *");

      await handleScheduled(event, env);

      // At least 2 DMs sent (one per user for the base reminder)
      expect(postDm).toHaveBeenCalledTimes(2);
    });

    it("includes vibration reminder text in DM", async () => {
      const db = makeD1MockWithImpl((sql: string) => {
        const mockFirst = vi.fn().mockResolvedValue(null);
        const mockRun = vi.fn().mockResolvedValue({ success: true });
        const mockAll = vi.fn();

        if (sql.includes("personal_reminder")) {
          mockAll.mockResolvedValue({ results: [{ slack_user_id: "U001" }] });
        } else {
          mockAll.mockResolvedValue({ results: [] });
        }

        const mockBind = vi.fn().mockReturnValue({ run: mockRun, first: mockFirst, all: mockAll });
        return { bind: mockBind };
      });
      const env = makeEnv(db);
      const event = makeScheduledEvent("0 1 25 * *");

      await handleScheduled(event, env);

      const [, , text] = (postDm as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string, string];
      expect(text).toContain("振り返り");
    });

    it("sends progress summary DM when user has published projects (TASK-702)", async () => {
      const db = makeD1MockWithImpl((sql: string) => {
        const mockFirst = vi.fn();
        const mockRun = vi.fn().mockResolvedValue({ success: true });
        const mockAll = vi.fn();

        if (sql.includes("personal_reminder")) {
          mockAll.mockResolvedValue({ results: [{ slack_user_id: "U001" }] });
        } else if (sql.includes("FROM users WHERE slack_user_id")) {
          mockFirst.mockResolvedValue({ id: 1, slack_user_id: "U001", user_name: "testuser" });
          mockAll.mockResolvedValue({ results: [] });
        } else if (sql.includes("FROM projects") && !sql.includes("JOIN")) {
          mockAll.mockResolvedValue({
            results: [
              {
                id: 10,
                user_id: 1,
                title: "英語学習",
                year: 2026,
                month: 3,
                status: "published",
                is_inbox: 0,
                created_at: "2026-01-01",
                updated_at: "2026-01-01",
              },
            ],
          });
        } else if (sql.includes("FROM challenges")) {
          mockAll.mockResolvedValue({
            results: [
              {
                id: 100,
                project_id: 10,
                name: "Anki 30分",
                status: "completed",
                due_on: null,
                progress_comment: null,
                review_comment: null,
                created_at: "2026-01-01",
                updated_at: "2026-01-01",
              },
            ],
          });
        } else {
          mockFirst.mockResolvedValue(null);
          mockAll.mockResolvedValue({ results: [] });
        }

        const mockBind = vi.fn().mockReturnValue({ run: mockRun, first: mockFirst, all: mockAll });
        return { bind: mockBind };
      });
      const env = makeEnv(db);
      const event = makeScheduledEvent("0 1 25 * *");

      await handleScheduled(event, env);

      // Should send 2 DMs: base reminder + progress summary
      expect(postDm).toHaveBeenCalledTimes(2);
      const calls = (postDm as ReturnType<typeof vi.fn>).mock.calls as [string, string, string][];
      const summaryCall = calls.find(([, , text]) => text.includes("進捗まとめ"));
      expect(summaryCall).toBeDefined();
      expect(summaryCall![2]).toContain("英語学習");
      expect(summaryCall![2]).toContain("1/1");
    });
  });

  // ── Due-date check ────────────────────────────────────────────────────────

  describe("0 0 * * * (due-date check)", () => {
    it("sends no DMs when no challenges are due today", async () => {
      const db = makeD1Mock({ allResults: [] });
      const env = makeEnv(db);
      const event = makeScheduledEvent("0 0 * * *");

      await handleScheduled(event, env);

      expect(postDm).not.toHaveBeenCalled();
    });

    it("sends DM for each due challenge", async () => {
      const db = makeD1MockWithImpl((sql: string) => {
        const mockFirst = vi.fn();
        const mockRun = vi.fn().mockResolvedValue({ success: true });
        const mockAll = vi.fn();

        if (sql.includes("due_on") && sql.includes("NOT IN")) {
          mockAll.mockResolvedValue({
            results: [
              {
                id: 1,
                project_id: 10,
                name: "Anki 30分",
                status: "in_progress",
                due_on: "2026-03-22",
                progress_comment: null,
                review_comment: null,
                user_id: 1,
                created_at: "2026-01-01",
                updated_at: "2026-01-01",
              },
              {
                id: 2,
                project_id: 10,
                name: "英語リスニング",
                status: "not_started",
                due_on: "2026-03-22",
                progress_comment: null,
                review_comment: null,
                user_id: 1,
                created_at: "2026-01-01",
                updated_at: "2026-01-01",
              },
            ],
          });
        } else if (sql.includes("FROM users WHERE id")) {
          mockFirst.mockResolvedValue({ slack_user_id: "U001" });
          mockAll.mockResolvedValue({ results: [] });
        } else {
          mockFirst.mockResolvedValue(null);
          mockAll.mockResolvedValue({ results: [] });
        }

        const mockBind = vi.fn().mockReturnValue({ run: mockRun, first: mockFirst, all: mockAll });
        return { bind: mockBind };
      });
      const env = makeEnv(db);
      const event = makeScheduledEvent("0 0 * * *");

      await handleScheduled(event, env);

      expect(postDm).toHaveBeenCalledTimes(2);
    });

    it("includes challenge name in due-date DM", async () => {
      const db = makeD1MockWithImpl((sql: string) => {
        const mockFirst = vi.fn();
        const mockRun = vi.fn().mockResolvedValue({ success: true });
        const mockAll = vi.fn();

        if (sql.includes("due_on") && sql.includes("NOT IN")) {
          mockAll.mockResolvedValue({
            results: [
              {
                id: 1,
                project_id: 10,
                name: "Anki 30分",
                status: "in_progress",
                due_on: "2026-03-22",
                progress_comment: null,
                review_comment: null,
                user_id: 1,
                created_at: "2026-01-01",
                updated_at: "2026-01-01",
              },
            ],
          });
        } else if (sql.includes("FROM users WHERE id")) {
          mockFirst.mockResolvedValue({ slack_user_id: "U001" });
          mockAll.mockResolvedValue({ results: [] });
        } else {
          mockFirst.mockResolvedValue(null);
          mockAll.mockResolvedValue({ results: [] });
        }

        const mockBind = vi.fn().mockReturnValue({ run: mockRun, first: mockFirst, all: mockAll });
        return { bind: mockBind };
      });
      const env = makeEnv(db);
      const event = makeScheduledEvent("0 0 * * *");

      await handleScheduled(event, env);

      const [, , text] = (postDm as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string, string];
      expect(text).toContain("本日が期日のチャレンジ");
      expect(text).toContain("Anki 30分");
    });
  });

  // ── Unknown cron ──────────────────────────────────────────────────────────

  describe("unknown cron", () => {
    it("does not throw for an unknown cron expression", async () => {
      const db = makeD1Mock();
      const env = makeEnv(db);
      const event = makeScheduledEvent("0 0 31 2 *");

      await expect(handleScheduled(event, env)).resolves.toBeUndefined();
      expect(postMessage).not.toHaveBeenCalled();
      expect(postDm).not.toHaveBeenCalled();
    });
  });
});
