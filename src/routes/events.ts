import type { Context } from "hono";
import { getProjectsWithChallenges } from "../services/project";
import { lazyProvision } from "../services/user";
import type { HonoEnv, SlackEventPayload } from "../types";
import { publishHome } from "../utils/slack-api";
import {
  buildErrorView,
  buildHomeView,
  resolveDisplayMonth,
} from "../views/home";

type EventContext = Context<HonoEnv>;

export async function eventRouter(c: EventContext): Promise<Response> {
  const body = (await c.req.json()) as SlackEventPayload;

  // url_verification challenge handshake
  if (body.type === "url_verification") {
    return c.json({ challenge: body.challenge });
  }

  if (
    body.type === "event_callback" &&
    body.event?.type === "app_home_opened"
  ) {
    const slackUserId = body.event?.user ?? "";

    // Acknowledge immediately, process in waitUntil (if available)
    const work = (async () => {
      try {
        const { user, preferences } = await lazyProvision(
          c.env.DB,
          slackUserId,
          slackUserId,
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
      } catch (e) {
        try {
          const view = buildErrorView(
            e instanceof Error ? e.message : "Unknown error",
          );
          await publishHome(c.env.SLACK_BOT_TOKEN, slackUserId, view);
        } catch {
          // suppress fallback errors (e.g. missing env in tests)
        }
      }
    })();

    try {
      c.executionCtx.waitUntil(work);
    } catch {
      // executionCtx not available in test environment — let work run in background
    }

    return c.text("", 200);
  }

  return c.text("", 200);
}
