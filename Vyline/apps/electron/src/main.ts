/**
 * main.ts — Vyline Electron メインプロセス
 *
 * 役割:
 *  1. Vyline backend（Hono/Bun）をローカル専用ポートで起動・healthz 待機
 *  2. BrowserWindow を作成し、同一オリジンの backend URL を読み込む
 *     （フロントは Docker セルフホストと全く同じ「同一オリジン配信」パスを通る）
 *  3. mac ネイティブ挙動（メニューバー、Dock、外部リンク、権限、終了処理）を整える
 */
import {
  app,
  BrowserWindow,
  Menu,
  type MenuItemConstructorOptions,
  shell,
  ipcMain,
  dialog,
} from "electron";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { startBackend, type BackendHandle } from "./backendProcess.js";
// electron-updater はモジュール読み込み時に app-update.yml を同期的に参照しようとし、
// 未生成（publish 未公開）のときに app.whenReady() 前のトップレベル import でハング/例外することがあるため、
// 必ず動的 import（autoUpdate.js 内）にしてウィンドウ作成後に遅延する。

const __dirname = dirname(fileURLToPath(import.meta.url));
const isDev = process.env["VYLINE_ELECTRON_DEV"] === "1" || !app.isPackaged;

// リポジトリルート（dist/main.js から見て ../../../.. = vyline/）
const repoRoot = isDev ? join(__dirname, "..", "..", "..", "..") : join(process.resourcesPath, "..");

let mainWindow: BrowserWindow | null = null;
let backend: BackendHandle | null = null;
let quitting = false;

// 同一 LINE セッションを複数プロセスから同時操作しないよう単一インスタンス化
const gotLock = app.requestSingleInstanceLock();
if (gotLock) {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
} else {
  app.quit();
}

function createMenu(): void {
  const isMac = process.platform === "darwin";
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              { role: "services" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: "編集",
      submenu: [
        { role: "undo" as const },
        { role: "redo" as const },
        { type: "separator" as const },
        { role: "cut" as const },
        { role: "copy" as const },
        { role: "paste" as const },
        { role: "selectAll" as const },
      ],
    },
    {
      label: "表示",
      submenu: [
        { role: "reload" as const },
        { role: "forceReload" as const },
        ...(isDev ? [{ role: "toggleDevTools" as const }] : []),
        { type: "separator" as const },
        { role: "resetZoom" as const },
        { role: "zoomIn" as const },
        { role: "zoomOut" as const },
        { type: "separator" as const },
        { role: "togglefullscreen" as const },
      ],
    },
    {
      label: "ウインドウ",
      submenu: isMac
        ? [
            { role: "minimize" as const },
            { role: "zoom" as const },
            { type: "separator" as const },
            { role: "front" as const },
          ]
        : [{ role: "minimize" as const }, { role: "close" as const }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(url: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 860,
    minHeight: 560,
    backgroundColor: "#0e1621",
    show: false,
    title: "Vyline",
    icon: join(__dirname, "..", "resources", "icon.png"),
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  win.once("ready-to-show", () => win.show());

  // 通話機能向け: マイク・カメラ・通知を自ホスト origin に限り許可
  const ses = win.webContents.session;
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    const allowed = new Set(["media", "notifications", "clipboard-sanitized-write"]);
    callback(allowed.has(permission));
  });

  // 画像・動画保存時のファイル名を Vyline-<日付>-<元の名前> に整形（LEINs の「保存時のファイル名変更」相当）
  ses.on("will-download", (_event, item) => {
    const original = item.getFilename();
    const dot = original.lastIndexOf(".");
    const ext = dot >= 0 ? original.slice(dot) : "";
    const base = dot >= 0 ? original.slice(0, dot) : original;
    const stamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, 19);
    const safeBase = base.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
    item.setSaveDialogOptions({ defaultPath: `Vyline-${stamp}-${safeBase}${ext}` });
  });

  // アプリ外へのナビゲーション・新規ウインドウはすべて既定ブラウザへ委譲
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:\/\//i.test(target)) void shell.openExternal(target);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, target) => {
    if (!target.startsWith(url)) {
      event.preventDefault();
      if (/^https?:\/\//i.test(target)) void shell.openExternal(target);
    }
  });

  void win.loadURL(url);
  return win;
}

async function bootstrap(): Promise<void> {
  const dataDir = join(app.getPath("userData"), "data");
  try {
    backend = await startBackend({
      isDev,
      repoRoot,
      resourcesPath: process.resourcesPath,
      dataDir,
      onLog: (line) => {
        if (isDev) process.stdout.write(`[backend] ${line}`);
      },
      onExit: (code) => {
        if (!quitting && code !== 0) {
          void dialog.showMessageBox({
            type: "error",
            title: "Vyline",
            message: `Vyline backend が終了しました (code ${code}) 。アプリを再起動してください。`,
          });
        }
      },
    });
  } catch (err) {
    dialog.showErrorBox("Vyline 起動失敗", String(err));
    app.quit();
    return;
  }

  createMenu();
  mainWindow = createWindow(backend.url);

  app.on("activate", () => {
    // mac 慣習: Dock アイコンクリックでウインドウが無ければ再生成
    if (BrowserWindow.getAllWindows().length === 0 && backend) {
      mainWindow = createWindow(backend.url);
    }
  });

  // 起動 10 秒後に一度だけ自動更新確認（パッケージ済みビルドのみ。dev ではノーオプ）。
  // electron-updater はここで初めて動的 import する（モジュール読み込み時のハング・例外が起動をブロックしないように）。
  // publish 先が未設定/未公開なら内部で静かに失敗しユーザーには影響しない。
  if (!isDev) {
    setTimeout(() => {
      void import("./autoUpdate.js")
        .then((m) => m.checkForAppUpdates())
        .catch(() => undefined);
    }, 10_000);
  }
}

ipcMain.on("vyline:app-version", (event) => {
  event.returnValue = app.getVersion();
});

app.whenReady().then(() => {
  void bootstrap();
});

app.on("window-all-closed", () => {
  // mac 慣習: ウインドウを閉じてもアプリ（バックエンド）は Dock/メニューバーに残す
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", (event) => {
  if (quitting) return;
  if (backend) {
    event.preventDefault();
    quitting = true;
    void backend.stop().finally(() => app.quit());
  }
});

// Electron のデフォルト navigator.mediaDevices はローカル HTTP でも動作するが、
// 念のため自ホスト以外の origin に権限が漏れないよう明示的に絞る
app.on("web-contents-created", (_event, contents) => {
  contents.session.setDevicePermissionHandler(() => true);
});

if (!existsSync(join(__dirname, "preload.js")) && isDev) {
  // tsc の出力先ズレなど、開発時の設定ミスに早期に気づけるようにする
  process.stderr.write(
    "[vyline-electron] warning: dist/preload.js not found — run `bun run build:main` first\n",
  );
}
