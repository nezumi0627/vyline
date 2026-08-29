export type SerialPollTask = () => boolean | void | Promise<boolean | void>;

export interface SerialPollOptions {
  /** Delay between the end of one run and the start of the next run. */
  intervalMs: number | (() => number);
  /** Run once immediately instead of waiting one interval. Defaults to true. */
  runImmediately?: boolean;
  /** Suspend timers and network work while the document is hidden. */
  pauseWhenHidden?: boolean;
  onError?: (error: unknown) => void;
}

function resolveInterval(value: SerialPollOptions["intervalMs"]): number {
  const resolved = typeof value === "function" ? value() : value;
  return Number.isFinite(resolved) ? Math.max(0, resolved) : 0;
}

/**
 * Start a non-overlapping poll loop.
 *
 * The next timer is scheduled only after the current async task settles, so a
 * slow request cannot build up concurrent calls. When pauseWhenHidden is set,
 * timers are removed while hidden and resume once when the tab becomes visible.
 */
export function startSerialPoll(task: SerialPollTask, options: SerialPollOptions): () => void {
  let stopped = false;
  let waitingForVisibility = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const hasDocument = typeof document !== "undefined";
  const isHidden = () =>
    Boolean(options.pauseWhenHidden && hasDocument && document.visibilityState === "hidden");

  function clearTimer(): void {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  }

  function stop(): void {
    if (stopped) return;
    stopped = true;
    clearTimer();
    if (options.pauseWhenHidden && hasDocument) {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    }
  }

  function schedule(delayMs: number): void {
    if (stopped) return;
    if (isHidden()) {
      waitingForVisibility = true;
      return;
    }
    clearTimer();
    timer = setTimeout(() => {
      timer = undefined;
      void run();
    }, Math.max(0, delayMs));
  }

  async function run(): Promise<void> {
    if (stopped) return;
    if (isHidden()) {
      waitingForVisibility = true;
      return;
    }

    try {
      const keepPolling = await task();
      if (keepPolling === false) {
        stop();
        return;
      }
    } catch (error) {
      options.onError?.(error);
    }

    if (!stopped) schedule(resolveInterval(options.intervalMs));
  }

  function onVisibilityChange(): void {
    if (stopped || !options.pauseWhenHidden || !hasDocument) return;
    if (document.visibilityState === "hidden") {
      waitingForVisibility = true;
      clearTimer();
      return;
    }
    if (waitingForVisibility) {
      waitingForVisibility = false;
      schedule(0);
    }
  }

  if (options.pauseWhenHidden && hasDocument) {
    document.addEventListener("visibilitychange", onVisibilityChange);
  }
  schedule(options.runImmediately === false ? resolveInterval(options.intervalMs) : 0);
  return stop;
}
