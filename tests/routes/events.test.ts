import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import type { Env } from "../../src/types";
import { eventRouter } from "../../src/routes/events";

function makeTestApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.post("/slack/events", eventRouter);
  return app;
}

describe("eventRouter", () => {
  it("responds with challenge for url_verification", async () => {
    const app = makeTestApp();

    const res = await app.request("/slack/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "url_verification", challenge: "test_challenge" }),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as { challenge: string };
    expect(data.challenge).toBe("test_challenge");
  });

  it("returns 200 for app_home_opened event", async () => {
    const app = makeTestApp();

    const res = await app.request("/slack/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "event_callback",
        event: { type: "app_home_opened", user: "U12345", tab: "home" },
      }),
    });

    expect(res.status).toBe(200);
  });
});
