const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function normalizeAccountId(value: string): string {
  return value.trim();
}

export function isValidAccountId(value: string): boolean {
  return ACCOUNT_ID_PATTERN.test(normalizeAccountId(value));
}

export function suggestAccountId(existingIds: readonly string[]): string {
  const existing = new Set(existingIds.map(normalizeAccountId).filter(Boolean));
  if (!existing.has("main")) return "main";
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `account-${index}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `account-${Date.now()}`;
}

export function accountIdValidationError(
  candidate: string,
  existingIds: readonly string[],
  allowedExistingId: string | null = null,
): string | null {
  const normalized = normalizeAccountId(candidate);
  if (!normalized) return "アカウント名を入力してください。";
  if (!isValidAccountId(normalized)) {
    return "アカウント名は64文字以内の半角英数字・ピリオド・ハイフン・アンダースコアで指定してください。";
  }
  if (normalized !== allowedExistingId && existingIds.some((id) => normalizeAccountId(id) === normalized)) {
    return `「${normalized}」は既に使われています。別のアカウント名を指定してください。`;
  }
  return null;
}
