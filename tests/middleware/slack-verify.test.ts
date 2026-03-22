import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
  slackVerifyMiddleware,
  timingSafeEqual,
  verifySlackSignature,
} from "../../src/middleware/slack-verify";
import type { Env, HonoEnv } from "../../src/types";

// ---------------------------------------------------------------------------
// Helper: generate a real HMAC-SHA256 signature the same way the middleware does
// ---------------------------------------------------------------------------
async function makeSignature(
  signingSecret: string,
  timestamp: string,
  rawBody: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const basestring = `v0:${timestamp}:${rawBody}`;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(basestring),
  );
  const hex = Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `v0=${hex}`;
}

// ---------------------------------------------------------------------------
// Helper: build a test Hono app with the middleware applied
// ---------------------------------------------------------------------------
function makeTestApp(_env: Partial<Env> = {}) {
  const app = new Hono<HonoEnv>();
  app.use("/slack/*", slackVerifyMiddleware);
  app.post("/slack/test", (c) => c.text("ok", 200));
  return app;
}

const TEST_SECRET = "test-signing-secret";
const _TEST_ENV: Partial<Env> = { SLACK_SIGNING_SECRET: TEST_SECRET };

// ---------------------------------------------------------------------------
// timingSafeEqual
// ---------------------------------------------------------------------------
describe("timingSafeEqual", () => {
  it("returns true for identical strings", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
  });

  it("returns false when content differs", () => {
    expect(timingSafeEqual("abc", "abd")).toBe(false);
  });

  it("returns false when lengths differ", () => {
    expect(timingSafeEqual("ab", "abc")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// verifySlackSignature
// ---------------------------------------------------------------------------
describe("verifySlackSignature", () => {
  it("returns true for a known-valid HMAC signature", async () => {
    const timestamp = "1609459200";
    const rawBody = "command=%2Ftest&text=hello";
    const signature = await makeSignature(TEST_SECRET, timestamp, rawBody);

    const result = await verifySlackSignature({
      signingSecret: TEST_SECRET,
      timestamp,
      rawBody,
      signature,
    });
    expect(result).toBe(true);
  });

  it("returns false for a wrong signature", async () => {
    const result = await verifySlackSignature({
      signingSecret: TEST_SECRET,
      timestamp: "1609459200",
      rawBody: "command=%2Ftest",
      signature: "v0=deadbeefdeadbeef",
    });
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// slackVerifyMiddleware
// ---------------------------------------------------------------------------
describe("slackVerifyMiddleware", () => {
  it("passes a valid request through and calls next (returns 200)", async () => {
    const app = makeTestApp();
    const timestamp = String(Math.floor(Date.now() / 1000));
    const rawBody = "command=%2Ftest&text=hello";
    const signature = await makeSignature(TEST_SECRET, timestamp, rawBody);

    const res = await app.request(
      "/slack/test",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Slack-Request-Timestamp": timestamp,
          "X-Slack-Signature": signature,
        },
        body: rawBody,
      },
      { SLACK_SIGNING_SECRET: TEST_SECRET } as unknown as Env,
    );

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("returns 200 empty when X-Slack-Retry-Num header is present", async () => {
    const app = makeTestApp();
    const timestamp = String(Math.floor(Date.now() / 1000));

    const res = await app.request(
      "/slack/test",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Slack-Request-Timestamp": timestamp,
          "X-Slack-Retry-Num": "1",
          "X-Slack-Signature": "v0=ignored",
        },
        body: "command=%2Ftest",
      },
      { SLACK_SIGNING_SECRET: TEST_SECRET } as unknown as Env,
    );

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });

  it("returns 403 when timestamp is older than 300 seconds", async () => {
    const app = makeTestApp();
    const staleTimestamp = String(Math.floor(Date.now() / 1000) - 400);
    const rawBody = "command=%2Ftest";
    const signature = await makeSignature(TEST_SECRET, staleTimestamp, rawBody);

    const res = await app.request(
      "/slack/test",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Slack-Request-Timestamp": staleTimestamp,
          "X-Slack-Signature": signature,
        },
        body: rawBody,
      },
      { SLACK_SIGNING_SECRET: TEST_SECRET } as unknown as Env,
    );

    expect(res.status).toBe(403);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe("Forbidden");
  });

  it("returns 403 when signature is wrong", async () => {
    const app = makeTestApp();
    const timestamp = String(Math.floor(Date.now() / 1000));

    const res = await app.request(
      "/slack/test",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Slack-Request-Timestamp": timestamp,
          "X-Slack-Signature": "v0=badbadbadbadbadbad",
        },
        body: "command=%2Ftest",
      },
      { SLACK_SIGNING_SECRET: TEST_SECRET } as unknown as Env,
    );

    expect(res.status).toBe(403);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe("Forbidden");
  });
});
