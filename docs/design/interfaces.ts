// =============================================================================
// CEM Jirou — 共通 TypeScript インターフェース定義
// =============================================================================

// =============================================================================
// Cloudflare Workers Bindings
// =============================================================================

export interface Env {
  DB: D1Database;
  SLACK_SIGNING_SECRET: string;
  SLACK_BOT_TOKEN: string;
  SLACK_POST_CHANNEL_ID: string;
}

// =============================================================================
// Database Row Types（DDL に直接対応）
// =============================================================================

export interface UserRow {
  id: number;
  slack_user_id: string;
  user_name: string;
  created_at: string; // ISO datetime string
  updated_at: string;
}

export interface UserPreferencesRow {
  id: number;
  user_id: number;
  markdown_mode: number;   // SQLite BOOLEAN → 0 | 1
  personal_reminder: number; // SQLite BOOLEAN → 0 | 1
  viewed_year: number | null;
  viewed_month: number | null;
  created_at: string;
  updated_at: string;
}

export type ProjectStatus = "draft" | "published" | "reviewed";

export interface ProjectRow {
  id: number;
  user_id: number;
  title: string;
  year: number;
  month: number;
  status: ProjectStatus;
  is_inbox: number; // SQLite BOOLEAN → 0 | 1
  created_at: string;
  updated_at: string;
}

export type ChallengeStatus =
  | "draft"
  | "not_started"
  | "in_progress"
  | "completed"
  | "incompleted";

export interface ChallengeRow {
  id: number;
  project_id: number;
  name: string;
  status: ChallengeStatus;
  due_on: string | null;           // "YYYY-MM-DD" または null
  progress_comment: string | null;
  review_comment: string | null;
  created_at: string;
  updated_at: string;
}

export interface VersionRow {
  id: number;
  version_code: string;
  updated_at: string;
}

// =============================================================================
// Domain Types
// =============================================================================

/** Project と配下 Challenge を eager load した集約 */
export interface ProjectWithChallenges extends ProjectRow {
  challenges: ChallengeRow[];
}

// =============================================================================
// Service / Use-case Types
// =============================================================================

export interface LazyProvisionResult {
  user: UserRow;
  preferences: UserPreferencesRow;
  /** 新規作成された場合 true */
  wasCreated: boolean;
}

// マークダウンモードパーサーの出力
export interface ParsedProject {
  /** null = inbox（# 見出しなし） */
  title: string | null;
  challenges: ParsedChallenge[];
}

export interface ParsedChallenge {
  name: string;
  /** "YYYY-MM-DD" または null */
  due_on: string | null;
}

// =============================================================================
// Mutation Input Types（内部 Service 呼び出し用）
// =============================================================================

export interface CreateProjectInput {
  user_id: number;
  title: string;
  year: number;
  month: number;
  is_inbox?: boolean;
}

export interface CreateChallengeInput {
  project_id: number;
  name: string;
  due_on?: string | null;
}

export interface UpdateProjectInput {
  title?: string;
  status?: ProjectStatus;
}

export interface UpdateChallengeInput {
  name?: string;
  due_on?: string | null;
  status?: ChallengeStatus;
  progress_comment?: string | null;
  review_comment?: string | null;
}

export interface UpdatePreferencesInput {
  markdown_mode?: boolean;
  personal_reminder?: boolean;
  viewed_year?: number | null;
  viewed_month?: number | null;
}

export interface ReviewDecision {
  challengeId: number;
  status: "completed" | "incompleted";
  reviewComment?: string;
}

// =============================================================================
// Slack Slash Command Payload（x-www-form-urlencoded）
// =============================================================================

export interface SlackCommandPayload {
  command: string;       // "/cem_new" など
  text: string;
  user_id: string;
  user_name: string;
  channel_id: string;
  trigger_id: string;
  response_url: string;
  team_id: string;
}

// =============================================================================
// Slack Interaction Payload（JSON body）
// =============================================================================

export interface SlackInteractionPayload {
  type: "block_actions" | "view_submission" | "view_closed";
  trigger_id: string;
  user: {
    id: string;
    username: string;
    name: string;
  };
  actions?: SlackBlockAction[];
  view?: SlackView;
}

export interface SlackBlockAction {
  action_id: string;
  block_id: string;
  value?: string;
  type: string;
  selected_option?: { value: string };
}

export interface SlackView {
  id: string;
  callback_id: string;
  /** JSON 文字列で context を渡す */
  private_metadata?: string;
  state: {
    values: Record<
      string, // block_id
      Record<
        string, // action_id
        {
          type: string;
          value?: string;
          selected_date?: string;
          selected_option?: { value: string };
        }
      >
    >;
  };
}

// =============================================================================
// Slack Events API Payload
// =============================================================================

export interface SlackEventPayload {
  type: "url_verification" | "event_callback";
  token?: string;
  challenge?: string; // url_verification 用
  event?: SlackEvent;
}

export interface SlackEvent {
  type: string; // "app_home_opened" など
  user: string; // slack_user_id
  tab?: "home" | "messages"; // app_home_opened 用
  event_ts?: string;
}

// =============================================================================
// Slack API Request Types（Bot Token 使用）
// =============================================================================

export interface SlackPostMessageRequest {
  channel: string;
  text?: string;
  blocks?: unknown[];
}

export interface SlackViewsOpenRequest {
  trigger_id: string;
  view: unknown; // Block Kit view object
}

export interface SlackViewsPublishRequest {
  user_id: string;
  view: unknown; // Block Kit view object
}

// =============================================================================
// Error Types
// =============================================================================

export type AppErrorCode =
  | "INVALID_USER_ID"
  | "USER_NOT_FOUND"
  | "PROJECT_NOT_FOUND"
  | "CHALLENGE_NOT_FOUND"
  | "FORBIDDEN"
  | "PROJECT_ALREADY_REVIEWED"
  | "CHALLENGE_LIMIT_EXCEEDED"
  | "INVALID_YEAR_MONTH"
  | "DB_ERROR";

export interface AppError {
  code: AppErrorCode;
  message: string;
  status: number;
}
