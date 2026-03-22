import type { Context } from "hono";
import {
  handleDeleteProjectConfirmSubmit,
  handleHomeConfirmDeleteProject,
} from "../handlers/commands/cem-delete";
import {
  handleEditProjectSubmit,
  handleHomeOpenEditProject,
} from "../handlers/commands/cem-edit";
import {
  handleAddChallengeSubmit,
  handleHomeOpenAddChallenge,
  handleHomeOpenNewProject,
  handleNewProjectMarkdownSubmit,
  handleNewProjectStandardSubmit,
} from "../handlers/commands/cem-new";
import { handleProgressSubmit } from "../handlers/commands/cem-progress";
import { handleHomePublish } from "../handlers/commands/cem-publish";
import {
  buildReviewModal,
  handleReviewSubmit,
} from "../handlers/commands/cem-review";
import {
  buildSettingsModal,
  handleSettingsSubmit,
} from "../handlers/commands/cem-settings";
import { updateChallenge } from "../services/challenge";
import { getProjectsWithChallenges } from "../services/project";
import { lazyProvision, updatePreferences } from "../services/user";
import type { HonoEnv, SlackInteractionPayload } from "../types";
import {
  getCurrentYearMonth,
  refreshHome,
  safeWaitUntil,
} from "../utils/handler-helpers";
import { openModal, publishHome } from "../utils/slack-api";
import { buildErrorView, buildHomeView } from "../views/home";

type InteractionContext = Context<HonoEnv>;

export async function interactionRouter(
  c: InteractionContext,
): Promise<Response> {
  const rawBody = c.get("rawBody");
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

      safeWaitUntil(
        c,
        (async () => {
          try {
            const { user } = await lazyProvision(
              c.env.DB,
              slackUserId,
              userName,
            );
            const updatedPrefs = await updatePreferences(c.env.DB, user.id, {
              viewed_year: targetYear,
              viewed_month: targetMonth,
            });
            const projects = await getProjectsWithChallenges(
              c.env.DB,
              user.id,
              targetYear,
              targetMonth,
            );
            const view = buildHomeView(
              user,
              updatedPrefs,
              projects,
              targetYear,
              targetMonth,
            );
            await publishHome(c.env.SLACK_BOT_TOKEN, slackUserId, view);
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

    case "challenge_set_not_started":
    case "challenge_set_in_progress":
    case "challenge_set_completed": {
      const challengeId = parseInt(action?.value ?? "0", 10);
      const statusMap: Record<
        string,
        "not_started" | "in_progress" | "completed"
      > = {
        challenge_set_not_started: "not_started",
        challenge_set_in_progress: "in_progress",
        challenge_set_completed: "completed",
      };
      const newStatus = statusMap[actionId];

      safeWaitUntil(
        c,
        (async () => {
          try {
            await updateChallenge(c.env.DB, challengeId, { status: newStatus });
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

    case "challenge_open_comment": {
      // For overflow menu, the value is in selected_option
      const challengeIdValue =
        action?.selected_option?.value ?? action?.value ?? "";
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
      return handleHomeOpenNewProject(c, payload);

    case "home_open_add_challenge":
      return handleHomeOpenAddChallenge(c, payload);

    case "home_open_settings": {
      const { preferences } = await lazyProvision(
        c.env.DB,
        slackUserId,
        userName,
      );
      const settingsModal = buildSettingsModal(preferences);
      await openModal(c.env.SLACK_BOT_TOKEN, payload.trigger_id, settingsModal);
      return c.text("", 200);
    }

    case "home_open_edit_project":
      return handleHomeOpenEditProject(c, payload);

    case "home_confirm_delete_project":
      return handleHomeConfirmDeleteProject(c, payload);

    case "home_publish":
      return handleHomePublish(c, payload);

    case "home_review_complete": {
      const action2 = payload.actions?.[0];
      const projectId = parseInt(action2?.value ?? "0", 10);

      safeWaitUntil(
        c,
        (async () => {
          try {
            const { user } = await lazyProvision(
              c.env.DB,
              slackUserId,
              userName,
            );

            const { year, month } = getCurrentYearMonth();
            const projects = await getProjectsWithChallenges(
              c.env.DB,
              user.id,
              year,
              month,
            );
            const project = projects.find((p) => p.id === projectId);

            if (!project || project.status !== "published") {
              return;
            }

            const modal = buildReviewModal(project.id, project.challenges);
            await openModal(c.env.SLACK_BOT_TOKEN, payload.trigger_id, modal);
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
    case "modal_new_project_standard":
      return handleNewProjectStandardSubmit(c, payload);
    case "modal_new_project_markdown":
      return handleNewProjectMarkdownSubmit(c, payload);
    case "modal_settings":
      return handleSettingsSubmit(c, payload);
    case "modal_challenge_comment":
      return handleChallengeCommentSubmit(c, payload);
    case "modal_edit_project":
      return handleEditProjectSubmit(c, payload);
    case "modal_delete_project_confirm":
      return handleDeleteProjectConfirmSubmit(c, payload);
    case "modal_progress_report":
      return handleProgressSubmit(c, payload);
    case "modal_review":
      return handleReviewSubmit(c, payload);
    case "modal_add_challenge":
      return handleAddChallengeSubmit(c, payload);
    default:
      return c.text("", 200);
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
    payload.view?.state.values.input_progress_comment?.input_progress_comment
      ?.value ?? "";

  safeWaitUntil(
    c,
    (async () => {
      try {
        await updateChallenge(c.env.DB, challengeId, {
          progress_comment: comment,
        });
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
