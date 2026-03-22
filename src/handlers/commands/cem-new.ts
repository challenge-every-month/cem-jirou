import { lazyProvision } from "../../services/user";
import { parseMarkdownInput } from "../../utils/markdown-parser";
import { createProject, getOrCreateInboxProject } from "../../services/project";
import { createChallenge } from "../../services/challenge";
import { openModal } from "../../utils/slack-api";
import type { Context } from "hono";
import type { Env, SlackInteractionPayload } from "../../types";

export async function handleCemNew(c: Context<{ Bindings: Env }>, params: URLSearchParams): Promise<Response> {
  const slackUserId = params.get("user_id") ?? "";
  const userName = params.get("user_name") ?? "";
  const triggerId = params.get("trigger_id") ?? "";

  const { preferences } = await lazyProvision(c.env.DB, slackUserId, userName);
  const useMarkdown = preferences.markdown_mode === 1;

  const modal = useMarkdown ? buildMarkdownModal() : buildStandardModal();

  // views.open must be synchronous (within 3s)
  await openModal(c.env.SLACK_BOT_TOKEN, triggerId, modal);

  return c.text("", 200);
}

// Standard modal — callback_id: modal_new_project_standard
function buildStandardModal() {
  return {
    type: "modal",
    callback_id: "modal_new_project_standard",
    title: { type: "plain_text", text: "新しいチャレンジを登録" },
    submit: { type: "plain_text", text: "登録" },
    close: { type: "plain_text", text: "キャンセル" },
    blocks: [
      {
        type: "input",
        block_id: "input_project_title",
        optional: true,
        label: { type: "plain_text", text: "Project タイトル（任意）" },
        element: { type: "plain_text_input", action_id: "input_project_title", placeholder: { type: "plain_text", text: "例: 英語学習" } },
      },
      {
        type: "input",
        block_id: "input_challenge_name_0",
        label: { type: "plain_text", text: "Challenge 名" },
        element: { type: "plain_text_input", action_id: "input_challenge_name_0", placeholder: { type: "plain_text", text: "例: Anki 30分" } },
      },
      {
        type: "input",
        block_id: "input_due_on_0",
        optional: true,
        label: { type: "plain_text", text: "期日（任意）" },
        element: { type: "datepicker", action_id: "input_due_on_0" },
      },
    ],
  };
}

// Markdown modal — callback_id: modal_new_project_markdown
function buildMarkdownModal() {
  return {
    type: "modal",
    callback_id: "modal_new_project_markdown",
    title: { type: "plain_text", text: "新しいチャレンジを登録" },
    submit: { type: "plain_text", text: "登録" },
    close: { type: "plain_text", text: "キャンセル" },
    blocks: [
      {
        type: "input",
        block_id: "input_markdown_text",
        label: { type: "plain_text", text: "マークダウン入力" },
        element: {
          type: "plain_text_input",
          action_id: "input_markdown_text",
          multiline: true,
          placeholder: { type: "plain_text", text: "# プロジェクト名\n- チャレンジ名 @15" },
        },
      },
    ],
  };
}

// Handle view_submission for modal_new_project_standard
export async function handleNewProjectStandardSubmit(
  c: Context<{ Bindings: Env }>,
  payload: SlackInteractionPayload,
): Promise<Response> {
  const slackUserId = payload.user.id;
  const userName = payload.user.username ?? payload.user.name;
  const { user } = await lazyProvision(c.env.DB, slackUserId, userName);

  const values = payload.view!.state.values;
  const title = values["input_project_title"]?.["input_project_title"]?.value?.trim() ?? "";
  const challengeName = values["input_challenge_name_0"]?.["input_challenge_name_0"]?.value?.trim() ?? "";
  const dueOn = values["input_due_on_0"]?.["input_due_on_0"]?.selected_date ?? null;

  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;

  let project;
  if (title) {
    project = await createProject(c.env.DB, { user_id: user.id, title, year, month });
  } else {
    project = await getOrCreateInboxProject(c.env.DB, user.id, year, month);
  }

  if (challengeName) {
    await createChallenge(c.env.DB, { project_id: project.id, name: challengeName, due_on: dueOn });
  }

  return c.text("", 200);
}

// Handle view_submission for modal_new_project_markdown
export async function handleNewProjectMarkdownSubmit(
  c: Context<{ Bindings: Env }>,
  payload: SlackInteractionPayload,
): Promise<Response> {
  const slackUserId = payload.user.id;
  const userName = payload.user.username ?? payload.user.name;
  const { user } = await lazyProvision(c.env.DB, slackUserId, userName);

  const values = payload.view!.state.values;
  const text = values["input_markdown_text"]?.["input_markdown_text"]?.value ?? "";

  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;

  const parsed = parseMarkdownInput(text, year, month);

  for (const parsedProject of parsed) {
    let project;
    if (parsedProject.title) {
      project = await createProject(c.env.DB, { user_id: user.id, title: parsedProject.title, year, month });
    } else {
      project = await getOrCreateInboxProject(c.env.DB, user.id, year, month);
    }
    for (const ch of parsedProject.challenges) {
      await createChallenge(c.env.DB, { project_id: project.id, name: ch.name, due_on: ch.due_on });
    }
  }

  return c.text("", 200);
}
