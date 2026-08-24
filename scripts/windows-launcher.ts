import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

const installDir = dirname(process.execPath);
const appData = process.env.APPDATA ?? join(process.env.USERPROFILE ?? installDir, "AppData", "Roaming");
const dataRoot = join(appData, "Vyline");
const backend = join(installDir, "VylineBackend.exe");
const port = "18765";
const url = `http://127.0.0.1:${port}`;

async function isRunning(): Promise<boolean> {
  try { return (await fetch(`${url}/healthz`)).ok; } catch { return false; }
}

function openBrowser() {
  Bun.spawn(["cmd.exe", "/d", "/c", "start", "", url], { stdin: "ignore", stdout: "ignore", stderr: "ignore", windowsHide: true });
}

await mkdir(dataRoot, { recursive: true });
if (!(await isRunning())) {
  const child = Bun.spawn([backend], {
    cwd: installDir,
    env: {
      ...process.env, PORT: port, VYLINE_HOST: "127.0.0.1", VYLINE_CORS_ORIGIN: url,
      VYLINE_STATIC_DIR: join(installDir, "web"), VYLINE_OPENAPI_PATH: join(installDir, "openapi.yaml"),
      VYLINE_DATA_DIR: join(dataRoot, "data"), VYLINE_STORAGE_DIR: join(dataRoot, "storage"),
      VYLINE_LOG_DIR: join(dataRoot, "data", "logs"), VYLINE_CDN_CACHE_DIR: join(dataRoot, "storage", "cache", "cdn-cache"),
      VYLINE_ICON_CACHE_DIR: join(dataRoot, "storage", "cache", "icons"), VYLINE_MEDIA_STORAGE_DIR: join(dataRoot, "storage", "saved-media"),
    },
    stdin: "ignore", stdout: "ignore", stderr: "ignore", windowsHide: true,
  });
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await isRunning()) break;
    if (attempt === 59) throw new Error("Vyline backend did not start");
    await Bun.sleep(250);
  }
  openBrowser();
  await child.exited;
} else openBrowser();
