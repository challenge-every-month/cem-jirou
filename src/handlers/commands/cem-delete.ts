import type { Context } from "hono";
import { assertProjectOwner } from "../../services/authorization";
import { deleteProject } from "../../services/project";
import { lazyProvision } from "../../services/user";
import type { HonoEnv, SlackInteractionPayload } from "../../types";
import { refreshHome, safeWaitUntil } from "../../utils/handler-helpers";
import { openModal, publishHome } from "../../utils/slack-api";
import { buildErrorView } from "../../views/home";

// ─── /cem_delete command handler ─────────────────────────────────────────────

export async function handleCemDelete(
  c: Context<HonoEnv>,
  _params: URLSearchParams,
): Promise<Response> {
  return c.text("", 200); // TODO: multi-step delete via slash command
}

// ─── home_confirm_delete_project block_action handler ────────────────────────

export async function handleHomeConfirmDeleteProject(
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
    callback_id: "modal_delete_project_confirm",
    private_metadata: String(projectId),
    title: { type: "plain_text", text: "削除の確認" },
    submit: { type: "plain_text", text: "削除する", emoji: false },
    close: { type: "plain_text", text: "キャンセル" },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `本当にプロジェクト「*${project.title}*」を削除しますか？\nこの操作は取り消せません。`,
        },
      },
    ],
  };

  await openModal(c.env.SLACK_BOT_TOKEN, payload.trigger_id, modal);
  return c.text("", 200);
}

// ─── modal_delete_project_confirm view_submission handler ────────────────────

export async function handleDeleteProjectConfirmSubmit(
  c: Context<HonoEnv>,
  payload: SlackInteractionPayload,
): Promise<Response> {
  const slackUserId = payload.user.id;
  const userName = payload.user.username ?? payload.user.name;
  const projectId = parseInt(payload.view?.private_metadata ?? "0", 10);

  safeWaitUntil(
    c,
    (async () => {
      try {
        const { user } = await lazyProvision(c.env.DB, slackUserId, userName);
        await assertProjectOwner(c.env.DB, projectId, user.id);
        await deleteProject(c.env.DB, projectId);
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
