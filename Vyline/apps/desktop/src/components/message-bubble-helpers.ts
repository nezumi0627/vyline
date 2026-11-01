export function mentionLabel(value: string, all?: boolean, name?: string): string {
  if (all) return "ALL";
  const visible = value
    .replace(/^@/, "")
    .replace(/(?:[\s\u2800\u200B\u200C\u2060\uFEFF\uFFFC]|\u200D)/gu, "");
  return visible ? value.replace(/^@/, "") : name || "メンバー";
}

export function formatCallDuration(sec?: number): string | null {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return null;
  const seconds = Math.round(sec);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0) return `${hours}時間${minutes}分${rest.toString().padStart(2, "0")}秒`;
  if (minutes > 0) return `${minutes}分${rest.toString().padStart(2, "0")}秒`;
  return `${rest}秒`;
}
