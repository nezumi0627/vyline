export type InitialChatScrollPosition = "latest" | "target" | "waiting" | "missing";

export function resolveInitialChatScrollPosition(
  targetMessageId: string | null,
  targetRowKey: string | undefined,
  hasMoreMessages: boolean,
): InitialChatScrollPosition {
  if (!targetMessageId) return "latest";
  if (targetRowKey) return "target";
  return hasMoreMessages ? "waiting" : "missing";
}
