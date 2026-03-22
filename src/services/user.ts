import type { D1Database } from "@cloudflare/workers-types";
import type {
  LazyProvisionResult,
  UpdatePreferencesInput,
  UserPreferencesRow,
  UserRow,
} from "../types";
import { AppError } from "../types";

/**
 * Find-or-create pattern. Called at the start of every Slack command/event.
 * Handles UNIQUE constraint race conditions gracefully.
 */
export async function lazyProvision(
  db: D1Database,
  slackUserId: string,
  userName: string,
): Promise<LazyProvisionResult> {
  // 1. Try to find existing user
  const existingUser = await db
    .prepare("SELECT * FROM users WHERE slack_user_id = ?")
    .bind(slackUserId)
    .first<UserRow>();

  if (existingUser) {
    const prefs = await db
      .prepare("SELECT * FROM user_preferences WHERE user_id = ?")
      .bind(existingUser.id)
      .first<UserPreferencesRow>();
    return { user: existingUser, preferences: prefs!, wasCreated: false };
  }

  // 2. Sanitize userName
  let sanitizedName = userName.slice(0, 255);
  if (!sanitizedName) {
    sanitizedName = slackUserId;
  }

  // 3. Insert new user and preferences
  try {
    const insertResult = await db
      .prepare("INSERT INTO users (slack_user_id, user_name) VALUES (?, ?)")
      .bind(slackUserId, sanitizedName)
      .run();

    const userId = insertResult.meta.last_row_id;

    await db
      .prepare("INSERT INTO user_preferences (user_id) VALUES (?)")
      .bind(userId)
      .run();

    const user = await db
      .prepare("SELECT * FROM users WHERE id = ?")
      .bind(userId)
      .first<UserRow>();

    const prefs = await db
      .prepare("SELECT * FROM user_preferences WHERE user_id = ?")
      .bind(userId)
      .first<UserPreferencesRow>();

    return { user: user!, preferences: prefs!, wasCreated: true };
  } catch (e: unknown) {
    const err = e as Error;
    if (err.message?.includes("UNIQUE")) {
      // Race condition — retry SELECT
      const existing = await db
        .prepare("SELECT * FROM users WHERE slack_user_id = ?")
        .bind(slackUserId)
        .first<UserRow>();

      const prefs = await db
        .prepare("SELECT * FROM user_preferences WHERE user_id = ?")
        .bind(existing?.id)
        .first<UserPreferencesRow>();

      return { user: existing!, preferences: prefs!, wasCreated: false };
    }
    throw new AppError("DB_ERROR", err.message, 500);
  }
}

/** Returns null if not found (does NOT throw) */
export async function findUserBySlackId(
  db: D1Database,
  slackUserId: string,
): Promise<UserRow | null> {
  const user = await db
    .prepare("SELECT * FROM users WHERE slack_user_id = ?")
    .bind(slackUserId)
    .first<UserRow>();
  return user ?? null;
}

/** Partial update — only provided fields are changed */
export async function updatePreferences(
  db: D1Database,
  userId: number,
  input: UpdatePreferencesInput,
): Promise<UserPreferencesRow> {
  const setClauses: string[] = [];
  const values: unknown[] = [];

  if ("markdown_mode" in input) {
    setClauses.push("markdown_mode = ?");
    values.push(input.markdown_mode ? 1 : 0);
  }
  if ("personal_reminder" in input) {
    setClauses.push("personal_reminder = ?");
    values.push(input.personal_reminder ? 1 : 0);
  }
  if ("viewed_year" in input) {
    setClauses.push("viewed_year = ?");
    values.push(input.viewed_year ?? null);
  }
  if ("viewed_month" in input) {
    setClauses.push("viewed_month = ?");
    values.push(input.viewed_month ?? null);
  }

  if (setClauses.length > 0) {
    setClauses.push("updated_at = CURRENT_TIMESTAMP");
    values.push(userId);

    await db
      .prepare(
        `UPDATE user_preferences SET ${setClauses.join(", ")} WHERE user_id = ?`,
      )
      .bind(...values)
      .run();
  }

  const updated = await db
    .prepare("SELECT * FROM user_preferences WHERE user_id = ?")
    .bind(userId)
    .first<UserPreferencesRow>();

  return updated!;
}
