type MessageRow = {
  key: string;
  item: {
    key: string;
    kind: string;
    [field: string]: unknown;
    message?: { id: string };
    mediaGroup?: Array<{ id: string }>;
  };
};

/** Resolve every message in a grouped virtual row to the single rendered row key. */
export function buildChatMessageRowIndex(rows: readonly MessageRow[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const row of rows) {
    if (row.item.kind !== "msg") continue;
    if (row.item.message) index.set(row.item.message.id, row.key);
    for (const message of row.item.mediaGroup ?? []) index.set(message.id, row.key);
  }
  return index;
}

export function missingMessagePageRequestKey(
  chatId: string,
  messageId: string,
  oldestMessageId: string | undefined,
  targetLoaded: boolean,
  hasMore: boolean,
  loading: boolean,
  lastRequestKey: string | null,
): string | null {
  if (!oldestMessageId || targetLoaded || !hasMore || loading) return null;
  const key = `${chatId}\u0000${messageId}\u0000${oldestMessageId}`;
  return key === lastRequestKey ? null : key;
}
