import type { D1Database } from "@cloudflare/workers-types";
import type {
  ChallengeRow,
  CreateProjectInput,
  ProjectRow,
  ProjectWithChallenges,
  UpdateProjectInput,
} from "../types";
import { AppError } from "../types";

/**
 * Returns all projects (with nested challenges) for a given user/year/month.
 */
export async function getProjectsWithChallenges(
  db: D1Database,
  userId: number,
  year: number,
  month: number,
): Promise<ProjectWithChallenges[]> {
  const projects = await db
    .prepare(
      "SELECT * FROM projects WHERE user_id = ? AND year = ? AND month = ?",
    )
    .bind(userId, year, month)
    .all<ProjectRow>();

  const rows = projects.results ?? [];
  if (rows.length === 0) {
    return [];
  }

  const projectIds = rows.map((p) => p.id);
  const placeholders = projectIds.map(() => "?").join(", ");
  const challenges = await db
    .prepare(`SELECT * FROM challenges WHERE project_id IN (${placeholders})`)
    .bind(...projectIds)
    .all<ChallengeRow>();

  const challengesByProjectId = new Map<number, ChallengeRow[]>();
  for (const challenge of challenges.results ?? []) {
    const list = challengesByProjectId.get(challenge.project_id) ?? [];
    list.push(challenge);
    challengesByProjectId.set(challenge.project_id, list);
  }

  return rows.map((project) => ({
    ...project,
    challenges: challengesByProjectId.get(project.id) ?? [],
  }));
}

/**
 * Creates a new project after validating the input.
 * Throws AppError(INVALID_YEAR_MONTH, 400) if year/month are out of range.
 * Throws AppError if title exceeds 100 characters.
 */
export async function createProject(
  db: D1Database,
  input: CreateProjectInput,
): Promise<ProjectRow> {
  if (input.year < 2020) {
    throw new AppError(
      "INVALID_YEAR_MONTH",
      `year must be >= 2020, got ${input.year}`,
      400,
    );
  }
  if (input.month < 1 || input.month > 12) {
    throw new AppError(
      "INVALID_YEAR_MONTH",
      `month must be between 1 and 12, got ${input.month}`,
      400,
    );
  }
  if (input.title.length > 100) {
    throw new AppError(
      "INVALID_YEAR_MONTH",
      `title must be <= 100 characters`,
      400,
    );
  }

  const isInbox = input.is_inbox ? 1 : 0;
  const result = await db
    .prepare(
      "INSERT INTO projects (user_id, title, year, month, is_inbox) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(input.user_id, input.title, input.year, input.month, isInbox)
    .run();

  const projectId = result.meta.last_row_id;
  const project = await db
    .prepare("SELECT * FROM projects WHERE id = ?")
    .bind(projectId)
    .first<ProjectRow>();

  return project!;
}

/**
 * Gets the inbox project for user/year/month, creating it if it does not exist.
 */
export async function getOrCreateInboxProject(
  db: D1Database,
  userId: number,
  year: number,
  month: number,
): Promise<ProjectRow> {
  const existing = await db
    .prepare(
      "SELECT * FROM projects WHERE user_id = ? AND year = ? AND month = ? AND is_inbox = 1",
    )
    .bind(userId, year, month)
    .first<ProjectRow>();

  if (existing) {
    return existing;
  }

  const result = await db
    .prepare(
      "INSERT INTO projects (user_id, title, year, month, is_inbox, status) VALUES (?, ?, ?, ?, 1, 'draft')",
    )
    .bind(userId, "その他", year, month)
    .run();

  const projectId = result.meta.last_row_id;
  const project = await db
    .prepare("SELECT * FROM projects WHERE id = ?")
    .bind(projectId)
    .first<ProjectRow>();

  return project!;
}

/**
 * Updates a project. Throws AppError(PROJECT_ALREADY_REVIEWED, 409) if already reviewed.
 * Only provided fields are updated.
 */
export async function updateProject(
  db: D1Database,
  projectId: number,
  input: UpdateProjectInput,
): Promise<ProjectRow> {
  const current = await db
    .prepare("SELECT * FROM projects WHERE id = ?")
    .bind(projectId)
    .first<ProjectRow>();

  if (!current) {
    throw new AppError(
      "PROJECT_NOT_FOUND",
      `Project ${projectId} not found`,
      404,
    );
  }

  if (current.status === "reviewed") {
    throw new AppError(
      "PROJECT_ALREADY_REVIEWED",
      `Project ${projectId} has already been reviewed and cannot be modified`,
      409,
    );
  }

  const setClauses: string[] = [];
  const values: unknown[] = [];

  if ("title" in input) {
    setClauses.push("title = ?");
    values.push(input.title);
  }
  if ("status" in input) {
    setClauses.push("status = ?");
    values.push(input.status);
  }

  if (setClauses.length > 0) {
    setClauses.push("updated_at = CURRENT_TIMESTAMP");
    values.push(projectId);

    await db
      .prepare(`UPDATE projects SET ${setClauses.join(", ")} WHERE id = ?`)
      .bind(...values)
      .run();
  }

  const updated = await db
    .prepare("SELECT * FROM projects WHERE id = ?")
    .bind(projectId)
    .first<ProjectRow>();

  return updated!;
}

/**
 * Deletes a project. Challenges are cascade-deleted by the DB.
 */
export async function deleteProject(
  db: D1Database,
  projectId: number,
): Promise<void> {
  await db.prepare("DELETE FROM projects WHERE id = ?").bind(projectId).run();
}
