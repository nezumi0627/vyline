type ReadReceiptCandidate = {
  id: string;
  chatId: string;
  authorId: string;
  createdAt: number;
};

function compareIdsDescending(left: string, right: string): number {
  try {
    const leftId = BigInt(left);
    const rightId = BigInt(right);
    return leftId === rightId ? 0 : leftId > rightId ? 1 : -1;
  } catch {
    return left.localeCompare(right);
  }
}

export function isAtOrBeforeReadPosition(
  message: Pick<ReadReceiptCandidate, "id" | "createdAt">,
  position: Pick<ReadReceiptCandidate, "id" | "createdAt">,
): boolean {
  if (message.createdAt !== position.createdAt) return message.createdAt < position.createdAt;
  return compareIdsDescending(message.id, position.id) <= 0;
}

export function findLatestReceivedMessage<T extends ReadReceiptCandidate>(
  messages: readonly T[],
  chatId: string,
): T | undefined {
  let latest: T | undefined;
  for (const message of messages) {
    if (message.chatId !== chatId || message.authorId === "me" || message.id.startsWith("pending_")) continue;
    if (!latest || message.createdAt > latest.createdAt ||
      (message.createdAt === latest.createdAt && compareIdsDescending(message.id, latest.id) > 0)) {
      latest = message;
    }
  }
  return latest;
}

export function findFirstUnreadReceivedMessage<T extends ReadReceiptCandidate & { read?: boolean }>(
  messages: readonly T[],
  chatId: string,
): T | undefined {
  let first: T | undefined;
  for (const message of messages) {
    if (message.chatId !== chatId || message.authorId === "me" || message.read || message.id.startsWith("pending_")) {
      continue;
    }
    if (!first || isAtOrBeforeReadPosition(message, first)) first = message;
  }
  return first;
}

/** The chat unread count is authoritative for group chats; readCount only means someone read it. */
export function findUnreadAnchorByCount<T extends ReadReceiptCandidate>(
  messages: readonly T[],
  chatId: string,
  unreadCount: number,
): T | undefined {
  if (!Number.isFinite(unreadCount) || unreadCount <= 0) return undefined;
  const received = messages
    .filter((message) =>
      message.chatId === chatId && message.authorId !== "me" && !message.id.startsWith("pending_"),
    )
    .sort((left, right) => {
      if (left.createdAt !== right.createdAt) return left.createdAt - right.createdAt;
      return compareIdsDescending(left.id, right.id);
    });
  if (received.length === 0) return undefined;
  return received[Math.max(0, received.length - Math.floor(unreadCount))];
}

export function countReceivedMessages<T extends ReadReceiptCandidate>(
  messages: readonly T[],
  chatId: string,
): number {
  return messages.filter(
    (message) =>
      message.chatId === chatId && message.authorId !== "me" && !message.id.startsWith("pending_"),
  ).length;
}

/** Preserve the anchor captured before opening marked its messages read. */
export function resolveInitialUnreadScrollTarget<T extends ReadReceiptCandidate & { read?: boolean }>(
  messages: readonly T[],
  chatId: string,
  preservedTargetId: string | null,
  unreadCount = 0,
): string | null {
  return (
    findUnreadAnchorByCount(messages, chatId, unreadCount)?.id ??
    findFirstUnreadReceivedMessage(messages, chatId)?.id ??
    preservedTargetId
  );
}

export function markReceivedMessagesReadThrough<
  T extends ReadReceiptCandidate & { read?: boolean; status?: string },
>(messages: T[], chatId: string, position: Pick<ReadReceiptCandidate, "id" | "createdAt">): T[] {
  let updated = messages;
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]!;
    if (
      message.chatId !== chatId ||
      message.authorId === "me" ||
      !isAtOrBeforeReadPosition(message, position) ||
      (message.read && message.status === "read")
    ) {
      continue;
    }
    if (updated === messages) updated = messages.slice();
    updated[index] = { ...message, read: true, status: "read" };
  }
  return updated;
}

export function rollbackReceiptAttempt(
  sent: Map<string, string>,
  receiptKey: string,
  failedMessageId: string,
): void {
  if (sent.get(receiptKey) === failedMessageId) sent.delete(receiptKey);
}
