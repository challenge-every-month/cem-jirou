import type {
  UserRow,
  ProjectRow,
  ChallengeRow,
  ChallengeStatus,
  ProjectWithChallenges,
  SlackPostMessageRequest,
} from "../types";

// ─── Status emoji map ────────────────────────────────────────────────────────

const STATUS_EMOJI: Record<ChallengeStatus, string> = {
  not_started: "⬜",
  in_progress: "🔄",
  completed: "✅",
  incompleted: "❌",
  draft: "📝",
};

function challengeStatusEmoji(status: ChallengeStatus): string {
  return STATUS_EMOJI[status] ?? "📝";
}

function formatChallengeList(challenges: ChallengeRow[]): string {
  if (challenges.length === 0) {
    return "_(チャレンジなし)_";
  }
  return challenges
    .map((ch) => {
      const emoji = challengeStatusEmoji(ch.status);
      const due = ch.due_on ? ` _(期日: ${ch.due_on})_` : "";
      return `${emoji} ${ch.name}${due}`;
    })
    .join("\n");
}

// ─── TASK-601-A: buildPublishMessage ─────────────────────────────────────────

/**
 * Builds the Block Kit payload for publishing a project to the Slack channel.
 */
export function buildPublishMessage(
  user: UserRow,
  project: ProjectRow,
  challenges: ChallengeRow[],
): SlackPostMessageRequest {
  const challengeText = formatChallengeList(challenges);

  return {
    channel: "",   // caller must fill in channel
    text: `${user.user_name} が今月のチャレンジを宣言しました！`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `📣 *${user.user_name}* が今月のチャレンジを宣言しました！`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*プロジェクト: ${project.title}*`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: challengeText,
        },
      },
      {
        type: "divider",
      },
    ],
  };
}

// ─── TASK-601-B: buildMidMonthMessage ────────────────────────────────────────

/**
 * Builds the "mid-month check" channel message (used by cron TASK-701).
 * Only shows published projects.
 */
export function buildMidMonthMessage(
  projects: ProjectWithChallenges[],
  year: number,
  month: number,
): SlackPostMessageRequest {
  const published = projects.filter((p) => p.status !== "draft");

  const blocks: unknown[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `📊 *${year}年${month}月 — 中間チェック！*\n今月の進捗を確認しましょう。`,
      },
    },
    { type: "divider" },
  ];

  if (published.length === 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "_(公開中のプロジェクトはありません)_",
      },
    });
  } else {
    for (const project of published) {
      const completedCount = project.challenges.filter(
        (ch) => ch.status === "completed",
      ).length;
      const totalCount = project.challenges.length;
      const challengeText = formatChallengeList(project.challenges);

      blocks.push(
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${project.title}* — 進捗: ${completedCount}/${totalCount}`,
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: challengeText,
          },
        },
        { type: "divider" },
      );
    }
  }

  return {
    channel: "",
    text: `${year}年${month}月 中間チェック`,
    blocks,
  };
}

// ─── TASK-601-C: buildMonthEndMessage ────────────────────────────────────────

/**
 * Builds the "month-end review reminder" channel message (used by cron TASK-702).
 * Only shows published projects.
 */
export function buildMonthEndMessage(
  projects: ProjectWithChallenges[],
  year: number,
  month: number,
): SlackPostMessageRequest {
  const published = projects.filter((p) => p.status !== "draft");

  const blocks: unknown[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `📋 *${year}年${month}月 — 月末振り返りの時間です！*\n\`/cem_review\` で結果を記録しましょう。`,
      },
    },
    { type: "divider" },
  ];

  if (published.length === 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "_(公開中のプロジェクトはありません)_",
      },
    });
  } else {
    for (const project of published) {
      const completedCount = project.challenges.filter(
        (ch) => ch.status === "completed",
      ).length;
      const totalCount = project.challenges.length;
      const challengeText = formatChallengeList(project.challenges);

      blocks.push(
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${project.title}* — 最終結果: ${completedCount}/${totalCount}`,
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: challengeText,
          },
        },
        { type: "divider" },
      );
    }
  }

  return {
    channel: "",
    text: `${year}年${month}月 月末振り返りリマインダー`,
    blocks,
  };
}
