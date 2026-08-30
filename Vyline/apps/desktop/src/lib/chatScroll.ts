type UnreadMessage = {
  id: string;
  authorId: string;
  read: boolean;
  createdAt: number;
};

/** チャット内で最初に表示すべき未読メッセージを返す。 */
export function findFirstUnreadMessage<T extends UnreadMessage>(
  messages: readonly T[],
): T | undefined {
  return messages
    .filter((message) => message.authorId !== "me" && !message.read)
    .sort((left, right) => {
      const byTime = left.createdAt - right.createdAt;
      if (byTime) return byTime;
      try {
        const leftId = BigInt(left.id);
        const rightId = BigInt(right.id);
        return leftId === rightId ? 0 : leftId < rightId ? -1 : 1;
      } catch {
        return left.id.localeCompare(right.id);
      }
    })[0];
}

export type ScrollMetrics = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
};

/**
 * Fractional pixels and browser zoom can leave a tiny remainder even when the viewport
 * is visually at the bottom. Treat a small configurable gap as bottom.
 */
export function isNearScrollBottom(metrics: ScrollMetrics, thresholdPx = 8): boolean {
  const threshold = Math.max(0, thresholdPx);
  const remaining = Math.max(0, metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop);
  return remaining <= threshold;
}
