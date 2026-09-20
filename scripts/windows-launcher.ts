import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

const installDir = dirname(process.execPath);
const appData =
  process.env.APPDATA ?? join(process.env.USERPROFILE ?? installDir, "AppData", "Roaming");
const dataRoot = join(appData, "Vyline");
const backend = join(installDir, "VylineBackend.exe");
const port = "18765";
const url = `http://127.0.0.1:${port}`;

async function isRunning(): Promise<boolean> {
  try {
    return (await fetch(`${url}/healthz`)).ok;
  } catch {
    return false;
  }
}

const backendEnv = {
  ...process.env,
  PORT: port,
  VYLINE_HOST: "127.0.0.1",
  VYLINE_CORS_ORIGIN: url,
  VYLINE_STATIC_DIR: join(installDir, "web"),
  VYLINE_OPENAPI_PATH: join(installDir, "openapi.yaml"),
  VYLINE_DATA_DIR: join(dataRoot, "data"),
  VYLINE_STORAGE_DIR: join(dataRoot, "storage"),
  VYLINE_LOG_DIR: join(dataRoot, "data", "logs"),
  VYLINE_CDN_CACHE_DIR: join(dataRoot, "storage", "cache", "cdn-cache"),
  VYLINE_ICON_CACHE_DIR: join(dataRoot, "storage", "cache", "icons"),
  VYLINE_MEDIA_STORAGE_DIR: join(dataRoot, "storage", "saved-media"),
};

async function startBackend(): Promise<Bun.Subprocess> {
  const child = Bun.spawn([backend], {
    cwd: installDir,
    env: backendEnv,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
    windowsHide: true,
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

function openBrowser() {
  Bun.spawn(["cmd.exe", "/d", "/c", "start", "", url], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
    windowsHide: true,
  });
}

await mkdir(dataRoot, { recursive: true });
if (!(await isRunning())) {
  let child = await startBackend();
  openBrowser();
  // A standalone launcher must recover from a transient backend crash, but
  // must not spin forever when a build is broken or the port is occupied.
  for (let restart = 0; restart < 3; restart++) {
    const exitCode = await child.exited;
    if (exitCode === 0) break;
    await Bun.sleep(500 * (restart + 1));
    child = await startBackend();
  }
} else openBrowser();
