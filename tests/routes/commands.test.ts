import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import type { Env } from "../../src/types";
import { commandRouter } from "../../src/routes/commands";

// Build a test app that bypasses signature middleware by injecting rawBody directly.
function makeTestApp() {
  const app = new Hono<{ Bindings: Env }>();

  // Inject rawBody into context before routing (simulates middleware)
  app.use("/slack/commands", async (c, next) => {
    const body = await c.req.text();
    c.set("rawBody" as never, body as never);
    await next();
  });

  app.post("/slack/commands", commandRouter);
  return app;
}

function makeFormBody(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

describe("commandRouter", () => {
  it("returns ephemeral 'Unknown command' for an unrecognised command", async () => {
    const app = makeTestApp();
    const body = makeFormBody({ command: "/unknown", text: "" });

    const res = await app.request("/slack/commands", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as { response_type: string; text: string };
    expect(data.response_type).toBe("ephemeral");
    expect(data.text).toContain("Unknown command");
  });

  it("returns 200 for /cem_new (stub)", async () => {
    const app = makeTestApp();
    const body = makeFormBody({ command: "/cem_new", text: "" });

    const res = await app.request("/slack/commands", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    expect(res.status).toBe(200);
  });

  it("returns 200 for /cem_settings (stub)", async () => {
    const app = makeTestApp();
    const body = makeFormBody({ command: "/cem_settings", text: "" });

    const res = await app.request("/slack/commands", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    expect(res.status).toBe(200);
  });
});
