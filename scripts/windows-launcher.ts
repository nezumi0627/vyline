import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

const installDir = dirname(process.execPath);
const appData =
  process.env.APPDATA ?? join(process.env.USERPROFILE ?? installDir, "AppData", "Roaming");
const dataRoot = join(appData, "Vyline");
const logDir = join(dataRoot, "data", "logs");
const backendLog = join(logDir, "backend.log");
const backend = join(installDir, "VylineBackend.exe");
const port = "18765";
const url = `http://127.0.0.1:${port}`;

async function isRunning(): Promise<boolean> {
  try {
    return (await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(1_000) })).ok;
  } catch {
    return false;
  }
}

const backendEnv = {
  ...process.env,
  NODE_ENV: "production",
  VYLINE_PRETTY_LOGS: "0",
  PORT: port,
  VYLINE_HOST: "127.0.0.1",
  VYLINE_CORS_ORIGIN: url,
  VYLINE_STATIC_DIR: join(installDir, "web"),
  VYLINE_OPENAPI_PATH: join(installDir, "openapi.yaml"),
  VYLINE_DESKTOP_PROFILE_FALLBACK: join(installDir, "data", "desktop-profile.fallback.json"),
  VYLINE_DATA_DIR: join(dataRoot, "data"),
  VYLINE_STORAGE_DIR: join(dataRoot, "storage"),
  VYLINE_LOG_DIR: join(dataRoot, "data", "logs"),
  VYLINE_CDN_CACHE_DIR: join(dataRoot, "storage", "cache", "cdn-cache"),
  VYLINE_ICON_CACHE_DIR: join(dataRoot, "storage", "cache", "icons"),
  VYLINE_MEDIA_STORAGE_DIR: join(dataRoot, "storage", "saved-media"),
};

function openLog() {
  Bun.spawn(["cmd.exe", "/d", "/c", "start", "", backendLog], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
    windowsHide: true,
  });
}

async function capture(stream: ReadableStream<Uint8Array>): Promise<void> {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      await appendFile(backendLog, value);
    }
  } finally {
    reader.releaseLock();
  }
}

async function failStartup(reason: string): Promise<never> {
  await appendFile(backendLog, `${reason}\n`).catch(() => undefined);
  openLog();
  throw new Error(`${reason} See ${backendLog}`);
}

const outputCaptures = new WeakMap<Bun.Subprocess, Promise<void>>();

async function startBackend(): Promise<Bun.Subprocess> {
  await appendFile(backendLog, `\n--- Vyline backend launch ${new Date().toISOString()} ---\n`);
  const child = Bun.spawn([backend], {
    cwd: installDir,
    env: backendEnv,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
  });
  outputCaptures.set(
    child,
    Promise.all([capture(child.stdout), capture(child.stderr)])
      .then(() => undefined)
      .catch(() => undefined),
  );
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) {
      await outputCaptures.get(child);
      await failStartup(
        `Vyline backend exited before becoming ready (exit code ${child.exitCode}).`,
      );
    }
    if (await isRunning()) return child;
    if (attempt === 59) {
      child.kill();
      await child.exited;
      await outputCaptures.get(child);
      await failStartup("Vyline backend did not become ready within 15 seconds.");
    }
    await Bun.sleep(250);
  }
  throw new Error("Vyline backend did not start");
}

function openBrowser() {
  Bun.spawn(["cmd.exe", "/d", "/c", "start", "", url], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
    windowsHide: true,
  });
}

await mkdir(dataRoot, { recursive: true });
await mkdir(logDir, { recursive: true });
if (!(await isRunning())) {
  let child = await startBackend();
  openBrowser();
  // A standalone launcher must recover from a transient backend crash, but
  // must not spin forever when a build is broken or the port is occupied.
  for (let restart = 0; restart < 3; restart++) {
    const exitCode = await child.exited;
    await outputCaptures.get(child);
    if (exitCode === 0) break;
    if (restart === 2)
      await failStartup(`Vyline backend stopped after repeated restarts (exit code ${exitCode}).`);
    await Bun.sleep(500 * (restart + 1));
    try {
      child = await startBackend();
    } catch (error) {
      await failStartup(error instanceof Error ? error.message : "Vyline backend restart failed.");
    }
  }
} else openBrowser();
