import type { ParsedProject, ParsedChallenge } from "../types";

/**
 * Zero-pads a number to 2 digits.
 */
function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Extracts a @due date from the raw challenge text.
 * Patterns are tried longest-first to avoid partial matches.
 *
 * 1. @YYYY-MM-DD  → exact date
 * 2. @MM-DD       → contextYear-MM-DD
 * 3. @D or @DD    → contextYear-contextMonth-DD (only at end of string)
 * 4. (none)       → due_on: null
 *
 * Returns the name with the @... portion removed, and the resolved due_on.
 */
export function extractDueDate(
  text: string,
  contextYear: number,
  contextMonth: number,
): { name: string; due_on: string | null } {
  // 1. Full date: @YYYY-MM-DD
  let match = text.match(/@(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const due_on = `${match[1]}-${match[2]}-${match[3]}`;
    return { name: text.replace(match[0], "").trim(), due_on };
  }

  // 2. Month-day: @MM-DD
  match = text.match(/@(\d{2})-(\d{2})/);
  if (match) {
    const due_on = `${contextYear}-${match[1]}-${match[2]}`;
    return { name: text.replace(match[0], "").trim(), due_on };
  }

  // 3. Day only (at end of string): @D or @DD
  match = text.match(/@(\d{1,2})$/);
  if (match) {
    const day = pad(parseInt(match[1], 10));
    const month = pad(contextMonth);
    const due_on = `${contextYear}-${month}-${day}`;
    return { name: text.replace(match[0], "").trim(), due_on };
  }

  return { name: text, due_on: null };
}

/**
 * Parses a markdown-formatted text into an array of ParsedProject objects.
 *
 * Lines starting with "# " begin a new project.
 * Lines starting with "- " are challenge entries under the current project.
 * Lines without a "# " prefix before any project header are collected into an
 * implicit inbox project (title: null).
 * Projects with zero challenges are omitted from the output.
 */
export function parseMarkdownInput(
  text: string,
  contextYear: number,
  contextMonth: number,
): ParsedProject[] {
  const lines = text.split("\n");
  const projects: ParsedProject[] = [];
  let currentProject: { title: string | null; challenges: ParsedChallenge[] } = {
    title: null,
    challenges: [],
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") {
      continue;
    }

    if (trimmed.startsWith("# ")) {
      if (currentProject.challenges.length > 0) {
        projects.push(currentProject);
      }
      currentProject = { title: trimmed.slice(2).trim(), challenges: [] };
    } else if (trimmed.startsWith("- ")) {
      const rawText = trimmed.slice(2);
      const { name, due_on } = extractDueDate(rawText, contextYear, contextMonth);
      currentProject.challenges.push({ name: name.trim(), due_on });
    }
  }

  if (currentProject.challenges.length > 0) {
    projects.push(currentProject);
  }

  return projects;
}
