import { Hono } from "hono";
import type { Env } from "../types";
import { findUserBySlackId, updatePreferences } from "../services/user";
import type { UpdatePreferencesInput } from "../types";

export const usersRouter = new Hono<{ Bindings: Env }>();

// GET /users/:slack_user_id
usersRouter.get("/:slack_user_id", async (c) => {
  const slackUserId = c.req.param("slack_user_id");
  const db = c.env.DB;

  const user = await findUserBySlackId(db, slackUserId);
  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  return c.json({
    slack_user_id: user.slack_user_id,
    user_name: user.user_name,
    created_at: user.created_at,
  });
});

// PATCH /users/:slack_user_id/preferences
usersRouter.patch("/:slack_user_id/preferences", async (c) => {
  const slackUserId = c.req.param("slack_user_id");
  const db = c.env.DB;

  const user = await findUserBySlackId(db, slackUserId);
  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  const input = (await c.req.json()) as UpdatePreferencesInput;
  const prefs = await updatePreferences(db, user.id, input);

  return c.json({
    markdown_mode: prefs.markdown_mode === 1,
    personal_reminder: prefs.personal_reminder === 1,
    viewed_year: prefs.viewed_year,
    viewed_month: prefs.viewed_month,
  });
});
