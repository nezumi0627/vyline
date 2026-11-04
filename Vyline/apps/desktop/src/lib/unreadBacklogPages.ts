export type UnreadBacklogPages = { chatId: string | null; count: number };

export function advanceUnreadBacklogPages(
  current: UnreadBacklogPages,
  chatId: string | null,
  limit: number,
): { state: UnreadBacklogPages; shouldLoad: boolean } {
  if (!chatId) return { state: { chatId: null, count: 0 }, shouldLoad: false };

  const state = current.chatId === chatId ? current : { chatId, count: 0 };
  if (state.count >= limit) return { state, shouldLoad: false };
  return { state: { chatId, count: state.count + 1 }, shouldLoad: true };
}
