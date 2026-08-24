import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type BrowserContext, type Page } from "@playwright/test";

const root = join(import.meta.dir, "..", "..", "..", "..");
const desktopDir = join(root, "Vyline", "apps", "desktop");
const outputDir = join(root, "recordings", "openscreen");
const port = 5173;
const appUrl = `http://127.0.0.1:${port}/pr-demo`;
const openscreenBin = process.env.OPENSCREEN_BIN ?? "Openscreen.exe";

const scenarios = [
  ["chat", "チャット一覧と仮メッセージ"],
  ["search-send", "検索とローカルデモ送信"],
  ["sticker-emoji", "スタンプと絵文字"],
  ["reply", "返信メニュー"],
  ["chat-search", "トーク内検索"],
  ["profile", "プロフィール表示"],
  ["display", "表示設定"],
  ["theme", "NezuTheme"],
  ["notifications", "通知設定"],
  ["privacy", "プライバシー設定"],
  ["advanced", "詳細・復元"],
  ["subdevices", "サブデバイス"],
  ["storage", "ストレージ"],
  ["info", "Vyline情報"],
  ["beta", "ベータ機能"],
] as const;

function stamp(seconds: number): string {
  const ms = Math.round(seconds * 1000);
  return `00:00:${String(Math.floor(ms / 1000)).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
}

async function waitForServer(url: string): Promise<void> {
  for (let i = 0; i < 80; i += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Vite is still starting.
    }
    await Bun.sleep(250);
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

function safeTitle(page: Page): Promise<void> {
  return page.evaluate(() => {
    document.title = "Vyline";
  });
}

async function moveSystemCursor(x: number, y: number): Promise<void> {
  const command = `[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${Math.round(x)},${Math.round(y)})`;
  const process = Bun.spawn(
    ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", `Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; ${command}`],
    { stdout: "ignore", stderr: "ignore" },
  );
  await process.exited;
}

type ActionLocator = {
  boundingBox: () => Promise<{ x: number; y: number; width: number; height: number } | null>;
  click: (options?: { force?: boolean; button?: "left" | "right" }) => Promise<void>;
};

async function hover(locator: ActionLocator): Promise<void> {
  const box = await locator.boundingBox();
  if (!box) return;
  await moveSystemCursor(box.x + box.width / 2, box.y + box.height / 2);
  await Bun.sleep(650);
}

async function clickWithCursor(locator: ActionLocator): Promise<void> {
  await hover(locator);
  await locator.click();
}

async function openDemo(): Promise<{ context: BrowserContext; page: Page }> {
  // app mode removes the browser chrome from the OpenScreen window capture.
  const context = await chromium.launchPersistentContext(
    join(outputDir, ".playwright-profile"),
    {
      headless: false,
      viewport: { width: 1440, height: 900 },
      args: ["--app=about:blank", "--window-size=1440,900", "--force-device-scale-factor=1"],
    },
  );
  const page = context.pages()[0] ?? (await context.newPage());
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.startsWith("http://127.0.0.1:5173/") || url.startsWith("data:") || url.startsWith("blob:")) {
      await route.continue();
    } else {
      await route.abort();
    }
  });
  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("domcontentloaded");
  await page.getByText("DEMO MODE ON", { exact: false }).waitFor({ timeout: 30_000 });
  await safeTitle(page);
  return { context, page };
}

async function clickSettings(page: Page, label: string): Promise<void> {
  await clickWithCursor(page.getByRole("button", { name: "設定", exact: true }));
  await page.waitForTimeout(500);
  await clickWithCursor(page.getByRole("button", { name: label, exact: true }));
}

async function perform(page: Page, id: string): Promise<void> {
  if (id === "chat") {
    // 初期表示そのものを撮影する。
    await moveSystemCursor(700, 450);
  } else if (id === "search-send") {
    const search = page.getByLabel("チャットを検索");
    await hover(search);
    await search.fill("サポート");
    await page.waitForTimeout(700);
    await search.fill("");
    const input = page.getByLabel("メッセージを入力");
    await hover(input);
    await input.fill("これは安全なローカルデモ送信です");
    await input.press("Enter");
  } else if (id === "sticker-emoji") {
    await clickWithCursor(page.getByRole("button", { name: "スタンプ・絵文字" }));
    await page.waitForTimeout(700);
    const sticker = page.locator('img[alt="サンプルハート"]:visible').first();
    if (await sticker.count()) {
      await hover(sticker);
      await sticker.click({ force: true });
    }
  } else if (id === "reply") {
    const bubble = page.getByText("これは撮影用の仮メッセージです。", { exact: false }).first();
    await hover(bubble);
    await bubble.click({ button: "right" });
  } else if (id === "chat-search") {
    await clickWithCursor(page.getByRole("button", { name: "検索", exact: true }));
    const search = page.getByRole("textbox", { name: "トーク内を検索" });
    await hover(search);
    await search.fill("仮メッセージ");
  } else if (id === "profile") {
    await clickWithCursor(page.getByRole("button", { name: "メニュー", exact: true }));
  } else {
    const labels: Record<string, string> = {
      display: "表示",
      theme: "NezuTheme",
      notifications: "通知",
      privacy: "プライバシー",
      advanced: "詳細・復元",
      subdevices: "サブデバイス",
      storage: "ストレージ",
      info: "情報",
      beta: "ベータ機能",
    };
    await clickSettings(page, labels[id] ?? id);
  }
  await page.waitForTimeout(5_500);
}

function writeSrt(id: string, title: string): Promise<void> {
  return Bun.write(
    join(outputDir, `vyline-demo-${id}.srt`),
    `1\n${stamp(0.5)} --> ${stamp(5.8)}\n${title}\nVyline · DEMO MODE ON · 仮データのみ\n`,
  );
}

async function runOpenScreen(projectPath: string, seconds: number): Promise<{ process: ReturnType<typeof Bun.spawn> }> {
  const process = Bun.spawn(
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
  return { process };
}

async function exportOpenScreen(projectPath: string, mp4Path: string): Promise<void> {
  const process = Bun.spawn(
    [openscreenBin, "export", projectPath, "--auto-zoom", "--quality", "source", "-o", mp4Path, "--json"],
    { cwd: root, stdout: "inherit", stderr: "inherit" },
  );
  const code = await process.exited;
  if (code !== 0) throw new Error(`OpenScreen export failed: ${code}`);
}

async function verifyOpenScreen(): Promise<void> {
  try {
    if (openscreenBin.includes("\\") || openscreenBin.includes("/")) {
      if (await Bun.file(openscreenBin).exists()) return;
      throw new Error("absolute path does not exist");
    }
    const probe = Bun.spawn(["where", openscreenBin], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await probe.exited;
    if (code !== 0) throw new Error(`exit ${code}`);
  } catch {
    throw new Error(
      `OpenScreenが見つかりません。v1.10.0をインストールし、` +
        `OPENSCREEN_BIN に Openscreen.exe の絶対パスを指定してください。` +
        `\nhttps://github.com/getopenscreen/openscreen/releases/latest`,
    );
  }
}

async function main(): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  await verifyOpenScreen();
  const requested = process.env.VYLINE_PR_SCENARIOS?.split(",").map((value) => value.trim()).filter(Boolean);
  const selectedScenarios = requested?.length
    ? scenarios.filter(([id]) => requested.includes(id))
    : scenarios;
  const server = Bun.spawn(
    ["bun", "./node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(port)],
    { cwd: desktopDir, stdout: "ignore", stderr: "inherit" },
  );
  try {
    await waitForServer(appUrl);
    console.log(`[openscreen] recorder: ${openscreenBin}`);
    console.log(`[openscreen] scenarios: ${selectedScenarios.length}`);
    for (const [index, [id, title]] of selectedScenarios.entries()) {
      const projectPath = join(outputDir, `vyline-demo-${id}.openscreen`);
      const mp4Path = join(outputDir, `vyline-demo-${id}.mp4`);
      await writeSrt(id, title);
      const { context, page } = await openDemo();
      const { process } = await runOpenScreen(projectPath, 8);
      await page.waitForTimeout(900);
      await perform(page, id);
      await process.exited;
      await context.close();
      await exportOpenScreen(projectPath, mp4Path);
      console.log(`[openscreen] ${id}: ${Math.round(((index + 1) / selectedScenarios.length) * 100)}%`);
    }
  } finally {
    await stopProcessTree(server.pid);
  }
}

await main();
