import type { Context } from "hono";
import type { Env, SlackInteractionPayload } from "../../types";
import { AppError } from "../../types";
import { lazyProvision } from "../../services/user";
import { getProjectsWithChallenges } from "../../services/project";
import { updateChallenge } from "../../services/challenge";
import { openModal, postMessage, postEphemeral, publishHome } from "../../utils/slack-api";
import { resolveDisplayMonth, buildHomeView, buildErrorView } from "../../views/home";

// ─── Helper: safeWaitUntil ───────────────────────────────────────────────────

function safeWaitUntil(c: Context<{ Bindings: Env }>, promise: Promise<void>): void {
  try {
    c.executionCtx.waitUntil(promise);
  } catch {
    // executionCtx not available in test environment
  }
}

// ─── Helper: refresh App Home ────────────────────────────────────────────────

async function refreshHome(
  c: Context<{ Bindings: Env }>,
  slackUserId: string,
  userName: string,
): Promise<void> {
  const { user, preferences } = await lazyProvision(c.env.DB, slackUserId, userName);
  const { year, month } = resolveDisplayMonth(preferences);
  const projects = await getProjectsWithChallenges(c.env.DB, user.id, year, month);
  const view = buildHomeView(user, preferences, projects, year, month);
  await publishHome(c.env.SLACK_BOT_TOKEN, slackUserId, view);
}

// ─── Modal builder ───────────────────────────────────────────────────────────

function buildProgressModal(
  projectId: number,
  challenges: Array<{ id: number; name: string; progress_comment: string | null }>,
): unknown {
  const blocks: unknown[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "各チャレンジの進捗コメントを入力してください。",
      },
    },
  ];

  for (const ch of challenges) {
    blocks.push({
      type: "input",
      block_id: `progress_comment_${ch.id}`,
      optional: true,
      label: { type: "plain_text", text: ch.name },
      element: {
        type: "plain_text_input",
        action_id: `progress_comment_${ch.id}`,
        multiline: true,
        initial_value: ch.progress_comment ?? undefined,
        placeholder: {
          type: "plain_text",
          text: "進捗を入力してください（任意）",
        },
      },
    });
  }

  return {
    type: "modal",
    callback_id: "modal_progress_report",
    private_metadata: String(projectId),
    title: { type: "plain_text", text: "進捗報告" },
    submit: { type: "plain_text", text: "送信" },
    close: { type: "plain_text", text: "キャンセル" },
    blocks,
  };
}

// ─── /cem_progress command handler ──────────────────────────────────────────

export async function handleCemProgress(
  c: Context<{ Bindings: Env }>,
  params: URLSearchParams,
): Promise<Response> {
  const slackUserId = params.get("user_id") ?? "";
  const userName = params.get("user_name") ?? "";
  const triggerId = params.get("trigger_id") ?? "";
  const channelId = params.get("channel_id") ?? "";

  const { user } = await lazyProvision(c.env.DB, slackUserId, userName);

  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;

  const projects = await getProjectsWithChallenges(c.env.DB, user.id, year, month);
  const publishedProject = projects.find((p) => p.status === "published");

  if (!publishedProject) {
    await postEphemeral(
      c.env.SLACK_BOT_TOKEN,
      channelId,
      slackUserId,
      "進行中のプロジェクトが見つかりません。先に `/cem_publish` でプロジェクトを公開してください。",
    );
    return c.text("", 200);
  }

  const modal = buildProgressModal(publishedProject.id, publishedProject.challenges);
  await openModal(c.env.SLACK_BOT_TOKEN, triggerId, modal);

  return c.text("", 200);
}

// ─── modal_progress_report view_submission handler ──────────────────────────

export async function handleProgressSubmit(
  c: Context<{ Bindings: Env }>,
  payload: SlackInteractionPayload,
): Promise<Response> {
  const slackUserId = payload.user.id;
  const userName = payload.user.username ?? payload.user.name;
  const projectId = parseInt(payload.view?.private_metadata ?? "0", 10);
  const values = payload.view?.state.values ?? {};

  safeWaitUntil(c, (async () => {
    try {
      const { user } = await lazyProvision(c.env.DB, slackUserId, userName);

      const now = new Date();
      const year = now.getUTCFullYear();
      const month = now.getUTCMonth() + 1;
      const projects = await getProjectsWithChallenges(c.env.DB, user.id, year, month);
      const project = projects.find((p) => p.id === projectId);

      if (!project) {
        return;
      }

      const updatedComments: Array<{ name: string; comment: string }> = [];

      for (const challenge of project.challenges) {
        const blockId = `progress_comment_${challenge.id}`;
        const actionId = `progress_comment_${challenge.id}`;
        const comment = values[blockId]?.[actionId]?.value ?? null;

        await updateChallenge(c.env.DB, challenge.id, {
          progress_comment: comment,
        });

        if (comment) {
          updatedComments.push({ name: challenge.name, comment });
        }
      }

      // Post summary to channel
      const commentLines = updatedComments
        .map((uc) => `• *${uc.name}*: ${uc.comment}`)
        .join("\n");
      const summaryText = commentLines
        ? `📊 *${user.user_name}* が進捗報告しました！\n*プロジェクト: ${project.title}*\n${commentLines}`
        : `📊 *${user.user_name}* が進捗報告しました！\n*プロジェクト: ${project.title}*`;

      await postMessage(
        c.env.SLACK_BOT_TOKEN,
        c.env.SLACK_POST_CHANNEL_ID,
        summaryText,
      );

      await refreshHome(c, slackUserId, userName);
    } catch (e) {
      const view = buildErrorView(e instanceof Error ? e.message : "Unknown error");
      await publishHome(c.env.SLACK_BOT_TOKEN, slackUserId, view).catch(() => {});
    }
  })());

  return c.text("", 200);
}
