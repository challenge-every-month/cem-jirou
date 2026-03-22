import type { Context } from "hono";
import { assertProjectOwner } from "../../services/authorization";
import { updateProject } from "../../services/project";
import { lazyProvision } from "../../services/user";
import type { HonoEnv, SlackInteractionPayload } from "../../types";
import { refreshHome, safeWaitUntil } from "../../utils/handler-helpers";
import { openModal, publishHome } from "../../utils/slack-api";
import { buildErrorView } from "../../views/home";

// ─── /cem_edit command handler ───────────────────────────────────────────────

export async function handleCemEdit(
  c: Context<HonoEnv>,
  _params: URLSearchParams,
): Promise<Response> {
  return c.text("", 200); // TODO: multi-step edit via slash command
}

// ─── home_open_edit_project block_action handler ─────────────────────────────

export async function handleHomeOpenEditProject(
  c: Context<HonoEnv>,
  payload: SlackInteractionPayload,
): Promise<Response> {
  const action = payload.actions?.[0];
  const projectId = parseInt(action?.value ?? "0", 10);
  const slackUserId = payload.user.id;
  const userName = payload.user.username ?? payload.user.name;

  const { user } = await lazyProvision(c.env.DB, slackUserId, userName);
  const project = await assertProjectOwner(c.env.DB, projectId, user.id);

  const modal = {
    type: "modal",
    callback_id: "modal_edit_project",
    private_metadata: String(projectId),
    title: { type: "plain_text", text: "プロジェクトを編集" },
    submit: { type: "plain_text", text: "保存" },
    close: { type: "plain_text", text: "キャンセル" },
    blocks: [
      {
        type: "input",
        block_id: "input_project_title",
        label: { type: "plain_text", text: "プロジェクトタイトル" },
        element: {
          type: "plain_text_input",
          action_id: "input_project_title",
          initial_value: project.title,
          placeholder: { type: "plain_text", text: "例: 英語学習" },
        },
      },
    ],
  };

  await openModal(c.env.SLACK_BOT_TOKEN, payload.trigger_id, modal);
  return c.text("", 200);
}

// ─── modal_edit_project view_submission handler ──────────────────────────────

export async function handleEditProjectSubmit(
  c: Context<HonoEnv>,
  payload: SlackInteractionPayload,
): Promise<Response> {
  const slackUserId = payload.user.id;
  const userName = payload.user.username ?? payload.user.name;
  const projectId = parseInt(payload.view?.private_metadata ?? "0", 10);
  const values = payload.view?.state.values ?? {};
  const newTitle =
    values.input_project_title?.input_project_title?.value?.trim() ?? "";

  safeWaitUntil(
    c,
    (async () => {
      try {
        const { user } = await lazyProvision(c.env.DB, slackUserId, userName);
        await assertProjectOwner(c.env.DB, projectId, user.id);

        if (newTitle) {
          await updateProject(c.env.DB, projectId, { title: newTitle });
        }

        await refreshHome(c, slackUserId, userName);
      } catch (e) {
        const view = buildErrorView(
          e instanceof Error ? e.message : "Unknown error",
        );
        await publishHome(c.env.SLACK_BOT_TOKEN, slackUserId, view).catch(
          () => {},
        );
      }
    })(),
  );

  return c.text("", 200);
}
