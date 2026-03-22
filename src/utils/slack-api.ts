const SLACK_API_BASE = "https://slack.com/api";

export async function slackPost(
  token: string,
  method: string,
  body: unknown,
): Promise<unknown> {
  const res = await fetch(`${SLACK_API_BASE}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Slack API error: ${res.status}`);
  const data = (await res.json()) as { ok: boolean; error?: string };
  if (!data.ok) throw new Error(`Slack API error: ${data.error}`);
  return data;
}

export async function openModal(
  token: string,
  triggerId: string,
  view: unknown,
): Promise<void> {
  await slackPost(token, "views.open", { trigger_id: triggerId, view });
}

export async function publishHome(
  token: string,
  userId: string,
  view: unknown,
): Promise<void> {
  await slackPost(token, "views.publish", { user_id: userId, view });
}

export async function postMessage(
  token: string,
  channel: string,
  text: string,
  blocks?: unknown[],
): Promise<void> {
  await slackPost(token, "chat.postMessage", { channel, text, blocks });
}

export async function postEphemeral(
  token: string,
  channel: string,
  userId: string,
  text: string,
): Promise<void> {
  await slackPost(token, "chat.postEphemeral", { channel, user: userId, text });
}

export async function postDm(
  token: string,
  slackUserId: string,
  text: string,
): Promise<void> {
  const result = (await slackPost(token, "conversations.open", {
    users: slackUserId,
  })) as { channel: { id: string } };
  await postMessage(token, result.channel.id, text);
}
