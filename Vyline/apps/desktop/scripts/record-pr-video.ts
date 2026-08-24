import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const root = join(import.meta.dir, "..", "..", "..", "..");
const outputDir = join(root, "recordings");
const webmPath = join(outputDir, "vyline-pr-demo.webm");
const srtPath = join(outputDir, "vyline-pr-demo.srt");
const mp4Path = join(outputDir, "vyline-pr-demo.mp4");
const port = 5173;

const captions = [
  ["LINEを、もっと自由に。", "Vyline — LINEのための、速くて美しいクライアント"],
  ["会話が、気持ちよく続く", "高速なチャット、既読、返信、検索をひとつに"],
  ["スタンプも、絵文字も", "LINEのスタンプと絵文字をそのまま表示・送信"],
  ["Flex Messageを美しく", "カルーセルもボタンも、LINE準拠の描画で"],
  ["写真も、動画も、安心", "メディア表示とE2EEを意識した設計"],
  ["好きな見た目に変えられる", "VyThemeで色、背景、密度をカスタマイズ"],
  ["大切な履歴を守る", "VylineBackupでトークとメディアをスナップショット"],
  ["あなたのLINEを、あなたらしく", "Vyline — オープンソースのLINEクライアント"],
] as const;

function timestamp(seconds: number): string {
  const ms = Math.round(seconds * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
}

function makeSrt(): string {
  return captions
    .map(([title, caption], i) => {
      const start = i * 4.2 + 0.35;
      const end = (i + 1) * 4.2 - 0.25;
      return `${i + 1}\n${timestamp(start)} --> ${timestamp(end)}\n${title}\n${caption}\n`;
    })
    .join("\n");
}

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

async function main() {
  await mkdir(outputDir, { recursive: true });
  await Bun.write(srtPath, makeSrt());
  const server = Bun.spawn(
    ["bun", "./node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(port)],
    { cwd: join(root, "Vyline", "apps", "desktop"), stdout: "ignore", stderr: "inherit" },
  );
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    await waitForServer(`http://127.0.0.1:${port}/pr-demo`);
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      recordVideo: { dir: outputDir, size: { width: 1440, height: 900 } },
    });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}/pr-demo`, { waitUntil: "networkidle" });
    await page.getByTestId("pr-demo").waitFor();
    for (let scene = 1; scene <= captions.length; scene += 1) {
      console.log(
        `[pr-video] scene ${scene}/${captions.length} (${Math.round((scene / captions.length) * 100)}%)`,
      );
      await page.waitForTimeout(4_200);
    }
    await context.close();
    const video = page.video();
    if (video) await video.saveAs(webmPath);
    console.log(`Recorded ${webmPath}`);
  } finally {
    await browser?.close();
    const killer = Bun.spawn(["taskkill", "/PID", String(server.pid), "/T", "/F"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    await killer.exited;
  }

  // Use a relative filter path: FFmpeg treats the colon in a Windows drive letter
  // (for example E:) as a filter option separator.
  const ffmpeg = Bun.spawn(
    [
      "ffmpeg",
      "-y",
      "-i",
      webmPath,
      "-vf",
      "subtitles=recordings/vyline-pr-demo.srt",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      mp4Path,
    ],
    { cwd: root, stdout: "ignore", stderr: "inherit" },
  );
  const exitCode = await ffmpeg.exited;
  if (exitCode === 0) console.log(`Created ${mp4Path}`);
  else console.log("FFmpeg not available or subtitle rendering failed; WebM and SRT were kept.");
}

await main();
