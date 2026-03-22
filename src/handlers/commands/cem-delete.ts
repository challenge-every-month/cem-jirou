import type { Context } from "hono";
import type { Env } from "../../types";

export async function handleCemDelete(c: Context<{ Bindings: Env }>, _params: URLSearchParams): Promise<Response> {
  return c.text("", 200); // TODO: implement delete confirmation modal
}
