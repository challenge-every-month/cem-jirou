import { describe, it, expect } from "vitest";
import type { UserRow, ProjectRow, ChallengeRow, ProjectWithChallenges } from "../../src/types";
import {
  buildPublishMessage,
  buildMidMonthMessage,
  buildMonthEndMessage,
} from "../../src/views/channel-messages";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const USER: UserRow = {
  id: 1,
  slack_user_id: "U123",
  user_name: "testuser",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const PROJECT: ProjectRow = {
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

function makeChallenge(overrides: Partial<ChallengeRow> = {}): ChallengeRow {
  return {
    id: 100,
    project_id: 10,
    name: "Anki 30分",
    status: "not_started",
    due_on: null,
    progress_comment: null,
    review_comment: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

// ─── buildPublishMessage ─────────────────────────────────────────────────────

describe("buildPublishMessage", () => {
  it("returns a SlackPostMessageRequest with text and blocks", () => {
    const challenges: ChallengeRow[] = [
      makeChallenge({ id: 100, name: "Anki 30分", status: "not_started" }),
      makeChallenge({ id: 101, name: "単語帳", status: "in_progress" }),
    ];
    const msg = buildPublishMessage(USER, PROJECT, challenges);

    expect(msg.text).toBeTruthy();
    expect(Array.isArray(msg.blocks)).toBe(true);
    expect((msg.blocks as unknown[]).length).toBeGreaterThan(0);
  });

  it("includes user name in the text", () => {
    const msg = buildPublishMessage(USER, PROJECT, []);
    expect(msg.text).toContain("testuser");
  });

  it("contains project title in blocks", () => {
    const msg = buildPublishMessage(USER, PROJECT, []);
    const blocksStr = JSON.stringify(msg.blocks);
    expect(blocksStr).toContain("英語学習");
  });

  it("shows not_started emoji ⬜ for not_started challenge", () => {
    const challenges = [makeChallenge({ status: "not_started", name: "Test" })];
    const msg = buildPublishMessage(USER, PROJECT, challenges);
    const blocksStr = JSON.stringify(msg.blocks);
    expect(blocksStr).toContain("⬜");
  });

  it("shows in_progress emoji 🔄 for in_progress challenge", () => {
    const challenges = [makeChallenge({ status: "in_progress", name: "Test" })];
    const msg = buildPublishMessage(USER, PROJECT, challenges);
    const blocksStr = JSON.stringify(msg.blocks);
    expect(blocksStr).toContain("🔄");
  });

  it("shows completed emoji ✅ for completed challenge", () => {
    const challenges = [makeChallenge({ status: "completed", name: "Test" })];
    const msg = buildPublishMessage(USER, PROJECT, challenges);
    const blocksStr = JSON.stringify(msg.blocks);
    expect(blocksStr).toContain("✅");
  });

  it("shows incompleted emoji ❌ for incompleted challenge", () => {
    const challenges = [makeChallenge({ status: "incompleted", name: "Test" })];
    const msg = buildPublishMessage(USER, PROJECT, challenges);
    const blocksStr = JSON.stringify(msg.blocks);
    expect(blocksStr).toContain("❌");
  });

  it("shows draft emoji 📝 for draft challenge", () => {
    const challenges = [makeChallenge({ status: "draft", name: "Test" })];
    const msg = buildPublishMessage(USER, PROJECT, challenges);
    const blocksStr = JSON.stringify(msg.blocks);
    expect(blocksStr).toContain("📝");
  });

  it("shows due_on date when set", () => {
    const challenges = [makeChallenge({ due_on: "2026-03-31" })];
    const msg = buildPublishMessage(USER, PROJECT, challenges);
    const blocksStr = JSON.stringify(msg.blocks);
    expect(blocksStr).toContain("2026-03-31");
  });

  it("shows placeholder message when no challenges", () => {
    const msg = buildPublishMessage(USER, PROJECT, []);
    const blocksStr = JSON.stringify(msg.blocks);
    expect(blocksStr).toContain("チャレンジなし");
  });
});

// ─── buildMidMonthMessage ────────────────────────────────────────────────────

describe("buildMidMonthMessage", () => {
  it("returns a SlackPostMessageRequest", () => {
    const msg = buildMidMonthMessage([], 2026, 3);
    expect(msg.text).toBeTruthy();
    expect(Array.isArray(msg.blocks)).toBe(true);
  });

  it("includes year and month in the text", () => {
    const msg = buildMidMonthMessage([], 2026, 3);
    expect(msg.text).toContain("2026");
    expect(msg.text).toContain("3");
  });

  it("shows placeholder when no published projects", () => {
    const msg = buildMidMonthMessage([], 2026, 3);
    const blocksStr = JSON.stringify(msg.blocks);
    expect(blocksStr).toContain("公開中のプロジェクトはありません");
  });

  it("excludes draft projects", () => {
    const draftProject: ProjectWithChallenges = {
      ...PROJECT,
      status: "draft",
      challenges: [makeChallenge()],
    };
    const msg = buildMidMonthMessage([draftProject], 2026, 3);
    const blocksStr = JSON.stringify(msg.blocks);
    expect(blocksStr).toContain("公開中のプロジェクトはありません");
  });

  it("shows progress counts for published projects", () => {
    const project: ProjectWithChallenges = {
      ...PROJECT,
      status: "published",
      challenges: [
        makeChallenge({ id: 100, status: "completed" }),
        makeChallenge({ id: 101, status: "not_started" }),
      ],
    };
    const msg = buildMidMonthMessage([project], 2026, 3);
    const blocksStr = JSON.stringify(msg.blocks);
    expect(blocksStr).toContain("1/2");
  });

  it("shows reviewed projects too (not just published)", () => {
    const reviewedProject: ProjectWithChallenges = {
      ...PROJECT,
      status: "reviewed",
      challenges: [makeChallenge({ status: "completed" })],
    };
    const msg = buildMidMonthMessage([reviewedProject], 2026, 3);
    const blocksStr = JSON.stringify(msg.blocks);
    expect(blocksStr).not.toContain("公開中のプロジェクトはありません");
    expect(blocksStr).toContain("英語学習");
  });
});

// ─── buildMonthEndMessage ────────────────────────────────────────────────────

describe("buildMonthEndMessage", () => {
  it("returns a SlackPostMessageRequest", () => {
    const msg = buildMonthEndMessage([], 2026, 3);
    expect(msg.text).toBeTruthy();
    expect(Array.isArray(msg.blocks)).toBe(true);
  });

  it("includes year and month in blocks header", () => {
    const msg = buildMonthEndMessage([], 2026, 3);
    const blocksStr = JSON.stringify(msg.blocks);
    expect(blocksStr).toContain("2026");
    expect(blocksStr).toContain("月末振り返り");
  });

  it("shows placeholder when no published projects", () => {
    const msg = buildMonthEndMessage([], 2026, 3);
    const blocksStr = JSON.stringify(msg.blocks);
    expect(blocksStr).toContain("公開中のプロジェクトはありません");
  });

  it("shows final result counts", () => {
    const project: ProjectWithChallenges = {
      ...PROJECT,
      status: "published",
      challenges: [
        makeChallenge({ id: 100, status: "completed" }),
        makeChallenge({ id: 101, status: "completed" }),
        makeChallenge({ id: 102, status: "incompleted" }),
      ],
    };
    const msg = buildMonthEndMessage([project], 2026, 3);
    const blocksStr = JSON.stringify(msg.blocks);
    expect(blocksStr).toContain("2/3");
  });

  it("mentions /cem_review command in blocks", () => {
    const msg = buildMonthEndMessage([], 2026, 3);
    const blocksStr = JSON.stringify(msg.blocks);
    expect(blocksStr).toContain("/cem_review");
  });
});
