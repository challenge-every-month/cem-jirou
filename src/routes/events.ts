import type { Context } from "hono";
import type { Env, SlackEventPayload } from "../types";

type EventContext = Context<{ Bindings: Env }>;

export async function eventRouter(c: EventContext): Promise<Response> {
  const body = (await c.req.json()) as SlackEventPayload;

  // url_verification challenge handshake
  if (body.type === "url_verification") {
    return c.json({ challenge: body.challenge });
  }

  if (body.type === "event_callback" && body.event?.type === "app_home_opened") {
    // stub: acknowledge immediately; App Home rendering added in a later task
    return c.text("", 200);
  }

  return c.text("", 200);
}
