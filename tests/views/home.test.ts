import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import type { UserRow, UserPreferencesRow, ProjectWithChallenges, ChallengeRow } from "../../src/types";
import {
  resolveDisplayMonth,
  isCurrentOrFutureMonth,
  buildHomeView,
  buildErrorView,
} from "../../src/views/home";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const USER: UserRow = {
  id: 1,
  slack_user_id: "U123",
  user_name: "testuser",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function makePrefs(overrides: Partial<UserPreferencesRow> = {}): UserPreferencesRow {
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

function makeChallenge(overrides: Partial<ChallengeRow> = {}): ChallengeRow {
  return {
    id: 1,
    project_id: 10,
    name: "テストチャレンジ",
    status: "not_started",
    due_on: null,
    progress_comment: null,
    review_comment: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeProject(overrides: Partial<ProjectWithChallenges> = {}): ProjectWithChallenges {
  return {
    id: 10,
    user_id: 1,
    title: "テストプロジェクト",
    year: 2026,
    month: 3,
    status: "draft",
    is_inbox: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    challenges: [],
    ...overrides,
  };
}

// ─── Helper: flatten all blocks to JSON string for easy assertion ─────────────

function blocksJson(view: { blocks: unknown[] }): string {
  return JSON.stringify(view.blocks);
}

// ─── resolveDisplayMonth ─────────────────────────────────────────────────────

describe("resolveDisplayMonth", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns current UTC year/month when viewed_year and viewed_month are null", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T12:00:00Z"));

    const result = resolveDisplayMonth(makePrefs({ viewed_year: null, viewed_month: null }));
    expect(result).toEqual({ year: 2026, month: 3 });
  });

  it("returns set values when viewed_year and viewed_month are set", () => {
    const result = resolveDisplayMonth(makePrefs({ viewed_year: 2025, viewed_month: 11 }));
    expect(result).toEqual({ year: 2025, month: 11 });
  });

  it("uses current year when only viewed_year is null", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T12:00:00Z"));

    const result = resolveDisplayMonth(makePrefs({ viewed_year: null, viewed_month: 7 }));
    expect(result.year).toBe(2026);
    expect(result.month).toBe(7);
  });
});

// ─── isCurrentOrFutureMonth ──────────────────────────────────────────────────

describe("isCurrentOrFutureMonth", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T12:00:00Z")); // current = 2026-03
  });

  it("returns true for a future year", () => {
    expect(isCurrentOrFutureMonth(2027, 1)).toBe(true);
  });

  it("returns false for a past year", () => {
    expect(isCurrentOrFutureMonth(2025, 12)).toBe(false);
  });

  it("returns true for current year and a future month", () => {
    expect(isCurrentOrFutureMonth(2026, 4)).toBe(true);
  });

  it("returns true for current year and current month", () => {
    expect(isCurrentOrFutureMonth(2026, 3)).toBe(true);
  });

  it("returns false for current year and a past month", () => {
    expect(isCurrentOrFutureMonth(2026, 2)).toBe(false);
  });
});

// ─── buildHomeView ───────────────────────────────────────────────────────────

describe("buildHomeView", () => {
  it("shows empty state when there are no projects", () => {
    const view = buildHomeView(USER, makePrefs(), [], 2026, 3);
    expect(blocksJson(view)).toContain("まだチャレンジがありません");
  });

  it("shows draft badge 🟡 for draft project", () => {
    const project = makeProject({ status: "draft" });
    const view = buildHomeView(USER, makePrefs(), [project], 2026, 3);
    expect(blocksJson(view)).toContain("🟡");
  });

  it("shows published badge 🟢 for published project", () => {
    const project = makeProject({ status: "published" });
    const view = buildHomeView(USER, makePrefs(), [project], 2026, 3);
    expect(blocksJson(view)).toContain("🟢");
  });

  it("shows reviewed badge ✅ for reviewed project header", () => {
    const project = makeProject({ status: "reviewed" });
    const view = buildHomeView(USER, makePrefs(), [project], 2026, 3);
    // header block should contain ✅ テストプロジェクト
    const headerBlock = (view.blocks as Array<{ type: string; text?: { text: string } }>).find(
      (b) => b.type === "header",
    );
    expect(headerBlock?.text?.text).toContain("✅");
  });

  it("shows edit and delete buttons for non-reviewed project", () => {
    const project = makeProject({ status: "draft" });
    const view = buildHomeView(USER, makePrefs(), [project], 2026, 3);
    const json = blocksJson(view);
    expect(json).toContain("home_open_edit_project");
    expect(json).toContain("home_confirm_delete_project");
  });

  it("does NOT show edit and delete buttons for reviewed project", () => {
    const project = makeProject({ status: "reviewed" });
    const view = buildHomeView(USER, makePrefs(), [project], 2026, 3);
    const json = blocksJson(view);
    expect(json).not.toContain("home_open_edit_project");
    expect(json).not.toContain("home_confirm_delete_project");
  });

  it("shows 🔴 icon and status buttons for not_started challenge", () => {
    const ch = makeChallenge({ status: "not_started" });
    const project = makeProject({ challenges: [ch] });
    const view = buildHomeView(USER, makePrefs(), [project], 2026, 3);
    const json = blocksJson(view);
    expect(json).toContain("🔴");
    expect(json).toContain("challenge_set_not_started");
    expect(json).toContain("challenge_set_in_progress");
    expect(json).toContain("challenge_set_completed");
  });

  it("shows 🔵 icon and status buttons for in_progress challenge", () => {
    const ch = makeChallenge({ status: "in_progress" });
    const project = makeProject({ challenges: [ch] });
    const view = buildHomeView(USER, makePrefs(), [project], 2026, 3);
    const json = blocksJson(view);
    expect(json).toContain("🔵");
    expect(json).toContain("challenge_set_completed");
  });

  it("shows ✅ icon and NO status buttons for completed challenge", () => {
    const ch = makeChallenge({ id: 99, status: "completed" });
    const project = makeProject({ challenges: [ch] });
    const view = buildHomeView(USER, makePrefs(), [project], 2026, 3);
    const json = blocksJson(view);
    // The challenge section text should have ✅
    expect(json).toContain("✅");
    // No status action buttons
    expect(json).not.toContain("challenge_set_not_started");
    expect(json).not.toContain("challenge_set_in_progress");
    expect(json).not.toContain("challenge_set_completed");
  });

  it("shows 📋 振り返りを完了する when all challenges done and project is published", () => {
    const challenges = [
      makeChallenge({ id: 1, status: "completed" }),
      makeChallenge({ id: 2, status: "incompleted" }),
    ];
    const project = makeProject({ status: "published", challenges });
    const view = buildHomeView(USER, makePrefs(), [project], 2026, 3);
    expect(blocksJson(view)).toContain("home_review_complete");
    expect(blocksJson(view)).toContain("振り返りを完了する");
  });

  it("does NOT show 📋 振り返りを完了する when not all challenges are done", () => {
    const challenges = [
      makeChallenge({ id: 1, status: "completed" }),
      makeChallenge({ id: 2, status: "in_progress" }),
    ];
    const project = makeProject({ status: "published", challenges });
    const view = buildHomeView(USER, makePrefs(), [project], 2026, 3);
    expect(blocksJson(view)).not.toContain("home_review_complete");
  });

  it("footer always has ⚙️ 設定 button", () => {
    const view = buildHomeView(USER, makePrefs(), [], 2026, 3);
    expect(blocksJson(view)).toContain("home_open_settings");
    expect(blocksJson(view)).toContain("設定");
  });

  it("footer has 📣 今月を宣言する only when a draft project exists", () => {
    const draftProject = makeProject({ status: "draft" });
    const viewWithDraft = buildHomeView(USER, makePrefs(), [draftProject], 2026, 3);
    expect(blocksJson(viewWithDraft)).toContain("home_publish");
    expect(blocksJson(viewWithDraft)).toContain("今月を宣言する");

    const publishedProject = makeProject({ status: "published" });
    const viewNoDraft = buildHomeView(USER, makePrefs(), [publishedProject], 2026, 3);
    expect(blocksJson(viewNoDraft)).not.toContain("home_publish");
  });

  it("footer does NOT have 📣 today月を宣言する when no draft projects", () => {
    const view = buildHomeView(USER, makePrefs(), [], 2026, 3);
    expect(blocksJson(view)).not.toContain("home_publish");
  });
});

// ─── buildErrorView ──────────────────────────────────────────────────────────

describe("buildErrorView", () => {
  it("returns type home with error message in blocks", () => {
    const view = buildErrorView("Something went wrong");
    expect(view.type).toBe("home");
    expect(blocksJson(view)).toContain("Something went wrong");
    expect(blocksJson(view)).toContain("⚠️");
  });
});
