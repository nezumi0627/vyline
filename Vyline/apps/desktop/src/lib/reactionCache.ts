import type { MessageReaction } from "./store-types.js";

export type ReactionsCache = Map<string, MessageReaction[]>;

export function createReactionsCache(): ReactionsCache {
  return new Map<string, MessageReaction[]>();
}

export function getReactions(
  cache: ReactionsCache,
  messageId: string,
): MessageReaction[] | undefined {
  return cache.get(messageId);
}

export function setReactions(
  cache: ReactionsCache,
  messageId: string,
  reactions: MessageReaction[] | undefined,
): void {
  if (reactions && reactions.length > 0) {
    cache.set(messageId, reactions);
  } else {
    cache.delete(messageId);
  }
}

export function removeReaction(cache: ReactionsCache, messageId: string, reactorMid: string): void {
  const reactions = cache.get(messageId);
  if (!reactions) return;

  const filtered = reactions.filter((r) => r.fromMid !== reactorMid);
  if (filtered.length === 0) {
    cache.delete(messageId);
  } else {
    cache.set(messageId, filtered);
  }
}

export function clearReactions(cache: ReactionsCache, messageId: string): void {
  cache.delete(messageId);
}

export function getAllReactions(cache: ReactionsCache): Map<string, MessageReaction[]> {
  return new Map([...cache.entries()]);
}

export function invalidateMessage(cache: ReactionsCache, messageId: string): void {
  cache.delete(messageId);
}
