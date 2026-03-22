import type { Context } from "hono";
import { updateChallenge } from "../../services/challenge";
import {
  getProjectsWithChallenges,
  updateProject,
} from "../../services/project";
import { lazyProvision } from "../../services/user";
import type {
  ChallengeStatus,
  Env,
  SlackInteractionPayload,
} from "../../types";
import {
  openModal,
  postEphemeral,
  postMessage,
  publishHome,
} from "../../utils/slack-api";
import {
  buildErrorView,
  buildHomeView,
  resolveDisplayMonth,
} from "../../views/home";

// ─── Helper: safeWaitUntil ───────────────────────────────────────────────────

function safeWaitUntil(
  c: Context<{ Bindings: Env }>,
  promise: Promise<void>,
): void {
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
  const { user, preferences } = await lazyProvision(
    c.env.DB,
    slackUserId,
    userName,
  );
  const { year, month } = resolveDisplayMonth(preferences);
  const projects = await getProjectsWithChallenges(
    c.env.DB,
    user.id,
    year,
    month,
  );
  const view = buildHomeView(user, preferences, projects, year, month);
  await publishHome(c.env.SLACK_BOT_TOKEN, slackUserId, view);
}

// ─── Modal builder ───────────────────────────────────────────────────────────

export function buildReviewModal(
  projectId: number,
  challenges: Array<{
    id: number;
    name: string;
    status: string;
    review_comment: string | null;
  }>,
): unknown {
  const blocks: unknown[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "各チャレンジの結果を記録してください。",
      },
    },
  ];

  for (const ch of challenges) {
    const currentStatus =
      ch.status === "completed" ? "completed" : "incompleted";
    const initialOption =
      currentStatus === "completed"
        ? { text: { type: "plain_text", text: "✅ 達成" }, value: "completed" }
        : {
            text: { type: "plain_text", text: "❌ 未達成" },
            value: "incompleted",
          };

    blocks.push(
      {
        type: "input",
        block_id: `select_challenge_result_${ch.id}`,
        label: { type: "plain_text", text: ch.name },
        element: {
          type: "static_select",
          action_id: `select_challenge_result_${ch.id}`,
          initial_option: initialOption,
          options: [
            {
              text: { type: "plain_text", text: "✅ 達成" },
              value: "completed",
            },
            {
              text: { type: "plain_text", text: "❌ 未達成" },
              value: "incompleted",
            },
          ],
        },
      },
      {
        type: "input",
        block_id: `input_review_comment_${ch.id}`,
        optional: true,
        label: { type: "plain_text", text: `${ch.name} — 振り返りコメント` },
        element: {
          type: "plain_text_input",
          action_id: `input_review_comment_${ch.id}`,
          multiline: true,
          initial_value: ch.review_comment ?? undefined,
          placeholder: {
            type: "plain_text",
            text: "振り返りを入力してください（任意）",
          },
        },
      },
    );
  }

  return {
    type: "modal",
    callback_id: "modal_review",
    private_metadata: String(projectId),
    title: { type: "plain_text", text: "月末振り返り" },
    submit: { type: "plain_text", text: "送信" },
    close: { type: "plain_text", text: "キャンセル" },
    blocks,
  };
}

// ─── /cem_review command handler ─────────────────────────────────────────────

export async function handleCemReview(
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

  const projects = await getProjectsWithChallenges(
    c.env.DB,
    user.id,
    year,
    month,
  );
  const publishedProject = projects.find((p) => p.status === "published");

  if (!publishedProject) {
    await postEphemeral(
      c.env.SLACK_BOT_TOKEN,
      channelId,
      slackUserId,
      "振り返り対象のプロジェクトが見つかりません。すでに振り返り済みか、まだ公開されていません。",
    );
    return c.text("", 200);
  }

  const modal = buildReviewModal(
    publishedProject.id,
    publishedProject.challenges,
  );
  await openModal(c.env.SLACK_BOT_TOKEN, triggerId, modal);

  return c.text("", 200);
}

// ─── modal_review view_submission handler ────────────────────────────────────

export async function handleReviewSubmit(
  c: Context<{ Bindings: Env }>,
  payload: SlackInteractionPayload,
): Promise<Response> {
  const slackUserId = payload.user.id;
  const userName = payload.user.username ?? payload.user.name;
  const projectId = parseInt(payload.view?.private_metadata ?? "0", 10);
  const values = payload.view?.state.values ?? {};

  safeWaitUntil(
    c,
    (async () => {
      try {
        const { user } = await lazyProvision(c.env.DB, slackUserId, userName);

        const now = new Date();
        const year = now.getUTCFullYear();
        const month = now.getUTCMonth() + 1;
        const projects = await getProjectsWithChallenges(
          c.env.DB,
          user.id,
          year,
          month,
        );
        const project = projects.find((p) => p.id === projectId);

        if (!project) {
          return;
        }

        const resultLines: Array<{
          name: string;
          status: ChallengeStatus;
          comment: string | null;
        }> = [];

        for (const challenge of project.challenges) {
          const statusBlockId = `select_challenge_result_${challenge.id}`;
          const statusActionId = `select_challenge_result_${challenge.id}`;
          const commentBlockId = `input_review_comment_${challenge.id}`;
          const commentActionId = `input_review_comment_${challenge.id}`;

          const rawStatus =
            values[statusBlockId]?.[statusActionId]?.selected_option?.value;
          const status: ChallengeStatus =
            rawStatus === "completed" ? "completed" : "incompleted";
          const reviewComment =
            values[commentBlockId]?.[commentActionId]?.value ?? null;

          await updateChallenge(c.env.DB, challenge.id, {
            status,
            review_comment: reviewComment,
          });

          resultLines.push({
            name: challenge.name,
            status,
            comment: reviewComment,
          });
        }

        // Update project to "reviewed"
        await updateProject(c.env.DB, projectId, { status: "reviewed" });

        // Post review summary to channel
        const resultText = resultLines
          .map((r) => {
            const emoji = r.status === "completed" ? "✅" : "❌";
            const commentPart = r.comment ? ` — ${r.comment}` : "";
            return `${emoji} *${r.name}*${commentPart}`;
          })
          .join("\n");

        const summaryText = `📋 *${user.user_name}* が月末振り返りを完了しました！\n*プロジェクト: ${project.title}*\n${resultText}`;

        await postMessage(
          c.env.SLACK_BOT_TOKEN,
          c.env.SLACK_POST_CHANNEL_ID,
          summaryText,
        );

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
