export function createChatDayLabels(
  messages: readonly { createdAt: number }[],
  now = new Date(),
): string[] {
  const today = now.getFullYear() * 10_000 + (now.getMonth() + 1) * 100 + now.getDate();
  const yesterdayDate = new Date(now);
  yesterdayDate.setDate(now.getDate() - 1);
  const yesterday =
    yesterdayDate.getFullYear() * 10_000 +
    (yesterdayDate.getMonth() + 1) * 100 +
    yesterdayDate.getDate();
  const labels = new Map<number, string>();

  return messages.map((message) => {
    const date = new Date(message.createdAt);
    const key = date.getFullYear() * 10_000 + (date.getMonth() + 1) * 100 + date.getDate();
    const cached = labels.get(key);
    if (cached) return cached;
    const label =
      key === today
        ? "今日"
        : key === yesterday
          ? "昨日"
          : `${date.getMonth() + 1}月${date.getDate()}日`;
    labels.set(key, label);
    return label;
  });
}
