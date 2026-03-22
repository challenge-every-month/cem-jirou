import type { Context } from "hono";
import type { Env, SlackInteractionPayload } from "../types";
import { handleNewProjectStandardSubmit, handleNewProjectMarkdownSubmit } from "../handlers/commands/cem-new";
import { handleSettingsSubmit } from "../handlers/commands/cem-settings";

type InteractionContext = Context<{ Bindings: Env }>;

export async function interactionRouter(c: InteractionContext): Promise<Response> {
  const rawBody = c.get("rawBody" as never) as string;
  const params = new URLSearchParams(rawBody);
  const payloadStr = params.get("payload") ?? "{}";
  const payload = JSON.parse(payloadStr) as SlackInteractionPayload;

  switch (payload.type) {
    case "block_actions":
      return handleBlockActions(c, payload);
    case "view_submission":
      return handleViewSubmission(c, payload);
    case "view_closed":
      return c.text("", 200);
    default:
      return c.text("", 200);
  }
}

async function handleBlockActions(
  c: InteractionContext,
  payload: SlackInteractionPayload,
): Promise<Response> {
  const actionId = payload.actions?.[0]?.action_id ?? "";

  switch (actionId) {
    case "home_nav_prev":
    case "home_nav_next":
    case "home_open_new_project":
    case "home_open_add_challenge":
    case "home_open_edit_project":
    case "home_confirm_delete_project":
    case "home_publish":
    case "home_review_complete":
    case "challenge_set_not_started":
    case "challenge_set_in_progress":
    case "challenge_set_completed":
    case "challenge_open_comment":
    case "home_open_settings":
    default:
      return c.text("", 200);
  }
}

async function handleViewSubmission(
  c: InteractionContext,
  payload: SlackInteractionPayload,
): Promise<Response> {
  switch (payload.view?.callback_id) {
    case "modal_new_project_standard": return handleNewProjectStandardSubmit(c, payload);
    case "modal_new_project_markdown": return handleNewProjectMarkdownSubmit(c, payload);
    case "modal_settings":             return handleSettingsSubmit(c, payload);
    default:                           return c.text("", 200);
  }
}
