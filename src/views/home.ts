import type {
  ProjectWithChallenges,
  UserPreferencesRow,
  UserRow,
} from "../types";

// ─── Utilities ───────────────────────────────────────────────────────────────

function calcPrevMonth(
  year: number,
  month: number,
): { year: number; month: number } {
  return month === 1
    ? { year: year - 1, month: 12 }
    : { year, month: month - 1 };
}

function calcNextMonth(
  year: number,
  month: number,
): { year: number; month: number } {
  return month === 12
    ? { year: year + 1, month: 1 }
    : { year, month: month + 1 };
}

export function resolveDisplayMonth(preferences: UserPreferencesRow): {
  year: number;
  month: number;
} {
  const now = new Date();
  return {
    year: preferences.viewed_year ?? now.getUTCFullYear(),
    month: preferences.viewed_month ?? now.getUTCMonth() + 1,
  };
}

export function isCurrentOrFutureMonth(year: number, month: number): boolean {
  const now = new Date();
  const cy = now.getUTCFullYear();
  const cm = now.getUTCMonth() + 1;
  return year > cy || (year === cy && month >= cm);
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function buildNavSection(
  displayYear: number,
  displayMonth: number,
  userName: string,
): unknown[] {
  const prev = calcPrevMonth(displayYear, displayMonth);
  const next = calcNextMonth(displayYear, displayMonth);

  return [
    {
      type: "section",
      text: { type: "mrkdwn", text: `👋 こんにちは、${userName}!` },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `${displayYear}年${displayMonth}月のチャレンジ`,
        },
      ],
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "← 前月" },
          action_id: "home_nav_prev",
          value: `${prev.year}-${prev.month}`,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "次月 →" },
          action_id: "home_nav_next",
          value: `${next.year}-${next.month}`,
        },
      ],
    },
    { type: "divider" },
  ];
}

function buildChallengeRow(challenge: {
  id: number;
  name: string;
  status: string;
  due_on: string | null;
}): unknown[] {
  const iconMap: Record<string, string> = {
    draft: "⚪",
    not_started: "🔴",
    in_progress: "🔵",
    completed: "✅",
    incompleted: "❌",
  };
  const icon = iconMap[challenge.status] ?? "⚪";
  const dueText = challenge.due_on ? `  期日: ${challenge.due_on}` : "";

  const blocks: unknown[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: `${icon} ${challenge.name}${dueText}` },
      accessory: {
        type: "overflow",
        action_id: "challenge_open_comment",
        options: [
          {
            text: { type: "plain_text", text: "💬 コメントを追加" },
            value: String(challenge.id),
          },
        ],
      },
    },
  ];

  if (
    challenge.status === "not_started" ||
    challenge.status === "in_progress"
  ) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "未着手" },
          action_id: "challenge_set_not_started",
          value: String(challenge.id),
        },
        {
          type: "button",
          text: { type: "plain_text", text: "進行中" },
          action_id: "challenge_set_in_progress",
          value: String(challenge.id),
        },
        {
          type: "button",
          text: { type: "plain_text", text: "✅済" },
          action_id: "challenge_set_completed",
          value: String(challenge.id),
          style: "primary",
        },
      ],
    });
  }

  return blocks;
}

function buildProjectSection(project: ProjectWithChallenges): unknown[] {
  const badgeMap: Record<string, string> = {
    draft: "🟡",
    published: "🟢",
    reviewed: "✅",
  };
  const statusBadge = badgeMap[project.status] ?? "🟡";

  const blocks: unknown[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `${statusBadge} ${project.title}` },
    },
  ];

  for (const ch of project.challenges) {
    blocks.push(...buildChallengeRow(ch));
  }

  const projectActions: unknown[] = [
    {
      type: "button",
      text: { type: "plain_text", text: "+ チャレンジ追加" },
      action_id: "home_open_add_challenge",
      value: String(project.id),
    },
  ];

  if (project.status !== "reviewed") {
    projectActions.push(
      {
        type: "button",
        text: { type: "plain_text", text: "✏️ 編集" },
        action_id: "home_open_edit_project",
        value: String(project.id),
      },
      {
        type: "button",
        text: { type: "plain_text", text: "🗑️ 削除" },
        action_id: "home_confirm_delete_project",
        value: String(project.id),
        style: "danger",
      },
    );
  }

  const allDone =
    project.challenges.length > 0 &&
    project.challenges.every(
      (ch) => ch.status === "completed" || ch.status === "incompleted",
    );
  if (project.status === "published" && allDone) {
    projectActions.push({
      type: "button",
      text: { type: "plain_text", text: "📋 振り返りを完了する" },
      action_id: "home_review_complete",
      value: String(project.id),
      style: "primary",
    });
  }

  blocks.push({ type: "actions", elements: projectActions });
  blocks.push({ type: "divider" });

  return blocks;
}

function buildEmptyState(): unknown[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "まだチャレンジがありません 🌱\n＋ プロジェクト追加 から登録してみましょう！",
      },
    },
  ];
}

function buildFooterActions(hasDraftProjects: boolean): unknown[] {
  const footerActions: unknown[] = [
    {
      type: "button",
      text: { type: "plain_text", text: "＋ プロジェクト追加" },
      action_id: "home_open_new_project",
    },
  ];

  if (hasDraftProjects) {
    footerActions.push({
      type: "button",
      text: { type: "plain_text", text: "📣 今月を宣言する" },
      action_id: "home_publish",
      style: "primary",
    });
  }

  footerActions.push({
    type: "button",
    text: { type: "plain_text", text: "⚙️ 設定" },
    action_id: "home_open_settings",
  });

  return [{ type: "actions", elements: footerActions }];
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function buildHomeView(
  user: UserRow,
  preferences: UserPreferencesRow,
  projects: ProjectWithChallenges[],
  displayYear: number,
  displayMonth: number,
): { type: "home"; blocks: unknown[] } {
  void preferences; // preferences may be used in future for personalisation
  const blocks: unknown[] = [];

  // 1. Nav section
  blocks.push(...buildNavSection(displayYear, displayMonth, user.user_name));

  // 2. Empty state or project sections
  if (projects.length === 0) {
    blocks.push(...buildEmptyState());
  } else {
    for (const project of projects) {
      blocks.push(...buildProjectSection(project));
    }
  }

  // 3. Footer actions
  const hasDraftProjects = projects.some((p) => p.status === "draft");
  blocks.push(...buildFooterActions(hasDraftProjects));

  return { type: "home", blocks };
}

export function buildErrorView(message: string): {
  type: "home";
  blocks: unknown[];
} {
  return {
    type: "home",
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `⚠️ 表示中にエラーが発生しました。しばらく待ってから再度お試しください。\n\`${message}\``,
        },
      },
    ],
  };
}
