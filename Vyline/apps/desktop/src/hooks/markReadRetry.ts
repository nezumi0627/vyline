export type MarkReadRetry = (() => Promise<void>) & { cancel: () => void };

export function createMarkReadRetry(
  isVisible: () => boolean,
  markRead: () => Promise<boolean>,
  retryDelayMs = 5_000,
): MarkReadRetry {
  let marked = false;
  let inFlight = false;
  let cancelled = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const retry = async () => {
    if (cancelled || marked || inFlight || !isVisible()) return;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    inFlight = true;
    try {
      marked = await markRead();
    } catch {
      marked = false;
    } finally {
      inFlight = false;
      if (!cancelled && !marked && !retryTimer) {
        retryTimer = setTimeout(() => {
          retryTimer = null;
          void retry();
        }, retryDelayMs);
      }
    }
  };

  return Object.assign(retry, {
    cancel: () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
    },
  });
}
