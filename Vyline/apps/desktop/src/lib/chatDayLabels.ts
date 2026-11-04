import { getIntlLocale, type ResolvedUiLanguage } from "../i18n/index.js";

export function formatChatListTime(
  ts: number,
  now = new Date(),
  locale: ResolvedUiLanguage = getIntlLocale(),
): string {
  const d = new Date(ts);
  const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const targetUtc = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.floor((todayUtc - targetUtc) / 86_400_000);

  if (diffDays === 0) {
    return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  }
  if (diffDays === 1) {
    return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-1, "day");
  }
  if (diffDays >= 2 && diffDays < 7) {
    return d.toLocaleDateString(locale, {
      weekday: locale === "ja" || locale === "ko" ? "long" : "short",
    });
  }
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString(locale, {
      month: "numeric",
      day: "numeric",
    });
  }
  return d.toLocaleDateString(locale, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
}

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
          : date.getFullYear() === now.getFullYear()
            ? `${date.getMonth() + 1}月${date.getDate()}日`
            : `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
    labels.set(key, label);
    return label;
  });
}
