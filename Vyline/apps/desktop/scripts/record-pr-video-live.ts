import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const root = join(import.meta.dir, "..", "..", "..", "..");
const outputDir = join(root, "recordings");
const videoPath = join(outputDir, "vyline-pr-live.webm");
const srtPath = join(outputDir, "vyline-pr-live.srt");
const mp4Path = join(outputDir, "vyline-pr-live.mp4");
const port = 5173;
const targetName = process.env.VYLINE_PR_TARGET ?? "うがうがうー";
const sendEnabled = process.env.VYLINE_PR_SEND === "1";

const subtitles = [
  "Vyline本体を起動してログイン状態を復元",
  "実際のチャット一覧からトークを開く",
  "実際の入力欄でメッセージを入力",
  "実際のLINEスタンプピッカーを表示",
  "実際の設定画面を開く",
];

function makeSrt(): string {
  return subtitles
    .map((text, index) => {
      const start = index * 6;
      const end = start + 5.5;
      const stamp = (seconds: number) => `00:00:${String(seconds).padStart(2, "0")},000`;
      return `${index + 1}\n${stamp(start)} --> ${stamp(end)}\n${text}\n`;
    })
    .join("\n");
}

async function waitForServer(url: string): Promise<void> {
  for (let i = 0; i < 80; i += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Backend/frontend are still starting.
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

async function main() {
  await mkdir(outputDir, { recursive: true });
  await Bun.write(srtPath, makeSrt());
  const server = Bun.spawn(["bun", "run", "dev"], {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      recordVideo: { dir: outputDir, size: { width: 1440, height: 900 } },
    });
    const page = await context.newPage();
    await waitForServer(`http://127.0.0.1:${port}/`);
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(8_000);

    if (page.url().includes("/login")) {
      throw new Error("Vyline is not logged in. Restore a test account before recording.");
    }

    const consentButton = page.getByRole("button", { name: "同意して利用を開始する", exact: true });
    if (await consentButton.isVisible().catch(() => false)) {
      await page.getByRole("checkbox").check();
      await consentButton.click();
      console.log("[pr-live] accepted the real Vyline terms gate");
    }

    const openChatButton = page.getByRole("button", { name: "チャットを開く", exact: true });
    if (await openChatButton.isVisible().catch(() => false)) {
      await openChatButton.click();
    }

    const rows = page.locator("[data-vy-chat-row] button");
    await rows.first().waitFor({ state: "visible", timeout: 30_000 });
    console.log(`[pr-live] loaded real Vyline UI (${await rows.count()} chats)`);
    await page.waitForTimeout(2_000);

    const target = rows.filter({ hasText: targetName }).first();
    if (await target.count()) {
      await target.click();
    } else if (sendEnabled) {
      throw new Error(`Safe send target not found: ${targetName}`);
    } else {
      console.log(
        `[pr-live] target ${targetName} not found; opening the first real chat without sending`,
      );
      await rows.first().click();
    }
    await page.waitForTimeout(2_500);

    const input = page.getByRole("textbox", { name: "メッセージを入力" });
    await input.waitFor({ state: "visible", timeout: 10_000 });
    await input.fill("Vylineの実際のチャット操作を録画中です ✨");
    await page.waitForTimeout(800);
    if (sendEnabled) {
      await page.getByRole("button", { name: "送信" }).click();
      console.log("[pr-live] sent a real message through the Vyline UI");
    } else {
      console.log(
        "[pr-live] preview only; set VYLINE_PR_SEND=1 to send to the approved test target",
      );
      await input.fill("");
    }
    await page.waitForTimeout(2_000);

    await page.getByRole("button", { name: "スタンプ・絵文字" }).click();
    await page
      .getByRole("button", { name: "スタンプ", exact: true })
      .click()
      .catch(() => undefined);
    const sticker = page.locator(".vy-scale-in button:has(img)").first();
    if ((await sticker.count()) && (await sticker.isVisible().catch(() => false))) {
      if (sendEnabled) {
        await sticker.click();
        console.log("[pr-live] selected a real sticker through the Vyline UI");
      } else {
        console.log("[pr-live] displayed the real sticker picker without sending");
      }
      await page.waitForTimeout(1_000);
    }
    await page.waitForTimeout(2_000);

    await page.getByRole("button", { name: "設定", exact: true }).click();
    await page.waitForTimeout(2_500);
    console.log("[pr-live] opened the real settings screen");
    await context.close();
    const video = page.video();
    if (video) await video.saveAs(videoPath);
    console.log(`Recorded ${videoPath}`);
  } finally {
    await browser?.close();
    await stopProcessTree(server.pid);
  }

  const ffmpeg = Bun.spawn(
    [
      "ffmpeg",
      "-y",
      "-i",
      videoPath,
      "-vf",
      "subtitles=recordings/vyline-pr-live.srt",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      mp4Path,
    ],
    { cwd: root, stdout: "ignore", stderr: "inherit" },
  );
  if ((await ffmpeg.exited) === 0) console.log(`Created ${mp4Path}`);
}

await main();
