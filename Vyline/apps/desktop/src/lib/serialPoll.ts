export type SerialPollTask = () => boolean | undefined | Promise<boolean | undefined>;
export function startSerialPoll(
  task: SerialPollTask,
  options: {
    intervalMs: number | (() => number);
    runImmediately?: boolean;
    pauseWhenHidden?: boolean;
    onError?: (error: unknown) => void;
  },
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const hidden = () =>
    Boolean(options.pauseWhenHidden && typeof document !== "undefined" && document.hidden);
  const stop = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
  const schedule = (delay: number) => {
    if (!stopped && !hidden()) timer = setTimeout(run, Math.max(0, delay));
  };
  const run = async () => {
    if (stopped) return;
    if (hidden()) {
      schedule(1000);
      return;
    }
    try {
      if ((await task()) === false) return stop();
    } catch (error) {
      options.onError?.(error);
    }
    schedule(typeof options.intervalMs === "function" ? options.intervalMs() : options.intervalMs);
  };
  schedule(
    options.runImmediately === false
      ? typeof options.intervalMs === "function"
        ? options.intervalMs()
        : options.intervalMs
      : 0,
  );
  return stop;
}
