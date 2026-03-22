import { AppError } from "../types";
import type { D1Database } from "@cloudflare/workers-types";
import type {
  ChallengeRow,
  CreateChallengeInput,
  UpdateChallengeInput,
} from "../types";

/**
 * Returns the count of challenges for a given project.
 */
export async function countChallenges(
  db: D1Database,
  projectId: number,
): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) as count FROM challenges WHERE project_id = ?")
    .bind(projectId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

/**
 * Creates a new challenge.
 * Throws AppError(CHALLENGE_LIMIT_EXCEEDED, 409) if the project already has 20 challenges.
 * Throws AppError if name exceeds 200 characters.
 */
export async function createChallenge(
  db: D1Database,
  input: CreateChallengeInput,
): Promise<ChallengeRow> {
  const count = await countChallenges(db, input.project_id);
  if (count >= 20) {
    throw new AppError(
      "CHALLENGE_LIMIT_EXCEEDED",
      `Project ${input.project_id} already has 20 challenges (the maximum allowed)`,
      409,
    );
  }

  if (input.name.length > 200) {
    throw new AppError(
      "CHALLENGE_LIMIT_EXCEEDED",
      `name must be <= 200 characters`,
      400,
    );
  }

  const dueOn = input.due_on ?? null;
  const result = await db
    .prepare(
      "INSERT INTO challenges (project_id, name, due_on) VALUES (?, ?, ?)",
    )
    .bind(input.project_id, input.name, dueOn)
    .run();

  const challengeId = result.meta.last_row_id;
  const challenge = await db
    .prepare("SELECT * FROM challenges WHERE id = ?")
    .bind(challengeId)
    .first<ChallengeRow>();

  return challenge!;
}

/**
 * Updates a challenge. Only provided fields are updated.
 */
export async function updateChallenge(
  db: D1Database,
  challengeId: number,
  input: UpdateChallengeInput,
): Promise<ChallengeRow> {
  const setClauses: string[] = [];
  const values: unknown[] = [];

  if ("name" in input) {
    setClauses.push("name = ?");
    values.push(input.name);
  }
  if ("due_on" in input) {
    setClauses.push("due_on = ?");
    values.push(input.due_on ?? null);
  }
  if ("status" in input) {
    setClauses.push("status = ?");
    values.push(input.status);
  }
  if ("progress_comment" in input) {
    setClauses.push("progress_comment = ?");
    values.push(input.progress_comment ?? null);
  }
  if ("review_comment" in input) {
    setClauses.push("review_comment = ?");
    values.push(input.review_comment ?? null);
  }

  if (setClauses.length > 0) {
    setClauses.push("updated_at = CURRENT_TIMESTAMP");
    values.push(challengeId);

    await db
      .prepare(`UPDATE challenges SET ${setClauses.join(", ")} WHERE id = ?`)
      .bind(...values)
      .run();
  }

  const updated = await db
    .prepare("SELECT * FROM challenges WHERE id = ?")
    .bind(challengeId)
    .first<ChallengeRow>();

  return updated!;
}

/**
 * Deletes a challenge.
 */
export async function deleteChallenge(
  db: D1Database,
  challengeId: number,
): Promise<void> {
  await db
    .prepare("DELETE FROM challenges WHERE id = ?")
    .bind(challengeId)
    .run();
}
