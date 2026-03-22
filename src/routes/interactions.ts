import type { Context } from "hono";
import type { Env, SlackInteractionPayload } from "../types";
import { handleNewProjectStandardSubmit, handleNewProjectMarkdownSubmit } from "../handlers/commands/cem-new";
import { handleSettingsSubmit } from "../handlers/commands/cem-settings";
import { lazyProvision, updatePreferences } from "../services/user";
import { getProjectsWithChallenges } from "../services/project";
import { updateChallenge } from "../services/challenge";
import { resolveDisplayMonth, buildHomeView, buildErrorView } from "../views/home";
import { publishHome, openModal } from "../utils/slack-api";

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

// ─── Helper: safely schedule work with waitUntil ────────────────────────────

function safeWaitUntil(c: InteractionContext, promise: Promise<void>): void {
  try {
    c.executionCtx.waitUntil(promise);
  } catch {
    // executionCtx not available in test environment
  }
}

// ─── Helper: refresh App Home for a user ────────────────────────────────────

async function refreshHome(
  c: InteractionContext,
  slackUserId: string,
  userName: string,
): Promise<void> {
  const { user, preferences } = await lazyProvision(c.env.DB, slackUserId, userName);
  const { year, month } = resolveDisplayMonth(preferences);
  const projects = await getProjectsWithChallenges(c.env.DB, user.id, year, month);
  const view = buildHomeView(user, preferences, projects, year, month);
  await publishHome(c.env.SLACK_BOT_TOKEN, slackUserId, view);
}

// ─── Block Actions ───────────────────────────────────────────────────────────

async function handleBlockActions(
  c: InteractionContext,
  payload: SlackInteractionPayload,
): Promise<Response> {
  const action = payload.actions?.[0];
  const actionId = action?.action_id ?? "";
  const slackUserId = payload.user.id;
  const userName = payload.user.username ?? payload.user.name;

  switch (actionId) {
    case "home_nav_prev":
    case "home_nav_next": {
      const [yearStr, monthStr] = (action?.value ?? "").split("-");
      const targetYear = parseInt(yearStr, 10);
      const targetMonth = parseInt(monthStr, 10);

      safeWaitUntil(c, (async () => {
        try {
          const { user } = await lazyProvision(c.env.DB, slackUserId, userName);
          const updatedPrefs = await updatePreferences(c.env.DB, user.id, {
            viewed_year: targetYear,
            viewed_month: targetMonth,
          });
          const projects = await getProjectsWithChallenges(c.env.DB, user.id, targetYear, targetMonth);
          const view = buildHomeView(user, updatedPrefs, projects, targetYear, targetMonth);
          await publishHome(c.env.SLACK_BOT_TOKEN, slackUserId, view);
        } catch (e) {
          const view = buildErrorView(e instanceof Error ? e.message : "Unknown error");
          await publishHome(c.env.SLACK_BOT_TOKEN, slackUserId, view).catch(() => {});
        }
      })());
      return c.text("", 200);
    }

    case "challenge_set_not_started":
    case "challenge_set_in_progress":
    case "challenge_set_completed": {
      const challengeId = parseInt(action?.value ?? "0", 10);
      const statusMap: Record<string, "not_started" | "in_progress" | "completed"> = {
        challenge_set_not_started: "not_started",
        challenge_set_in_progress: "in_progress",
        challenge_set_completed: "completed",
      };
      const newStatus = statusMap[actionId];

      safeWaitUntil(c, (async () => {
        try {
          await updateChallenge(c.env.DB, challengeId, { status: newStatus });
          await refreshHome(c, slackUserId, userName);
        } catch (e) {
          const view = buildErrorView(e instanceof Error ? e.message : "Unknown error");
          await publishHome(c.env.SLACK_BOT_TOKEN, slackUserId, view).catch(() => {});
        }
      })());
      return c.text("", 200);
    }

    case "challenge_open_comment": {
      // For overflow menu, the value is in selected_option
      const challengeIdValue = action?.selected_option?.value ?? action?.value ?? "";
      const modal = {
        type: "modal",
        callback_id: "modal_challenge_comment",
        private_metadata: challengeIdValue,
        title: { type: "plain_text", text: "コメントを追加" },
        submit: { type: "plain_text", text: "保存" },
        close: { type: "plain_text", text: "キャンセル" },
        blocks: [
          {
            type: "input",
            block_id: "input_progress_comment",
            label: { type: "plain_text", text: "進捗コメント" },
            element: {
              type: "plain_text_input",
              action_id: "input_progress_comment",
              multiline: true,
            },
          },
        ],
      };
      await openModal(c.env.SLACK_BOT_TOKEN, payload.trigger_id, modal);
      return c.text("", 200);
    }

    case "home_open_new_project":
    case "home_open_add_challenge": {
      // Open the cem_new modal; reuse the same cem_new command handler logic by
      // constructing the params and delegating — for now open a standard new project modal
      // This is a stub that can be wired to the full handler; for block_action we just
      // acknowledge. The full modal open is handled by /cem_new command.
      // For home_open_add_challenge we pass the project_id as context.
      return c.text("", 200);
    }

    case "home_open_settings": {
      const { preferences } = await lazyProvision(c.env.DB, slackUserId, userName);
      const settingsModal = buildSettingsModal(preferences);
      await openModal(c.env.SLACK_BOT_TOKEN, payload.trigger_id, settingsModal);
      return c.text("", 200);
    }

    case "home_open_edit_project":
    case "home_confirm_delete_project":
    case "home_publish":
    case "home_review_complete":
    default:
      return c.text("", 200);
  }
}

// ─── View Submissions ────────────────────────────────────────────────────────

async function handleViewSubmission(
  c: InteractionContext,
  payload: SlackInteractionPayload,
): Promise<Response> {
  switch (payload.view?.callback_id) {
    case "modal_new_project_standard": return handleNewProjectStandardSubmit(c, payload);
    case "modal_new_project_markdown": return handleNewProjectMarkdownSubmit(c, payload);
    case "modal_settings":             return handleSettingsSubmit(c, payload);
    case "modal_challenge_comment":    return handleChallengeCommentSubmit(c, payload);
    default:                           return c.text("", 200);
  }
}

async function handleChallengeCommentSubmit(
  c: InteractionContext,
  payload: SlackInteractionPayload,
): Promise<Response> {
  const slackUserId = payload.user.id;
  const userName = payload.user.username ?? payload.user.name;
  const challengeId = parseInt(payload.view?.private_metadata ?? "0", 10);
  const comment =
    payload.view?.state.values["input_progress_comment"]?.["input_progress_comment"]?.value ?? "";

  safeWaitUntil(c, (async () => {
    try {
      await updateChallenge(c.env.DB, challengeId, { progress_comment: comment });
      await refreshHome(c, slackUserId, userName);
    } catch (e) {
      const view = buildErrorView(e instanceof Error ? e.message : "Unknown error");
      await publishHome(c.env.SLACK_BOT_TOKEN, slackUserId, view).catch(() => {});
    }
  })());
  return c.text("", 200);
}

// ─── Settings modal builder (duplicated from cem-settings handler for block_action use) ──

function buildSettingsModal(preferences: { markdown_mode: number; personal_reminder: number }) {
  return {
    type: "modal",
    callback_id: "modal_settings",
    title: { type: "plain_text", text: "設定" },
    submit: { type: "plain_text", text: "保存" },
    close: { type: "plain_text", text: "キャンセル" },
    blocks: [
      {
        type: "input",
        block_id: "toggle_markdown_mode",
        label: { type: "plain_text", text: "マークダウン入力モード" },
        element: {
          type: "radio_buttons",
          action_id: "toggle_markdown_mode",
          initial_option: preferences.markdown_mode === 1
            ? { text: { type: "plain_text", text: "ON" }, value: "true" }
            : { text: { type: "plain_text", text: "OFF" }, value: "false" },
          options: [
            { text: { type: "plain_text", text: "OFF" }, value: "false" },
            { text: { type: "plain_text", text: "ON" }, value: "true" },
          ],
        },
      },
      {
        type: "input",
        block_id: "toggle_personal_reminder",
        label: { type: "plain_text", text: "個人リマインダー DM" },
        element: {
          type: "radio_buttons",
          action_id: "toggle_personal_reminder",
          initial_option: preferences.personal_reminder === 1
            ? { text: { type: "plain_text", text: "ON" }, value: "true" }
            : { text: { type: "plain_text", text: "OFF" }, value: "false" },
          options: [
            { text: { type: "plain_text", text: "OFF" }, value: "false" },
            { text: { type: "plain_text", text: "ON" }, value: "true" },
          ],
        },
      },
    ],
  };
}
