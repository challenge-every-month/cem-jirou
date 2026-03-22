import type { Context } from "hono";
import { assertProjectOwner } from "../../services/authorization";
import {
  getProjectsWithChallenges,
  updateProject,
} from "../../services/project";
import { lazyProvision } from "../../services/user";
import type { HonoEnv, SlackInteractionPayload } from "../../types";
import { AppError } from "../../types";
import {
  getCurrentYearMonth,
  refreshHome,
  safeWaitUntil,
} from "../../utils/handler-helpers";
import { postEphemeral, postMessage, publishHome } from "../../utils/slack-api";
import { buildPublishMessage } from "../../views/channel-messages";
import { buildErrorView } from "../../views/home";

// ─── /cem_publish command handler ───────────────────────────────────────────

export async function handleCemPublish(
  c: Context<HonoEnv>,
  params: URLSearchParams,
): Promise<Response> {
  const slackUserId = params.get("user_id") ?? "";
  const userName = params.get("user_name") ?? "";
  const channelId = params.get("channel_id") ?? "";

  const { user } = await lazyProvision(c.env.DB, slackUserId, userName);

  const { year, month } = getCurrentYearMonth();

  const projects = await getProjectsWithChallenges(
    c.env.DB,
    user.id,
    year,
    month,
  );
  const draftProject = projects.find(
    (p) => p.status === "draft" && p.is_inbox === 0,
  );

  if (!draftProject) {
    await postEphemeral(
      c.env.SLACK_BOT_TOKEN,
      channelId,
      slackUserId,
      "公開できるプロジェクトが見つかりません。先に `/cem_new` でプロジェクトを作成してください。",
    );
    return c.text("", 200);
  }

  safeWaitUntil(
    c,
    (async () => {
      try {
        const updatedProject = await updateProject(c.env.DB, draftProject.id, {
          status: "published",
        });

        const message = buildPublishMessage(
          user,
          updatedProject,
          draftProject.challenges,
        );
        await postMessage(
          c.env.SLACK_BOT_TOKEN,
          c.env.SLACK_POST_CHANNEL_ID,
          message.text ?? "",
          message.blocks as unknown[],
        );

        await postEphemeral(
          c.env.SLACK_BOT_TOKEN,
          channelId,
          slackUserId,
          `✅ プロジェクト「${updatedProject.title}」を公開しました！`,
        );

        await refreshHome(c, slackUserId, userName);
      } catch (e) {
        const msg = e instanceof AppError ? e.message : "エラーが発生しました";
        await postEphemeral(
          c.env.SLACK_BOT_TOKEN,
          channelId,
          slackUserId,
          msg,
        ).catch(() => {});
      }
    })(),
  );

  return c.text("", 200);
}

// ─── home_publish block_action handler ──────────────────────────────────────

export async function handleHomePublish(
  c: Context<HonoEnv>,
  payload: SlackInteractionPayload,
): Promise<Response> {
  const action = payload.actions?.[0];
  const projectId = parseInt(action?.value ?? "0", 10);
  const slackUserId = payload.user.id;
  const userName = payload.user.username ?? payload.user.name;

  safeWaitUntil(
    c,
    (async () => {
      try {
        const { user } = await lazyProvision(c.env.DB, slackUserId, userName);
        const project = await assertProjectOwner(c.env.DB, projectId, user.id);

        const { year, month } = getCurrentYearMonth();

        const projectsWithChallenges = await getProjectsWithChallenges(
          c.env.DB,
          user.id,
          year,
          month,
        );
        const projectWithChallenges = projectsWithChallenges.find(
          (p) => p.id === project.id,
        );
        const challenges = projectWithChallenges?.challenges ?? [];

        const updatedProject = await updateProject(c.env.DB, projectId, {
          status: "published",
        });

        const message = buildPublishMessage(user, updatedProject, challenges);
        await postMessage(
          c.env.SLACK_BOT_TOKEN,
          c.env.SLACK_POST_CHANNEL_ID,
          message.text ?? "",
          message.blocks as unknown[],
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
