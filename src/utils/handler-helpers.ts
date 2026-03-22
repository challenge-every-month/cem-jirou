import type { Context } from "hono";
import { getProjectsWithChallenges } from "../services/project";
import { lazyProvision } from "../services/user";
import type { HonoEnv } from "../types";
import { buildHomeView, resolveDisplayMonth } from "../views/home";
import { publishHome } from "./slack-api";

type AppContext = Context<HonoEnv>;

/**
 * Returns the current UTC year, month, and date string.
 * Centralises the repeated `new Date()` / getUTCFullYear pattern.
 */
export function getCurrentYearMonth(): {
  year: number;
  month: number;
  dateStr: string;
} {
  const now = new Date();
  return {
    year: now.getUTCFullYear(),
    month: now.getUTCMonth() + 1,
    dateStr: now.toISOString().slice(0, 10),
  };
}

/**
 * Schedules async work via `executionCtx.waitUntil` when available.
 * Falls back silently in test environments where executionCtx is absent.
 */
export function safeWaitUntil(c: AppContext, promise: Promise<void>): void {
  try {
    c.executionCtx.waitUntil(promise);
  } catch {
    // executionCtx not available in test environment
  }
}

/**
 * Re-renders and publishes the App Home Tab for a given user.
 * Calls lazyProvision so it is safe to call even before user creation.
 */
export async function refreshHome(
  c: AppContext,
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
