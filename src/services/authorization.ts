import type { D1Database } from "@cloudflare/workers-types";
import type { ChallengeRow, ProjectRow } from "../types";
import { AppError } from "../types";

/**
 * Asserts that the given user owns the specified project.
 * Throws AppError(PROJECT_NOT_FOUND, 404) if project does not exist.
 * Throws AppError(FORBIDDEN, 403) if the project belongs to a different user.
 * Returns the project row on success.
 */
export async function assertProjectOwner(
  db: D1Database,
  projectId: number,
  userId: number,
): Promise<ProjectRow> {
  const project = await db
    .prepare("SELECT * FROM projects WHERE id = ?")
    .bind(projectId)
    .first<ProjectRow>();

  if (!project) {
    throw new AppError(
      "PROJECT_NOT_FOUND",
      `Project ${projectId} not found`,
      404,
    );
  }

  if (project.user_id !== userId) {
    throw new AppError(
      "FORBIDDEN",
      `User ${userId} does not own project ${projectId}`,
      403,
    );
  }

  return project;
}

/**
 * Asserts that the given user owns the project containing the specified challenge.
 * Throws AppError(CHALLENGE_NOT_FOUND, 404) if challenge does not exist.
 * Throws AppError(FORBIDDEN, 403) if the parent project belongs to a different user.
 * Returns the challenge row on success.
 */
export async function assertChallengeOwner(
  db: D1Database,
  challengeId: number,
  userId: number,
): Promise<ChallengeRow> {
  const row = await db
    .prepare(
      `SELECT challenges.*, projects.user_id as project_user_id
       FROM challenges
       JOIN projects ON challenges.project_id = projects.id
       WHERE challenges.id = ?`,
    )
    .bind(challengeId)
    .first<ChallengeRow & { project_user_id: number }>();

  if (!row) {
    throw new AppError(
      "CHALLENGE_NOT_FOUND",
      `Challenge ${challengeId} not found`,
      404,
    );
  }

  if (row.project_user_id !== userId) {
    throw new AppError(
      "FORBIDDEN",
      `User ${userId} does not own challenge ${challengeId}`,
      403,
    );
  }

  // Return a clean ChallengeRow without the joined field
  const { project_user_id: _omit, ...challenge } = row;
  return challenge as ChallengeRow;
}
