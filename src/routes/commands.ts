import type { Context } from "hono";
import { handleCemDelete } from "../handlers/commands/cem-delete";
import { handleCemEdit } from "../handlers/commands/cem-edit";
import { handleCemNew } from "../handlers/commands/cem-new";
import { handleCemProgress } from "../handlers/commands/cem-progress";
import { handleCemPublish } from "../handlers/commands/cem-publish";
import { handleCemReview } from "../handlers/commands/cem-review";
import { handleCemSettings } from "../handlers/commands/cem-settings";
import type { Env } from "../types";

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
