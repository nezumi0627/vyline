/**
 * LINE Desktop インストール監視
 */

import { existsSync, watch as fsWatch, statSync } from "node:fs";
import { lineBinDir, lineIniPath, updateLogPath } from "../desktop/paths.js";
import type { WatchHandle, WatchReason } from "../desktop/types.js";

export interface WatcherOptions {
  lineRoot: string;
  pollIntervalMs: number;
  debounceMs: number;
}

export function startWatcher(
  opts: WatcherOptions,
  onEvent: (reason: WatchReason) => void | Promise<void>,
): WatchHandle {
  if (process.env.VYLINE_DISABLE_WATCH === "1") {
    return { stop() {} };
  }

  const binDir = lineBinDir(opts.lineRoot);
  const iniPath = lineIniPath(opts.lineRoot);
  const logPath = updateLogPath(opts.lineRoot);

  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const fire = (reason: WatchReason) => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void onEvent(reason);
    }, opts.debounceMs);
  };

  const watchers: Array<{ close: () => void }> = [];

  if (existsSync(binDir)) {
    try {
      const w = fsWatch(binDir, () => fire("bin-folder-changed"));
      watchers.push(w);
    } catch {
      /* ignore */
    }
  }
  if (existsSync(logPath)) {
    try {
      const w = fsWatch(logPath, () => fire("update-log-changed"));
      watchers.push(w);
    } catch {
      /* ignore */
    }
  }
  if (existsSync(iniPath)) {
    try {
      const w = fsWatch(iniPath, () => fire("ini-changed"));
      watchers.push(w);
    } catch {
      /* ignore */
    }
  }

  let lastLog = existsSync(logPath) ? statSync(logPath).mtimeMs : 0;
  let lastIni = existsSync(iniPath) ? statSync(iniPath).mtimeMs : 0;

  const poll = setInterval(() => {
    if (stopped) return;
    try {
      if (existsSync(logPath)) {
        const m = statSync(logPath).mtimeMs;
        if (m !== lastLog) {
          lastLog = m;
          fire("update-log-changed");
        }
      }
      if (existsSync(iniPath)) {
        const m = statSync(iniPath).mtimeMs;
        if (m !== lastIni) {
          lastIni = m;
          fire("ini-changed");
        }
      }
    } catch {
      /* ignore */
    }
  }, opts.pollIntervalMs);

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      clearInterval(poll);
      for (const w of watchers) {
        try {
          w.close();
        } catch {
          /* ignore */
        }
      }
    },
  };
}
