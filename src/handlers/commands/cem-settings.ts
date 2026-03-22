import type { Context } from "hono";
import { lazyProvision, updatePreferences } from "../../services/user";
import type {
  HonoEnv,
  SlackInteractionPayload,
  UserPreferencesRow,
} from "../../types";
import { openModal } from "../../utils/slack-api";

export async function handleCemSettings(
  c: Context<HonoEnv>,
  params: URLSearchParams,
): Promise<Response> {
  const slackUserId = params.get("user_id") ?? "";
  const userName = params.get("user_name") ?? "";
  const triggerId = params.get("trigger_id") ?? "";

  const { preferences } = await lazyProvision(c.env.DB, slackUserId, userName);
  const modal = buildSettingsModal(preferences);
  await openModal(c.env.SLACK_BOT_TOKEN, triggerId, modal);
  return c.text("", 200);
}

// Handle view_submission for modal_settings
export async function handleSettingsSubmit(
  c: Context<HonoEnv>,
  payload: SlackInteractionPayload,
): Promise<Response> {
  const slackUserId = payload.user.id;
  const userName = payload.user.username ?? payload.user.name;
  const { user } = await lazyProvision(c.env.DB, slackUserId, userName);

  const values = payload.view?.state.values ?? {};
  const markdownModeVal =
    values.toggle_markdown_mode?.toggle_markdown_mode?.selected_option?.value;
  const personalReminderVal =
    values.toggle_personal_reminder?.toggle_personal_reminder?.selected_option
      ?.value;

  await updatePreferences(c.env.DB, user.id, {
    markdown_mode: markdownModeVal === "true",
    personal_reminder: personalReminderVal === "true",
  });

  return c.text("", 200);
}

export function buildSettingsModal(preferences: UserPreferencesRow) {
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
          initial_option:
            preferences.markdown_mode === 1
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
          initial_option:
            preferences.personal_reminder === 1
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
