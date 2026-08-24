import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Page } from "@playwright/test";

const root = join(import.meta.dir, "..", "..", "..", "..");
const outputDir = join(root, "recordings", "demo-clips");
const port = 5173;
const clips = [
  ["chat", "仮データのチャットを表示"],
  ["search-send", "検索とローカルデモ送信"],
  ["sticker-emoji", "スタンプ・絵文字UI"],
  ["reply", "返信操作"],
  ["settings-display", "表示設定"],
  ["settings-theme", "テーマ設定"],
  ["settings-privacy", "プライバシー設定"],
  ["settings-advanced", "詳細・復元とベータ機能"],
] as const;

async function waitForServer(url: string): Promise<void> {
  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Vite is still starting.
    }
    await Bun.sleep(250);
  }
  throw new Error(`Vite did not start at ${url}`);
}

function srt(title: string): string {
  return `1\n00:00:00,500 --> 00:00:06,800\n${title}\nVyline PR Demo · DEMO MODE ON · 仮データのみ\n`;
}

async function perform(page: Page, id: string): Promise<void> {
  if (id === "search-send") {
    await page.getByLabel("チャットを検索").fill("サポート");
    await page.waitForTimeout(800);
    await page.getByLabel("チャットを検索").fill("");
    await page.getByLabel("メッセージを入力").fill("これは安全なローカルデモ送信です");
    await page.getByLabel("メッセージを入力").press("Enter");
  } else if (id === "sticker-emoji") {
    await page.getByRole("button", { name: "スタンプ・絵文字" }).click();
    await page.waitForTimeout(900);
    const sticker = page.locator('img[alt="サンプルハート"]:visible').first();
    if (await sticker.count()) await sticker.click({ force: true });
    await page.waitForTimeout(700);
  } else if (id === "reply") {
    const bubble = page.getByText("これは撮影用の仮メッセージです。", { exact: false }).first();
    await bubble.click({ button: "right" });
    await page.waitForTimeout(700);
  } else if (id.startsWith("settings-")) {
    await page.getByRole("button", { name: "設定", exact: true }).click();
    await page.waitForTimeout(700);
    const section = id.replace("settings-", "");
    const labels: Record<string, string> = {
      display: "表示",
      theme: "NezuTheme",
      privacy: "プライバシー",
      advanced: "詳細・復元",
    };
    await page.getByRole("button", { name: labels[section] }).click();
    await page.waitForTimeout(1200);
  }
  await page.waitForTimeout(4_500);
}

async function main() {
  await mkdir(outputDir, { recursive: true });
  const server = Bun.spawn(
    ["bun", "./node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(port)],
    { cwd: join(root, "Vyline", "apps", "desktop"), stdout: "ignore", stderr: "inherit" },
  );
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await waitForServer(`http://127.0.0.1:${port}/pr-demo`);
    browser = await chromium.launch({ headless: true });
    for (const [index, [id, title]] of clips.entries()) {
      const webmPath = join(outputDir, `vyline-demo-${id}.webm`);
      const mp4Path = join(outputDir, `vyline-demo-${id}.mp4`);
      const srtPath = join(outputDir, `vyline-demo-${id}.srt`);
      await Bun.write(srtPath, srt(title));
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        recordVideo: { dir: outputDir, size: { width: 1440, height: 900 } },
      });
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${port}/pr-demo`, { waitUntil: "networkidle" });
      await page.getByText("DEMO MODE ON", { exact: false }).waitFor();
      await perform(page, id);
      const video = page.video();
      await context.close();
      if (video) await video.saveAs(webmPath);
      const ffmpeg = Bun.spawn(
        [
          "ffmpeg",
          "-y",
          "-i",
          webmPath,
          "-vf",
          `subtitles=recordings/demo-clips/vyline-demo-${id}.srt`,
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          mp4Path,
        ],
        { cwd: root, stdout: "ignore", stderr: "ignore" },
      );
      await ffmpeg.exited;
      console.log(`[demo-clips] ${id}: ${Math.round(((index + 1) / clips.length) * 100)}%`);
    }
  } finally {
    await browser?.close();
    const killer = Bun.spawn(["taskkill", "/PID", String(server.pid), "/T", "/F"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    await killer.exited;
  }
}

await main();
