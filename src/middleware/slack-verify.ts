import type { MiddlewareHandler } from "hono";
import type { Env } from "../types";

/**
 * Byte-by-byte XOR comparison with constant-time semantics.
 * Returns false immediately if lengths differ.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Verifies a Slack request signature using HMAC-SHA256 via crypto.subtle.
 * basestring = "v0:" + timestamp + ":" + rawBody
 */
export async function verifySlackSignature(opts: {
  signingSecret: string;
  timestamp: string;
  rawBody: string;
  signature: string;
}): Promise<boolean> {
  const { signingSecret, timestamp, rawBody, signature } = opts;
  const encoder = new TextEncoder();
  const basestring = `v0:${timestamp}:${rawBody}`;

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signatureBytes = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(basestring),
  );

  const hexSignature = Array.from(new Uint8Array(signatureBytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const expected = `v0=${hexSignature}`;
  return timingSafeEqual(expected, signature);
}

/**
 * Hono middleware that verifies incoming Slack request signatures.
 *
 * Steps:
 *   a. X-Slack-Retry-Num present → return 200 empty (suppress retries)
 *   b. Timestamp check — reject if |now - ts| > 300s
 *   c. Read rawBody and store in context
 *   d. Verify HMAC-SHA256 signature
 */
export const slackVerifyMiddleware: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  // a. Suppress Slack retries
  if (c.req.header("X-Slack-Retry-Num") !== undefined) {
    return c.text("", 200);
  }

  // b. Timestamp freshness check
  const timestampHeader = c.req.header("X-Slack-Request-Timestamp");
  if (!timestampHeader) {
    return c.json({ error: "Forbidden" }, 403);
  }
  const timestamp = Number(timestampHeader);
  if (Math.abs(Date.now() / 1000 - timestamp) > 300) {
    return c.json({ error: "Forbidden" }, 403);
  }

  // c. Read and store rawBody
  const rawBody = await c.req.text();
  c.set("rawBody" as never, rawBody as never);

  // d. Verify signature
  const signature = c.req.header("X-Slack-Signature") ?? "";
  const valid = await verifySlackSignature({
    signingSecret: c.env.SLACK_SIGNING_SECRET,
    timestamp: timestampHeader,
    rawBody,
    signature,
  });

  if (!valid) {
    return c.json({ error: "Forbidden" }, 403);
  }

  await next();
};
