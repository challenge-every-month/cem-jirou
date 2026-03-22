import { Hono } from "hono";
import type { Env } from "./types";

export const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => {
  return c.json({ message: "Hello, cem-jirou!" });
});

export default {
  fetch: app.fetch,
};
