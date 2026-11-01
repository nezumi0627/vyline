import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const appMacOSDir = dirname(process.execPath);
const resourcesDir = resolve(appMacOSDir, "..", "Resources");
const home = process.env.HOME ?? appMacOSDir;
const dataRoot = join(home, "Library", "Application Support", "Vyline");
const backend = join(resourcesDir, "VylineBackend");
const port = "18765";
const url = `http://127.0.0.1:${port}`;

async function isRunning(): Promise<boolean> {
  try {
    return (await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(1_000) })).ok;
  } catch {
    return false;
  }
}

function openBrowser() {
  Bun.spawn(["/usr/bin/open", url], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
}

async function startBackend(): Promise<Bun.Subprocess> {
  const child = Bun.spawn([backend], {
    cwd: resourcesDir,
    env: {
      ...process.env,
      PORT: port,
      VYLINE_HOST: "127.0.0.1",
      VYLINE_CORS_ORIGIN: url,
      VYLINE_STATIC_DIR: join(resourcesDir, "web"),
      VYLINE_OPENAPI_PATH: join(resourcesDir, "openapi.yaml"),
      VYLINE_DATA_DIR: join(dataRoot, "data"),
      VYLINE_STORAGE_DIR: join(dataRoot, "storage"),
      VYLINE_LOG_DIR: join(dataRoot, "data", "logs"),
      VYLINE_CDN_CACHE_DIR: join(dataRoot, "storage", "cache", "cdn-cache"),
      VYLINE_ICON_CACHE_DIR: join(dataRoot, "storage", "cache", "icons"),
      VYLINE_MEDIA_STORAGE_DIR: join(dataRoot, "storage", "saved-media"),
    },
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await isRunning()) return child;
    if (attempt === 59) {
      child.kill();
      throw new Error("Vyline backend did not start");
    }
    await Bun.sleep(250);
  }
  throw new Error("Vyline backend did not start");
}

await mkdir(dataRoot, { recursive: true });
if (await isRunning()) {
  openBrowser();
} else {
  let child = await startBackend();
  openBrowser();
  for (let restart = 0; restart < 3; restart++) {
    const exitCode = await child.exited;
    if (exitCode === 0) break;
    await Bun.sleep(500 * (restart + 1));
    child = await startBackend();
  }
}
