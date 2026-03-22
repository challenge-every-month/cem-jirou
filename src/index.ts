import { Hono } from "hono";
import type { Env } from "./types";
import { slackVerifyMiddleware } from "./middleware/slack-verify";
import { commandRouter } from "./routes/commands";
import { interactionRouter } from "./routes/interactions";
import { eventRouter } from "./routes/events";
import { usersRouter } from "./routes/users";
import { handleScheduled } from "./handlers/scheduled";

export const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => c.json({ message: "Hello, cem-jirou!" }));

app.use("/slack/*", slackVerifyMiddleware);
app.post("/slack/commands", commandRouter);
app.post("/slack/interactions", interactionRouter);
app.post("/slack/events", eventRouter);

app.route("/users", usersRouter);

export default {
  fetch: app.fetch,
  scheduled: handleScheduled,
};
