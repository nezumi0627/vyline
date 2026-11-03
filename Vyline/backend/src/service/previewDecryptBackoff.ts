const PREVIEW_DECRYPT_RETRY_DELAY_MS = 5 * 60_000;
const MAX_PREVIEW_DECRYPT_FAILURES = 500;

export function shouldSkipPreviewDecrypt(
  failures: Map<string, number>,
  key: string,
  now = Date.now(),
): boolean {
  const failedAt = failures.get(key);
  if (failedAt === undefined) return false;
  if (now - failedAt < PREVIEW_DECRYPT_RETRY_DELAY_MS) return true;
  failures.delete(key);
  return false;
}

export function recordPreviewDecryptFailure(
  failures: Map<string, number>,
  key: string,
  now = Date.now(),
): void {
  failures.delete(key);
  failures.set(key, now);
  while (failures.size > MAX_PREVIEW_DECRYPT_FAILURES) {
    const oldest = failures.keys().next().value;
    if (oldest === undefined) return;
    failures.delete(oldest);
  }
}
