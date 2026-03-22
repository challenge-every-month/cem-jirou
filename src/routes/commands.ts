import type { Context } from "hono";
import type { Env } from "../types";
import { handleCemNew } from "../handlers/commands/cem-new";
import { handleCemEdit } from "../handlers/commands/cem-edit";
import { handleCemDelete } from "../handlers/commands/cem-delete";
import { handleCemSettings } from "../handlers/commands/cem-settings";

type CommandContext = Context<{ Bindings: Env }>;

export async function commandRouter(c: CommandContext): Promise<Response> {
  const rawBody = c.get("rawBody" as never) as string;
  const params = new URLSearchParams(rawBody);
  const command = params.get("command") ?? "";

  switch (command) {
    case "/cem_new":
      return handleCemNew(c, params);
    case "/cem_edit":
      return handleCemEdit(c, params);
    case "/cem_delete":
      return handleCemDelete(c, params);
    case "/cem_publish":
      return handleCemPublish(c, params);
    case "/cem_progress":
      return handleCemProgress(c, params);
    case "/cem_review":
      return handleCemReview(c, params);
    case "/cem_settings":
      return handleCemSettings(c, params);
    default:
      return c.json(
        {
          response_type: "ephemeral",
          text: `Unknown command: ${command}`,
        },
        200,
      );
  }
}

// Stub handlers — will be implemented in future phases

async function handleCemPublish(c: CommandContext, _params: URLSearchParams): Promise<Response> {
  return c.text("", 200);
}

async function handleCemProgress(c: CommandContext, _params: URLSearchParams): Promise<Response> {
  return c.text("", 200);
}

async function handleCemReview(c: CommandContext, _params: URLSearchParams): Promise<Response> {
  return c.text("", 200);
}
