import { describe, expect, it } from "vitest";
import {
  extractDueDate,
  parseMarkdownInput,
} from "../../src/utils/markdown-parser";

// ---------------------------------------------------------------------------
// extractDueDate
// ---------------------------------------------------------------------------

describe("extractDueDate", () => {
  it("parses @D (single digit day) relative to context year and month", () => {
    const result = extractDueDate("challenge @15", 2026, 3);
    expect(result.name).toBe("challenge");
    expect(result.due_on).toBe("2026-03-15");
  });

  it("parses @MM-DD relative to context year", () => {
    const result = extractDueDate("challenge @03-20", 2026, 3);
    expect(result.name).toBe("challenge");
    expect(result.due_on).toBe("2026-03-20");
  });

  it("parses @YYYY-MM-DD as an exact date", () => {
    const result = extractDueDate("challenge @2026-04-01", 2026, 3);
    expect(result.name).toBe("challenge");
    expect(result.due_on).toBe("2026-04-01");
  });

  it("returns due_on null when no @ notation is present", () => {
    const result = extractDueDate("challenge without date", 2026, 3);
    expect(result.name).toBe("challenge without date");
    expect(result.due_on).toBeNull();
  });

  it("strips the @... portion cleanly from the name", () => {
    const result = extractDueDate("Anki 30分 @15", 2026, 3);
    expect(result.name).toBe("Anki 30分");
    expect(result.due_on).toBe("2026-03-15");
  });

  it("pads single-digit day to 2 digits", () => {
    const result = extractDueDate("task @5", 2026, 3);
    expect(result.due_on).toBe("2026-03-05");
  });

  it("pads single-digit context month to 2 digits", () => {
    const result = extractDueDate("task @9", 2026, 1);
    expect(result.due_on).toBe("2026-01-09");
  });

  it("prefers full YYYY-MM-DD over shorter patterns", () => {
    // @2026-04-01 should match full date, not @04-01
    const result = extractDueDate("task @2026-04-01", 2026, 3);
    expect(result.due_on).toBe("2026-04-01");
  });
});

// ---------------------------------------------------------------------------
// parseMarkdownInput
// ---------------------------------------------------------------------------

describe("parseMarkdownInput", () => {
  it("parses a project with a challenge that has a day-only due date", () => {
    const input = "# タイトル\n- challenge @15";
    const result = parseMarkdownInput(input, 2026, 3);

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("タイトル");
    expect(result[0].challenges).toHaveLength(1);
    expect(result[0].challenges[0].name).toBe("challenge");
    expect(result[0].challenges[0].due_on).toBe("2026-03-15");
  });

  it("parses @MM-DD notation correctly", () => {
    const input = "# Project\n- Podcast 聴く @03-20";
    const result = parseMarkdownInput(input, 2026, 3);

    expect(result[0].challenges[0].due_on).toBe("2026-03-20");
  });

  it("parses @YYYY-MM-DD notation correctly", () => {
    const input = "# Project\n- 洋書読む @2026-04-01";
    const result = parseMarkdownInput(input, 2026, 3);

    expect(result[0].challenges[0].due_on).toBe("2026-04-01");
  });

  it("sends lines before any # header to inbox (title: null)", () => {
    const input = "- 筋トレ";
    const result = parseMarkdownInput(input, 2026, 3);

    expect(result).toHaveLength(1);
    expect(result[0].title).toBeNull();
    expect(result[0].challenges[0].name).toBe("筋トレ");
  });

  it("skips empty lines", () => {
    const input = "# Project\n\n- task1\n\n- task2\n\n";
    const result = parseMarkdownInput(input, 2026, 3);

    expect(result[0].challenges).toHaveLength(2);
  });

  it("parses multiple projects correctly", () => {
    // 筋トレ appears BEFORE any # header, so it goes to inbox (title: null)
    // Then # 英語学習 starts a named project
    const input = [
      "- 筋トレ",
      "",
      "# 英語学習",
      "- Anki 30分 @15",
      "- Podcast 聴く @03-20",
      "- 洋書読む @2026-03-31",
    ].join("\n");

    const result = parseMarkdownInput(input, 2026, 3);

    expect(result).toHaveLength(2);
    expect(result[0].title).toBeNull();
    expect(result[0].challenges[0].name).toBe("筋トレ");
    expect(result[0].challenges[0].due_on).toBeNull();
    expect(result[1].title).toBe("英語学習");
    expect(result[1].challenges).toHaveLength(3);
  });

  it("omits projects that have no challenges", () => {
    const input = "# 空のプロジェクト\n# 実際のプロジェクト\n- challenge";
    const result = parseMarkdownInput(input, 2026, 3);

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("実際のプロジェクト");
  });

  it("strips @... from challenge name cleanly", () => {
    const input = "# Project\n- task name @2026-12-31";
    const result = parseMarkdownInput(input, 2026, 12);

    expect(result[0].challenges[0].name).toBe("task name");
    expect(result[0].challenges[0].due_on).toBe("2026-12-31");
  });

  it("returns empty array for empty input", () => {
    const result = parseMarkdownInput("", 2026, 3);
    expect(result).toHaveLength(0);
  });

  it("returns empty array when only headers with no challenges", () => {
    const input = "# Project A\n# Project B";
    const result = parseMarkdownInput(input, 2026, 3);
    expect(result).toHaveLength(0);
  });
});
