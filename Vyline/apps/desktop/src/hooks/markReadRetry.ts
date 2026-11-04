export function createMarkReadRetry(
  isVisible: () => boolean,
  markRead: () => Promise<void>,
): () => Promise<void> {
  let marked = false;
  let inFlight = false;

  return async () => {
    if (marked || inFlight || !isVisible()) return;
    inFlight = true;
    try {
      await markRead();
      marked = true;
    } catch {
      // A later store update or visibility change can retry the receipt.
    } finally {
      inFlight = false;
    }
  };
}
