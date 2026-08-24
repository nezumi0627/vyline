import { mkdir, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type BrowserContext, type Locator, type Page } from "@playwright/test";

const root = join(import.meta.dir, "..", "..", "..", "..");
const desktopDir = join(root, "Vyline", "apps", "desktop");
const outputDir = join(root, "recordings", "openscreen");
const port = 5173;
const appUrl = `http://127.0.0.1:${port}/pr-demo`;
const openscreenBin = process.env.OPENSCREEN_BIN ?? "Openscreen.exe";
const dryRun = process.env.VYLINE_PR_DRY_RUN === "1";
const captureWidth = 1440;
const captureHeight = 990;

type FocusPoint = { atMs: number; x: number; y: number };
type Runtime = { startedAt: number; focusPoints: FocusPoint[] };
type Scenario = {
  id: string;
  title: string;
  duration: number;
  run: (page: Page, runtime: Runtime) => Promise<void>;
};

const pause = (ms = 500) => Bun.sleep(ms);

async function cursorPosition(
  page: Page,
  locator: Locator,
): Promise<{ x: number; y: number } | null> {
  await locator.waitFor({ state: "visible", timeout: 10_000 });
  const box = await locator.boundingBox();
  if (!box) return null;
  const chrome = await page.evaluate(() => ({
    x: window.screenX + Math.max(0, (window.outerWidth - window.innerWidth) / 2),
    y: window.screenY + Math.max(0, window.outerHeight - window.innerHeight),
  }));
  return { x: chrome.x + box.x + box.width / 2, y: chrome.y + box.y + box.height / 2 };
}

async function moveSystemCursor(x: number, y: number): Promise<void> {
  const command = `[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${Math.round(x)},${Math.round(y)})`;
  const process = Bun.spawn(
    [
      "powershell.exe",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; ${command}`,
    ],
    { stdout: "ignore", stderr: "ignore" },
  );
  await process.exited;
}

async function focus(page: Page, runtime: Runtime, locator: Locator): Promise<void> {
  await locator.waitFor({ state: "visible", timeout: 10_000 });
  const box = await locator.boundingBox();
  if (!box) return;
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const screen = await cursorPosition(page, locator);
  if (screen) await moveSystemCursor(screen.x, screen.y);
  runtime.focusPoints.push({
    atMs: Math.max(300, Date.now() - runtime.startedAt),
    x: center.x / captureWidth,
    y: center.y / Math.max(1, await page.evaluate(() => window.innerHeight)),
  });
  await pause(420);
}

async function click(page: Page, runtime: Runtime, locator: Locator): Promise<void> {
  await focus(page, runtime, locator);
  await locator.click();
  await pause();
}

async function rightClick(page: Page, runtime: Runtime, locator: Locator): Promise<void> {
  await focus(page, runtime, locator);
  await locator.click({ button: "right" });
  await pause();
}

async function fill(page: Page, runtime: Runtime, locator: Locator, value: string): Promise<void> {
  await focus(page, runtime, locator);
  await locator.fill(value);
  await pause(550);
}

const chatRow = (page: Page, name: string) =>
  page.locator("[data-vy-chat-row]").filter({ hasText: name }).first();

async function openSettings(page: Page, runtime: Runtime, section: string): Promise<void> {
  await click(page, runtime, page.getByRole("button", { name: "設定", exact: true }));
  await click(page, runtime, page.getByRole("button", { name: section, exact: true }).first());
}

async function menuItem(page: Page, runtime: Runtime, name: string): Promise<void> {
  await click(page, runtime, page.getByRole("menuitem", { name, exact: true }));
}

const scenarios: Scenario[] = [
  {
    id: "chat-navigation",
    title: "チャット切替・カテゴリ・並び順",
    duration: 12,
    run: async (page, runtime) => {
      await click(page, runtime, chatRow(page, "サンプルサポート"));
      await click(page, runtime, page.getByRole("tab", { name: "グループ" }));
      await click(page, runtime, page.getByRole("tab", { name: "全体" }));
      await click(page, runtime, page.getByRole("button", { name: "並び順" }));
      await click(page, runtime, page.getByRole("button", { name: "未読順" }));
    },
  },
  {
    id: "chat-search-send",
    title: "チャット検索とメッセージ送信",
    duration: 12,
    run: async (page, runtime) => {
      await fill(page, runtime, page.getByLabel("チャットを検索"), "サポート");
      await click(page, runtime, chatRow(page, "サンプルサポート"));
      await fill(
        page,
        runtime,
        page.getByLabel("メッセージを入力"),
        "Vylineから安全にデモ送信しました",
      );
      await click(page, runtime, page.getByRole("button", { name: "送信", exact: true }));
      await page.getByText("Vylineから安全にデモ送信しました", { exact: true }).waitFor();
    },
  },
  {
    id: "reply",
    title: "引用リプライを実際に送信",
    duration: 13,
    run: async (page, runtime) => {
      await rightClick(
        page,
        runtime,
        page.getByText("これは撮影用の仮メッセージです。", { exact: false }),
      );
      await menuItem(page, runtime, "リプライ");
      await fill(
        page,
        runtime,
        page.getByLabel("メッセージを入力"),
        "了解です。引用して返信します！",
      );
      await click(page, runtime, page.getByRole("button", { name: "送信", exact: true }));
      await page.getByText("了解です。引用して返信します！", { exact: true }).waitFor();
    },
  },
  {
    id: "reaction-readers",
    title: "リアクション追加と既読者表示",
    duration: 13,
    run: async (page, runtime) => {
      await rightClick(
        page,
        runtime,
        page.getByText("これは撮影用の仮メッセージです。", { exact: false }),
      );
      await menuItem(page, runtime, "リアクション");
      await menuItem(page, runtime, "愛してる");
      await click(page, runtime, page.getByRole("button", { name: /既読者/ }).first());
    },
  },
  {
    id: "edit-message",
    title: "送信済みメッセージを編集",
    duration: 13,
    run: async (page, runtime) => {
      await rightClick(
        page,
        runtime,
        page.getByText("個人情報を含まない安全なPRデモです。", { exact: true }),
      );
      await menuItem(page, runtime, "編集");
      await fill(
        page,
        runtime,
        page.getByLabel("編集後のメッセージ"),
        "編集後も安全なPRデモです。変更履歴も確認できます。",
      );
      await click(page, runtime, page.getByRole("button", { name: "保存する" }));
      await page
        .getByText("編集後も安全なPRデモです。変更履歴も確認できます。", { exact: true })
        .waitFor();
    },
  },
  {
    id: "revoke-restore",
    title: "送信取り消しとローカル復元",
    duration: 15,
    run: async (page, runtime) => {
      const target = page.getByText("個人情報を含まない安全なPRデモです。", { exact: true });
      await rightClick(page, runtime, target);
      await menuItem(page, runtime, "送信を取り消し");
      const revoked = page.getByText("あなたが送信を取り消しました", { exact: false });
      await revoked.waitFor();
      await rightClick(page, runtime, revoked);
      await menuItem(page, runtime, "復元");
      await page.getByText("個人情報を含まない安全なPRデモです。", { exact: true }).waitFor();
    },
  },
  {
    id: "sticker-emoji",
    title: "スタンプとLINE絵文字を送信",
    duration: 14,
    run: async (page, runtime) => {
      await click(page, runtime, page.getByRole("button", { name: "スタンプ・絵文字" }));
      await click(page, runtime, page.getByTitle("サンプルハート"));
      await click(page, runtime, page.getByRole("button", { name: "スタンプ・絵文字" }));
      await click(page, runtime, page.getByRole("button", { name: "絵文字", exact: true }));
      await click(page, runtime, page.getByTitle("サンプルきらきら"));
    },
  },
  {
    id: "combination-sticker",
    title: "組み合わせスタンプを配置して送信",
    duration: 15,
    run: async (page, runtime) => {
      await click(page, runtime, page.getByRole("button", { name: "スタンプ・絵文字" }));
      const sun = page.getByTitle("サンプル太陽");
      await focus(page, runtime, sun);
      const box = await sun.boundingBox();
      if (!box) throw new Error("combo sticker is not visible");
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await pause(750);
      await page.mouse.up();
      await pause(500);
      await click(page, runtime, page.getByTitle("サンプルハート"));
      await click(page, runtime, page.getByRole("button", { name: "送信", exact: true }).last());
    },
  },
  {
    id: "mention-muted-send",
    title: "メンション候補とミュート送信",
    duration: 14,
    run: async (page, runtime) => {
      const input = page.getByLabel("メッセージを入力");
      await fill(page, runtime, input, "@");
      await click(page, runtime, page.getByRole("button", { name: /ALL/ }).first());
      await input.fill(`${await input.inputValue()} リリース内容を確認してください`);
      await click(page, runtime, page.getByRole("button", { name: "ミュート送信（通知なし）" }));
      await click(page, runtime, page.getByRole("button", { name: "ミュート送信", exact: true }));
    },
  },
  {
    id: "in-chat-search",
    title: "トーク内検索と前後移動",
    duration: 13,
    run: async (page, runtime) => {
      await click(page, runtime, page.getByRole("button", { name: "検索", exact: true }));
      await fill(page, runtime, page.getByLabel("トーク内を検索"), "デモ");
      await click(page, runtime, page.getByRole("button", { name: "次の一致" }));
      await click(page, runtime, page.getByRole("button", { name: "前の一致" }));
      await click(page, runtime, page.getByRole("button", { name: "検索を閉じる" }));
    },
  },
  {
    id: "chat-management",
    title: "ピン留め・通知ミュート・非表示",
    duration: 15,
    run: async (page, runtime) => {
      const row = chatRow(page, "サンプルサポート");
      await rightClick(page, runtime, row);
      await menuItem(page, runtime, "ピン留め");
      await rightClick(page, runtime, row);
      await menuItem(page, runtime, "通知をミュート");
      await rightClick(page, runtime, row);
      await menuItem(page, runtime, "非表示にする");
      await click(page, runtime, page.getByRole("tab", { name: "非表示" }));
    },
  },
  {
    id: "profile-members",
    title: "チャットプロフィールとメンバー表示",
    duration: 12,
    run: async (page, runtime) => {
      await click(page, runtime, page.getByRole("button", { name: "メニュー", exact: true }));
      await page.getByText("Vyline開発チーム", { exact: true }).waitFor();
      const member = page.getByText("あおい", { exact: true }).last();
      if (await member.isVisible()) await click(page, runtime, member);
    },
  },
  {
    id: "voice-video-call",
    title: "音声・ビデオ通話画面",
    duration: 15,
    run: async (page, runtime) => {
      await click(page, runtime, page.getByRole("button", { name: "音声通話" }));
      await click(page, runtime, page.getByRole("button", { name: "ミュート" }));
      await click(page, runtime, page.getByRole("button", { name: "通話を終了" }));
      await click(page, runtime, page.getByRole("button", { name: "ビデオ通話" }));
      await click(page, runtime, page.getByRole("button", { name: "カメラ切替" }));
      await click(page, runtime, page.getByRole("button", { name: "通話を終了" }));
    },
  },
  {
    id: "media-gallery",
    title: "画像・音声・ファイル・位置情報・Flex・通話履歴",
    duration: 12,
    run: async (page, runtime) => {
      await click(page, runtime, chatRow(page, "機能ギャラリー"));
      const surface = page.locator(".vy-chat-messages");
      await surface.evaluate((element) => element.scrollTo({ top: 0, behavior: "smooth" }));
      await pause(1400);
      await surface.evaluate((element) =>
        element.scrollTo({ top: element.scrollHeight * 0.55, behavior: "smooth" }),
      );
      await pause(1700);
    },
  },
  {
    id: "image-send",
    title: "画像の添付・プレビュー・送信・拡大",
    duration: 15,
    run: async (page, runtime) => {
      await focus(page, runtime, page.getByRole("button", { name: "写真を添付" }));
      await page
        .locator('input[type="file"][accept="image/*"]')
        .setInputFiles(join(desktopDir, "public", "demo", "chat-photo.svg"));
      await pause(700);
      await click(page, runtime, page.getByRole("button", { name: "送信", exact: true }).last());
      await click(page, runtime, page.getByRole("button", { name: "画像を拡大" }).last());
      await page.keyboard.press("Escape");
    },
  },
  {
    id: "voice-recording",
    title: "音声メッセージ録音の開始とキャンセル",
    duration: 11,
    run: async (page, runtime) => {
      await click(page, runtime, page.getByRole("button", { name: "音声メッセージを録音" }));
      await pause(1400);
      await click(page, runtime, page.getByRole("button", { name: "録音をキャンセル" }));
    },
  },
  {
    id: "create-group",
    title: "友だちを選んでデモグループ作成",
    duration: 15,
    run: async (page, runtime) => {
      await click(page, runtime, page.getByRole("tab", { name: "グループ" }));
      await click(page, runtime, page.getByRole("button", { name: "グループを作成" }));
      await fill(page, runtime, page.getByPlaceholder("グループ名（任意）"), "新製品デモチーム");
      await click(page, runtime, page.getByRole("button", { name: /サンプルサポート/ }));
      await click(page, runtime, page.getByRole("button", { name: "グループを作成" }));
      await page.getByText("新製品デモチーム", { exact: true }).waitFor();
    },
  },
  {
    id: "settings-profile",
    title: "プロフィール名とステータスを編集",
    duration: 14,
    run: async (page, runtime) => {
      await openSettings(page, runtime, "プロフィール");
      const name = page.getByText("表示名", { exact: true }).locator("..").getByRole("textbox");
      const status = page
        .getByText("ステータスメッセージ", { exact: true })
        .locator("..")
        .getByRole("textbox");
      await fill(page, runtime, name, "Vylineデモユーザー");
      await fill(page, runtime, status, "プライバシー安全なPR撮影中");
      await click(page, runtime, page.getByRole("button", { name: /プロフィールを保存/ }));
      await page.getByText("デモプロフィールを更新しました").waitFor();
    },
  },
  {
    id: "settings-read",
    title: "既読送信と既読者一覧の設定",
    duration: 11,
    run: async (page, runtime) => {
      await openSettings(page, runtime, "既読");
      await click(page, runtime, page.getByRole("switch", { name: "既読を送る" }));
      await click(page, runtime, page.getByRole("switch", { name: "既読者一覧を表示" }));
    },
  },
  {
    id: "settings-display",
    title: "表示密度・入力・背景・文字サイズ",
    duration: 16,
    run: async (page, runtime) => {
      await openSettings(page, runtime, "表示");
      await click(page, runtime, page.getByRole("button", { name: "Feather" }));
      await click(page, runtime, page.getByRole("switch", { name: "コンパクト表示" }));
      await click(page, runtime, page.getByRole("switch", { name: "背景表示" }));
      await click(page, runtime, page.getByRole("switch", { name: "吹き出しのしっぽ" }));
      const range = page.getByLabel("文字サイズ");
      await focus(page, runtime, range);
      await range.fill("1.15");
      await pause(700);
    },
  },
  {
    id: "settings-theme",
    title: "NezuThemeプリセットとカスタマイズ",
    duration: 15,
    run: async (page, runtime) => {
      await openSettings(page, runtime, "NezuTheme");
      await click(page, runtime, page.getByRole("button", { name: "ランダム" }));
      await click(page, runtime, page.getByRole("button", { name: /詳細カラー/ }));
      const radius = page.getByLabel("角丸");
      if (await radius.isVisible()) {
        await focus(page, runtime, radius);
        await radius.fill("24");
      }
    },
  },
  {
    id: "settings-notifications",
    title: "通知を無効化して再度有効化",
    duration: 12,
    run: async (page, runtime) => {
      await openSettings(page, runtime, "通知");
      const toggle = page.getByRole("switch", { name: "通知を有効にする" });
      await click(page, runtime, toggle);
      await click(page, runtime, toggle);
    },
  },
  {
    id: "settings-privacy",
    title: "配信者モード・プロキシ・ブロックリスト",
    duration: 17,
    run: async (page, runtime) => {
      await openSettings(page, runtime, "プライバシー");
      await click(page, runtime, page.getByRole("switch", { name: "配信者モード" }));
      await click(page, runtime, page.getByRole("switch", { name: "プロキシを使う" }));
      await fill(
        page,
        runtime,
        page.getByPlaceholder("http://127.0.0.1:7890"),
        "http://127.0.0.1:7890",
      );
      await click(page, runtime, page.getByRole("button", { name: "適用" }));
      await click(page, runtime, page.getByRole("button", { name: "取得" }));
      await click(page, runtime, page.getByRole("button", { name: "解除" }));
    },
  },
  {
    id: "settings-advanced",
    title: "手動同期・Desktop復元・設定バックアップ",
    duration: 16,
    run: async (page, runtime) => {
      await openSettings(page, runtime, "詳細・復元");
      await click(page, runtime, page.getByRole("button", { name: "同期", exact: true }));
      await page.getByText(/同期完了/).waitFor();
      await click(page, runtime, page.getByRole("button", { name: "復元", exact: true }));
      await page.getByText("Desktop データの復元が完了しました").waitFor();
      await click(page, runtime, page.getByRole("button", { name: "エクスポート" }));
    },
  },
  {
    id: "settings-subdevices",
    title: "サブデバイスQRとブロック管理",
    duration: 16,
    run: async (page, runtime) => {
      await openSettings(page, runtime, "サブデバイス");
      await click(page, runtime, page.getByRole("button", { name: "QRを表示" }));
      await click(page, runtime, page.getByRole("button", { name: "閉じる" }));
      page.once("dialog", (dialog) => dialog.accept());
      await click(page, runtime, page.getByRole("button", { name: "ブロック", exact: true }));
      await click(page, runtime, page.getByRole("button", { name: "解除", exact: true }));
    },
  },
  {
    id: "settings-storage",
    title: "ストレージ内訳とキャッシュ削除",
    duration: 13,
    run: async (page, runtime) => {
      await openSettings(page, runtime, "ストレージ");
      await page.getByText("476.0 MB", { exact: true }).first().waitFor();
      page.once("dialog", (dialog) => dialog.accept());
      const card = page
        .getByText("CDN キャッシュ", { exact: true })
        .last()
        .locator("..")
        .locator("..");
      await click(page, runtime, card.getByRole("button", { name: "削除" }));
    },
  },
  {
    id: "settings-info",
    title: "バージョン・更新情報・ライセンス",
    duration: 11,
    run: async (page, runtime) => {
      await openSettings(page, runtime, "情報");
      await page.getByText("Vyline", { exact: true }).last().waitFor();
      const scroller = page.locator(".vy-scroll").last();
      await scroller.evaluate((element) =>
        element.scrollTo({ top: element.scrollHeight, behavior: "smooth" }),
      );
      await pause(1800);
    },
  },
  {
    id: "settings-beta",
    title: "ベータ機能の同意と各機能トグル",
    duration: 18,
    run: async (page, runtime) => {
      await openSettings(page, runtime, "ベータ機能");
      const consent = page.getByRole("button", { name: "同意して有効化" });
      for (const label of [
        "プロフィールのブロック確認",
        "自動ブロック確認",
        "MID検索",
        "Agent I AIアシスタント",
      ]) {
        await click(page, runtime, page.getByRole("switch", { name: label }));
        if (await consent.isVisible()) await click(page, runtime, consent);
      }
    },
  },
  {
    id: "ios-backup",
    title: "iOSバックアップ検索と復元進捗",
    duration: 16,
    run: async (page, runtime) => {
      await openSettings(page, runtime, "ベータ機能");
      await page
        .getByText("iTunes / Apple Devices の復元", { exact: true })
        .scrollIntoViewIfNeeded();
      await click(page, runtime, page.getByRole("button", { name: "再検索" }));
      await fill(page, runtime, page.getByLabel("バックアップの暗号化パスワード"), "demo-password");
      await click(page, runtime, page.getByRole("button", { name: "復元開始" }));
      await page.getByText(/復元完了：/).waitFor();
    },
  },
];

function stamp(seconds: number): string {
  const ms = Math.round(seconds * 1000);
  const hh = Math.floor(ms / 3_600_000);
  const mm = Math.floor((ms % 3_600_000) / 60_000);
  const ss = Math.floor((ms % 60_000) / 1000);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
}

async function waitForServer(url: string): Promise<void> {
  for (let index = 0; index < 80; index += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* Vite is still starting. */
    }
    await pause(250);
  }
  throw new Error(`Vyline did not start at ${url}`);
}

async function stopProcessTree(pid: number | undefined): Promise<void> {
  if (!pid) return;
  const killer = Bun.spawn(["taskkill", "/PID", String(pid), "/T", "/F"], {
    stdout: "ignore",
    stderr: "ignore",
  });
  await killer.exited;
}

async function openDemo(): Promise<{
  context: BrowserContext;
  page: Page;
  forbiddenRequests: string[];
  consoleErrors: string[];
}> {
  const context = await chromium.launchPersistentContext(join(outputDir, ".playwright-profile"), {
    headless: false,
    viewport: null,
    args: [
      "--app=about:blank",
      `--window-size=${captureWidth},${captureHeight}`,
      "--window-position=0,0",
      "--force-device-scale-factor=1",
      "--disable-notifications",
    ],
  });
  const page = context.pages()[0] ?? (await context.newPage());
  const forbiddenRequests: string[] = [];
  const consoleErrors: string[] = [];
  await page.addInitScript(() => window.localStorage.clear());
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const localVite = url.origin === `http://127.0.0.1:${port}`;
    const safeInline = url.protocol === "data:" || url.protocol === "blob:";
    if ((localVite && !url.pathname.startsWith("/api/")) || safeInline) await route.continue();
    else {
      forbiddenRequests.push(url.toString());
      await route.abort();
    }
  });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page.getByText("DEMO MODE ON", { exact: false }).waitFor({ timeout: 30_000 });
  await page.evaluate(() => {
    document.title = "Vyline";
  });
  await pause(700);
  return { context, page, forbiddenRequests, consoleErrors };
}

async function verifyOpenScreen(): Promise<void> {
  if (dryRun) return;
  if (openscreenBin.includes("\\") || openscreenBin.includes("/")) {
    if (await Bun.file(openscreenBin).exists()) return;
  } else {
    const probe = Bun.spawn(["where", openscreenBin], { stdout: "pipe", stderr: "pipe" });
    if ((await probe.exited) === 0) return;
  }
  throw new Error(`OpenScreenが見つかりません: ${openscreenBin}`);
}

function writeSrt(path: string, scenario: Scenario): Promise<number> {
  return Bun.write(
    path,
    `1\n${stamp(0.25)} --> ${stamp(Math.min(4, scenario.duration - 1))}\n${scenario.title}\nVyline · PRデモ · 仮データのみ\n`,
  );
}

function record(projectPath: string, seconds: number) {
  return Bun.spawn(
    [
      openscreenBin,
      "record",
      "--window",
      "Vyline",
      "--duration",
      String(seconds),
      "--project",
      projectPath,
      "--cursor",
      "editable-overlay",
      "--json",
    ],
    { cwd: root, stdin: "pipe", stdout: "inherit", stderr: "inherit" },
  );
}

async function decorateProject(
  projectPath: string,
  scenario: Scenario,
  runtime: Runtime,
): Promise<void> {
  const project = (await Bun.file(projectPath).json()) as {
    editor?: { zoomRegions?: unknown[]; annotationRegions?: unknown[] };
  };
  project.editor ??= {};
  project.editor.zoomRegions ??= [];
  project.editor.annotationRegions ??= [];
  let previousEnd = 0;
  runtime.focusPoints.slice(0, 4).forEach((point, index) => {
    const startMs = Math.max(previousEnd + 180, point.atMs - 420);
    const endMs = Math.min(scenario.duration * 1000 - 350, startMs + 1_350);
    if (endMs <= startMs) return;
    project.editor!.zoomRegions!.push({
      id: `vyline-zoom-${index + 1}`,
      startMs,
      endMs,
      depth: 1.85,
      focus: {
        cx: Math.max(0.08, Math.min(0.92, point.x)),
        cy: Math.max(0.08, Math.min(0.92, point.y)),
      },
      focusMode: "manual",
      source: "manual",
    });
    previousEnd = endMs;
  });
  project.editor.annotationRegions.push({
    id: "vyline-title",
    startMs: 250,
    endMs: Math.min(3_200, scenario.duration * 1000 - 300),
    type: "text",
    content: scenario.title,
    textContent: scenario.title,
    position: { x: 4, y: 6 },
    size: { width: 58, height: 10 },
    style: { fontSize: 28, color: "#ffffff" },
    zIndex: 20,
  });
  await Bun.write(projectPath, JSON.stringify(project, null, 2));
}

async function exportProject(projectPath: string, rawPath: string): Promise<void> {
  const process = Bun.spawn(
    [
      openscreenBin,
      "export",
      projectPath,
      "--auto-zoom",
      "--quality",
      "source",
      "-o",
      rawPath,
      "--json",
    ],
    { cwd: root, stdout: "inherit", stderr: "inherit" },
  );
  if ((await process.exited) !== 0) throw new Error("OpenScreen export failed");
}

async function finishHighQuality(rawPath: string, finalPath: string): Promise<void> {
  const hqPath = finalPath.replace(/\.mp4$/i, ".hq.mp4");
  const process = Bun.spawn(
    [
      "ffmpeg",
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      rawPath,
      "-vf",
      "fps=60",
      "-c:v",
      "libx264",
      "-preset",
      "slow",
      "-crf",
      "14",
      "-profile:v",
      "high",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-an",
      hqPath,
    ],
    { cwd: root, stdout: "inherit", stderr: "inherit" },
  );
  if ((await process.exited) !== 0) throw new Error("ffmpeg high-quality pass failed");
  await unlink(rawPath).catch(() => undefined);
  await rename(hqPath, finalPath);
}

async function probeVideo(path: string): Promise<Record<string, unknown>> {
  const process = Bun.spawn(
    [
      "ffprobe",
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=codec_name,width,height,avg_frame_rate,pix_fmt",
      "-show_entries",
      "format=duration,bit_rate",
      "-of",
      "json",
      path,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const output = await new Response(process.stdout).text();
  const error = await new Response(process.stderr).text();
  if ((await process.exited) !== 0) throw new Error(`ffprobe failed: ${error}`);
  const parsed = JSON.parse(output) as {
    streams?: Array<Record<string, unknown>>;
    format?: Record<string, unknown>;
  };
  const stream = parsed.streams?.[0] ?? {};
  if (stream.codec_name !== "h264" || stream.avg_frame_rate !== "60/1")
    throw new Error(`video quality check failed: ${JSON.stringify(stream)}`);
  return { ...stream, ...parsed.format };
}

async function main(): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  await verifyOpenScreen();
  const requested = process.env.VYLINE_PR_SCENARIOS?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const selected = requested?.length
    ? scenarios.filter((scenario) => requested.includes(scenario.id))
    : scenarios;
  if (requested?.length && selected.length !== requested.length)
    throw new Error(
      `unknown scenario: ${requested.filter((id) => !scenarios.some((scenario) => scenario.id === id)).join(", ")}`,
    );
  const server = Bun.spawn(
    ["bun", "./node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(port)],
    { cwd: desktopDir, stdout: "ignore", stderr: "inherit" },
  );
  await waitForServer(appUrl);
  const report: Array<Record<string, unknown>> = [];
  const allStartedAt = Date.now();
  console.log(`[pr-video] mode=${dryRun ? "dry-run" : "record"} scenarios=${selected.length}`);
  try {
    for (const [selectedIndex, scenario] of selected.entries()) {
      const globalIndex = scenarios.findIndex((item) => item.id === scenario.id) + 1;
      const basename = `vyline-${String(globalIndex).padStart(2, "0")}-${scenario.id}`;
      const projectPath = join(outputDir, `${basename}.openscreen`);
      const rawPath = join(outputDir, `${basename}.raw.mp4`);
      const finalPath = join(outputDir, `${basename}.mp4`);
      const srtPath = join(outputDir, `${basename}.srt`);
      const startedAt = Date.now();
      console.log(
        `\n[pr-video] ${selectedIndex + 1}/${selected.length} ${scenario.id}: ${scenario.title}`,
      );
      await writeSrt(srtPath, scenario);
      const { context, page, forbiddenRequests, consoleErrors } = await openDemo();
      const runtime: Runtime = { startedAt: Date.now(), focusPoints: [] };
      let recorder: ReturnType<typeof record> | null = null;
      try {
        if (!dryRun) {
          recorder = record(projectPath, scenario.duration);
          runtime.startedAt = Date.now();
          await pause(900);
        }
        await scenario.run(page, runtime);
        await pause(1_250);
        if (forbiddenRequests.length)
          throw new Error(
            `forbidden network request: ${[...new Set(forbiddenRequests)].join(", ")}`,
          );
        if (consoleErrors.length)
          throw new Error(`browser console error: ${consoleErrors.join(" | ")}`);
        if (recorder && (await recorder.exited) !== 0) throw new Error("OpenScreen record failed");
      } catch (error) {
        if (recorder && recorder.exitCode == null) {
          recorder.stdin.write("stop\n");
          recorder.stdin.end();
          await recorder.exited;
        }
        throw error;
      } finally {
        await context.close();
      }

      let probe: Record<string, unknown> = {};
      if (!dryRun) {
        await decorateProject(projectPath, scenario, runtime);
        await exportProject(projectPath, rawPath);
        await finishHighQuality(rawPath, finalPath);
        probe = await probeVideo(finalPath);
      }
      const elapsed = (Date.now() - startedAt) / 1000;
      report.push({
        id: scenario.id,
        title: scenario.title,
        seconds: elapsed,
        file: dryRun ? null : finalPath,
        ...probe,
      });
      const completed = selectedIndex + 1;
      const eta = Math.round(
        (((Date.now() - allStartedAt) / completed) * (selected.length - completed)) / 1000,
      );
      console.log(
        `[pr-video] complete ${Math.round((completed / selected.length) * 100)}% · ${elapsed.toFixed(1)}s · ETA ${eta}s`,
      );
    }
  } finally {
    await stopProcessTree(server.pid);
  }
  await Bun.write(
    join(outputDir, dryRun ? "dry-run-report.json" : "recording-report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(`\n[pr-video] DONE ${report.length}/${selected.length} · ${outputDir}`);
}

await main();
