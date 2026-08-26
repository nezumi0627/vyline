import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

const installDir = dirname(process.execPath);
const appData = process.env.APPDATA ?? join(process.env.USERPROFILE ?? installDir, "AppData", "Roaming");
const dataRoot = join(appData, "Vyline");
const backend = join(installDir, "VylineBackend.exe");
const port = "18765";
const url = `http://127.0.0.1:${port}`;
const logFile = join(dataRoot, "launcher.log");

async function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    await appendFile(logFile, line);
  } catch {}
}

async function isRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function openBrowser(): Promise<boolean> {
  const attempts: Array<{ cmd: string[]; label: string }> = [
    { cmd: ["cmd.exe", "/d", "/c", "start", "", url], label: "cmd start" },
    { cmd: ["rundll32", "url.dll,FileProtocolHandler", url], label: "rundll32" },
    { cmd: ["explorer.exe", url], label: "explorer" },
  ];
  for (const { cmd, label } of attempts) {
    try {
      const proc = Bun.spawn(cmd, {
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
        windowsHide: true,
      });
      // start is fire-and-forget; give it a moment to fail if it will
      await Bun.sleep(400);
      // If process exited with non-zero, try next method
      const exited = proc.exited;
      const raced = await Promise.race([
        exited.then((code) => ({ code })),
        Bun.sleep(300).then(() => ({ code: null as number | null })),
      ]);
      if (raced.code !== null && raced.code !== 0) {
        await log(`openBrowser ${label} exited code=${raced.code}, trying next`);
        continue;
      }
      await log(`openBrowser ${label} launched`);
      return true;
    } catch (err) {
      await log(`openBrowser ${label} failed: ${String(err)}`);
    }
  }
  return false;
}

async function showErrorDialog(message: string) {
  // Visible error even though binary is --windows-hide-console
  try {
    const ps = [
      "Add-Type -AssemblyName System.Windows.Forms;",
      `[System.Windows.Forms.MessageBox]::Show("${message.replaceAll('"', '""')}", "Vyline", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error)`,
    ].join(" ");
    Bun.spawnSync(["powershell.exe", "-NoProfile", "-Command", ps], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
      windowsHide: true,
    });
  } catch {}
}

await mkdir(dataRoot, { recursive: true });
await log(`launcher started installDir=${installDir} port=${port}`);

if (await isRunning()) {
  await log("backend already running, opening browser");
  const ok = await openBrowser();
  if (!ok) {
    await showErrorDialog(`Vyline は起動中ですが、ブラウザを開けませんでした。手動で ${url} を開いてください。\nログ: ${logFile}`);
  }
  process.exit(0);
}

await log(`spawning backend ${backend}`);
let child: ReturnType<typeof Bun.spawn> | null = null;
try {
  child = Bun.spawn([backend], {
    cwd: installDir,
    env: {
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
    },
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
    windowsHide: true,
  });
} catch (err) {
  const msg = `VylineBackend の起動に失敗しました: ${String(err)}\nログ: ${logFile}`;
  await log(msg);
  await showErrorDialog(msg);
  process.exit(1);
}

let started = false;
for (let attempt = 0; attempt < 60; attempt++) {
  if (await isRunning()) {
    started = true;
    break;
  }
  // Early exit if backend died
  if (child) {
    const status = await Promise.race([
      child.exited.then((c) => ({ died: true, code: c })),
      Bun.sleep(250).then(() => ({ died: false, code: null as number | null })),
    ]);
    if (status.died) {
      const msg = `VylineBackend が起動直後に終了しました (code=${status.code})。\nログ: ${logFile}\nweb フォルダが存在するか確認してください。`;
      await log(msg);
      await showErrorDialog(msg);
      process.exit(1);
    }
  } else {
    await Bun.sleep(250);
  }
}

if (!started) {
  const msg = `Vyline backend が ${port} で起動しませんでした (15秒タイムアウト)。\nポートが使用中か、web フォルダが壊れている可能性があります。\nログ: ${logFile}`;
  await log(msg);
  await showErrorDialog(msg);
  try {
    child?.kill();
  } catch {}
  process.exit(1);
}

await log("backend started, opening browser");
const ok = await openBrowser();
if (!ok) {
  const msg = `Vyline backend は起動しましたが、ブラウザを開けませんでした。\n手動で ${url} を開いてください。\nログ: ${logFile}`;
  await log(msg);
  await showErrorDialog(msg);
  // Keep backend running; launcher should stay to keep child alive
} else {
  await log("browser opened");
}

// Keep launcher alive while backend runs so task manager shows single entry
// and backend is not orphaned. Exit when backend exits.
if (child) {
  const code = await child.exited;
  await log(`backend exited code=${code}`);
  process.exit(code ?? 0);
}
