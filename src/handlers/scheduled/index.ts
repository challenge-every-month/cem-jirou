import type { Env } from "../../types";
import type { UserRow, ProjectRow, ChallengeRow, ProjectWithChallenges } from "../../types";
import { postMessage, postDm } from "../../utils/slack-api";
import { buildMidMonthMessage, buildMonthEndMessage } from "../../views/channel-messages";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getCurrentYearMonth(): { year: number; month: number; dateStr: string } {
  const now = new Date();
  return {
    year: now.getUTCFullYear(),
    month: now.getUTCMonth() + 1,
    dateStr: now.toISOString().slice(0, 10), // "YYYY-MM-DD"
  };
}

interface UserWithReminder {
  slack_user_id: string;
}

interface ChallengeWithUserId extends ChallengeRow {
  user_id: number;
}

interface ProjectRowWithUser extends ProjectRow {
  user_name: string;
  slack_user_id: string;
}

// ─── DB Query Helpers ─────────────────────────────────────────────────────────

async function queryUsersWithPersonalReminder(env: Env): Promise<UserWithReminder[]> {
  const result = await env.DB
    .prepare(
      `SELECT u.slack_user_id
       FROM users u
       JOIN user_preferences up ON up.user_id = u.id
       WHERE up.personal_reminder = 1`,
    )
    .bind()
    .all<UserWithReminder>();
  return result.results ?? [];
}

async function queryPublishedProjectsForMonth(
  env: Env,
  year: number,
  month: number,
): Promise<ProjectWithChallenges[]> {
  const projectRows = await env.DB
    .prepare(
      `SELECT p.*, u.user_name, u.slack_user_id
       FROM projects p
       JOIN users u ON u.id = p.user_id
       WHERE p.year = ? AND p.month = ? AND p.status = 'published'`,
    )
    .bind(year, month)
    .all<ProjectRowWithUser>();

  const rows = projectRows.results ?? [];
  if (rows.length === 0) {
    return [];
  }

  const projectIds = rows.map((p) => p.id);
  const placeholders = projectIds.map(() => "?").join(", ");
  const challenges = await env.DB
    .prepare(
      `SELECT * FROM challenges WHERE project_id IN (${placeholders})`,
    )
    .bind(...projectIds)
    .all<ChallengeRow>();

  const challengesByProjectId = new Map<number, ChallengeRow[]>();
  for (const ch of challenges.results ?? []) {
    const list = challengesByProjectId.get(ch.project_id) ?? [];
    list.push(ch);
    challengesByProjectId.set(ch.project_id, list);
  }

  return rows.map((project) => ({
    ...project,
    challenges: challengesByProjectId.get(project.id) ?? [],
  }));
}

async function queryPublishedProjectsForUserMonth(
  env: Env,
  slackUserId: string,
  year: number,
  month: number,
): Promise<ProjectWithChallenges[]> {
  const user = await env.DB
    .prepare("SELECT * FROM users WHERE slack_user_id = ?")
    .bind(slackUserId)
    .first<UserRow>();

  if (!user) {
    return [];
  }

  const projectRows = await env.DB
    .prepare(
      `SELECT * FROM projects
       WHERE user_id = ? AND year = ? AND month = ? AND status = 'published'`,
    )
    .bind(user.id, year, month)
    .all<ProjectRow>();

  const rows = projectRows.results ?? [];
  if (rows.length === 0) {
    return [];
  }

  const projectIds = rows.map((p) => p.id);
  const placeholders = projectIds.map(() => "?").join(", ");
  const challenges = await env.DB
    .prepare(
      `SELECT * FROM challenges WHERE project_id IN (${placeholders})`,
    )
    .bind(...projectIds)
    .all<ChallengeRow>();

  const challengesByProjectId = new Map<number, ChallengeRow[]>();
  for (const ch of challenges.results ?? []) {
    const list = challengesByProjectId.get(ch.project_id) ?? [];
    list.push(ch);
    challengesByProjectId.set(ch.project_id, list);
  }

  return rows.map((project) => ({
    ...project,
    challenges: challengesByProjectId.get(project.id) ?? [],
  }));
}

// ─── Cron Handlers ───────────────────────────────────────────────────────────

async function handleMonthStartChannel(env: Env): Promise<void> {
  await postMessage(
    env.SLACK_BOT_TOKEN,
    env.SLACK_POST_CHANNEL_ID,
    "🌕 新月チャレンジ開始！",
    [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "🌕 *新月チャレンジ開始！*\n今月もチャレンジを設定して、目標に向かって進みましょう。\n`/cem_new` でプロジェクトを作成できます！",
        },
      },
    ],
  );
}

async function handleMonthStartDm(env: Env): Promise<void> {
  const users = await queryUsersWithPersonalReminder(env);
  for (const user of users) {
    try {
      await postDm(
        env.SLACK_BOT_TOKEN,
        user.slack_user_id,
        "今月のチャレンジを登録しましょう！ `/cem_new` でプロジェクトを作成できます。",
      );
    } catch (err) {
      console.error(`Failed to send month-start DM to ${user.slack_user_id}:`, err);
    }
  }
}

async function handleMidMonthChannel(env: Env): Promise<void> {
  const { year, month } = getCurrentYearMonth();
  const projects = await queryPublishedProjectsForMonth(env, year, month);
  const payload = buildMidMonthMessage(projects, year, month);
  await postMessage(
    env.SLACK_BOT_TOKEN,
    env.SLACK_POST_CHANNEL_ID,
    payload.text ?? `${year}年${month}月 中間チェック`,
    payload.blocks as unknown[] | undefined,
  );
}

async function handleMonthEndChannel(env: Env): Promise<void> {
  const { year, month } = getCurrentYearMonth();
  const projects = await queryPublishedProjectsForMonth(env, year, month);
  const payload = buildMonthEndMessage(projects, year, month);
  await postMessage(
    env.SLACK_BOT_TOKEN,
    env.SLACK_POST_CHANNEL_ID,
    payload.text ?? `${year}年${month}月 月末振り返りリマインダー`,
    payload.blocks as unknown[] | undefined,
  );
}

async function handleMonthEndDm(env: Env): Promise<void> {
  const { year, month } = getCurrentYearMonth();
  const users = await queryUsersWithPersonalReminder(env);

  for (const user of users) {
    try {
      // Basic reminder
      await postDm(
        env.SLACK_BOT_TOKEN,
        user.slack_user_id,
        "今月のチャレンジ振り返りの時間です！ `/cem_review` で結果を記録しましょう。",
      );

      // TASK-702: Also send progress summary if user has published projects
      const projects = await queryPublishedProjectsForUserMonth(
        env,
        user.slack_user_id,
        year,
        month,
      );

      if (projects.length > 0) {
        const lines = projects.map((p) => {
          const completed = p.challenges.filter((ch) => ch.status === "completed").length;
          const total = p.challenges.length;
          return `• *${p.title}*: ${completed}/${total} チャレンジ達成`;
        });
        const summaryText = `今月の進捗まとめ:\n${lines.join("\n")}`;
        await postDm(env.SLACK_BOT_TOKEN, user.slack_user_id, summaryText);
      }
    } catch (err) {
      console.error(`Failed to send month-end DM to ${user.slack_user_id}:`, err);
    }
  }
}

async function handleDueDateCheck(env: Env): Promise<void> {
  const { dateStr } = getCurrentYearMonth();

  const result = await env.DB
    .prepare(
      `SELECT c.*, p.user_id
       FROM challenges c
       JOIN projects p ON p.id = c.project_id
       WHERE c.due_on = ? AND c.status NOT IN ('completed', 'incompleted')`,
    )
    .bind(dateStr)
    .all<ChallengeWithUserId>();

  const challenges = result.results ?? [];

  for (const challenge of challenges) {
    try {
      const user = await env.DB
        .prepare("SELECT slack_user_id FROM users WHERE id = ?")
        .bind(challenge.user_id)
        .first<Pick<UserRow, "slack_user_id">>();

      if (!user) {
        continue;
      }

      await postDm(
        env.SLACK_BOT_TOKEN,
        user.slack_user_id,
        `本日が期日のチャレンジ: ${challenge.name}`,
      );
    } catch (err) {
      console.error(`Failed to send due-date DM for challenge ${challenge.id}:`, err);
    }
  }
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

export async function handleScheduled(
  event: ScheduledEvent,
  env: Env,
): Promise<void> {
  console.log(`Cron triggered: ${event.cron}`);

  try {
    switch (event.cron) {
      case "0 0 1 * *":
        await handleMonthStartChannel(env);
        break;

      case "0 1 1 * *":
        await handleMonthStartDm(env);
        break;

      case "0 0 15 * *":
        await handleMidMonthChannel(env);
        break;

      case "0 0 25 * *":
        await handleMonthEndChannel(env);
        break;

      case "0 1 25 * *":
        await handleMonthEndDm(env);
        break;

      case "0 0 * * *":
        await handleDueDateCheck(env);
        break;

      default:
        console.warn(`Unknown cron expression: ${event.cron}`);
    }
  } catch (err) {
    console.error(`Cron handler failed for ${event.cron}:`, err);
  }
}
