export const STANDARD_UNSEND_WINDOW_MS = 60 * 60 * 1000;
export const PREMIUM_UNSEND_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function getUnsendWindowMs(isPremium: boolean): number {
  return isPremium ? PREMIUM_UNSEND_WINDOW_MS : STANDARD_UNSEND_WINDOW_MS;
}

export function canUnsendMessage(createdAt: number, isPremium: boolean, now = Date.now()): boolean {
  if (!Number.isFinite(createdAt) || createdAt <= 0) return false;
  const ageMs = now - createdAt;
  return ageMs >= 0 && ageMs <= getUnsendWindowMs(isPremium);
}
