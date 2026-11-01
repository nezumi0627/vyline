export function createChatMessageSelector<T extends { chatId: string }>(
  compare: (left: T, right: T) => number,
) {
  let source: readonly T[] | undefined;
  let chatId: string | null = null;
  let selected: T[] = [];

  return (messages: readonly T[], nextChatId: string | null): T[] => {
    if (messages === source && nextChatId === chatId) return selected;
    source = messages;
    chatId = nextChatId;
    selected = nextChatId
      ? messages.filter((message) => message.chatId === nextChatId).sort(compare)
      : [];
    return selected;
  };
}

export function retainMessagesForChat<T extends { chatId: string }>(
  messages: readonly T[],
  chatId: string | null,
): T[] {
  return chatId ? messages.filter((message) => message.chatId === chatId) : [];
}
