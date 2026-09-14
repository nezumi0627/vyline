import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spyOn } from "bun:test";
import { chromium, expect, type Locator } from "@playwright/test";

// Run against a local Vite server after dev:compose. Only synthetic data is used:
// bun scripts/check-video-playback.ts (requires Chrome and ffmpeg).
const base = process.env.VYLINE_TEST_URL ?? "http://127.0.0.1:5189";
assert(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const root = await mkdtemp(join(tmpdir(), "vyline-video-playback-"));
const output = resolve(import.meta.dir, "../test-results/video-playback");
await mkdir(output, { recursive: true });
process.env.VYLINE_DATA_DIR = join(root, "data");
process.env.VYLINE_STORAGE_DIR = join(root, "storage");
process.env.VYLINE_MEDIA_STORAGE_DIR = join(root, "storage", "saved-media");
process.env.VYLINE_MEDIA_INDEX_PATH = join(root, "storage", "media-index.sqlite");
process.env.VYLINE_BACKUP_DIR = join(root, "data", "backups");
const chatStore = await import("../../../backend/src/storage/chatStore.js");
const mediaStorage = await import("../../../backend/src/storage/mediaStorage.js");
const clientManager = await import("../../../backend/src/line/clientManager.js");
const { E2EE } = await import("../../../packages/protocol/stack/base/e2ee/mod.ts");
const { LineObs } = await import("../../../packages/protocol/stack/base/obs/mod.ts");
const e2ee = new E2EE({} as never);
const obs = new LineObs({ e2ee } as never);
const accountId = "video-fixture";
const chatMid = "demo-chat-team";
const wires = new Map<string, Buffer>();
let downloads = 0;
obs.downloadObjectResponseForService = async ({ oid }) => {
  const wire = wires.get(oid);
  assert(wire, "Only fixture OBS objects may be downloaded");
  downloads++;
  let offset = 0;
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset === wire.length) { controller.close(); return; }
      const end = Math.min(wire.length, offset + 17011);
      controller.enqueue(wire.subarray(offset, end));
      offset = end;
    },
  }), { headers: { "Content-Length": String(wire.length) } });
};
const clientSpy = spyOn(clientManager, "getClient").mockImplementation(
  id => id === accountId ? ({ base: { obs } } as never) : undefined,
);
const { lineRouter } = await import("../../../backend/src/api/line.js");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results: object[] = [];

async function playback(video: Locator) {
  await expect(video).toBeVisible();
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2);
  const dimensions = await video.evaluate(element => {
    const v = element as HTMLVideoElement;
    return { width: v.videoWidth, height: v.videoHeight, duration: v.duration, error: v.error?.message };
  });
  assert.equal(dimensions.width, 320);
  assert.equal(dimensions.height, 180);
  assert.equal(dimensions.error, undefined);
  await video.evaluate(async element => { const v = element as HTMLVideoElement; v.muted = true; await v.play(); });
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).currentTime)).toBeGreaterThan(.1);
  await video.evaluate(element => { const v = element as HTMLVideoElement; v.pause(); v.currentTime = 1; });
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).seeking)).toBe(false);
  assert.equal(await video.evaluate(element => (element as HTMLVideoElement).currentTime), 1);
  return dimensions;
}

try {
  const movie = join(root, "fixture.mp4");
  const encode = Bun.spawnSync(["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "lavfi",
    "-i", "testsrc2=size=320x180:rate=10", "-t", "3", "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-movflags", "+faststart", movie]);
  assert.equal(encode.exitCode, 0, encode.stderr.toString());
  const plain = await readFile(movie);
  const key = Buffer.alloc(32, 0x48);
  const keys = await e2ee.deriveKeyMaterial(key);
  const cipher = crypto.createCipheriv("aes-256-ctr", keys.encKey, keys.nonce);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  const hashes: Buffer[] = [];
  for (let offset = 0; offset < ciphertext.length; offset += 131072)
    hashes.push(crypto.createHash("sha256").update(ciphertext.subarray(offset, offset + 131072)).digest());

  for (const mode of ["legacy", "apple", "fluent", "miuix"]) {
    const sourceMessages = [false, true].map(isMyMessage => {
      const id = `${mode}-${isMyMessage ? "sent" : "received"}`;
      const tag = crypto.createHmac("sha256", keys.macKey)
        .update(isMyMessage ? ciphertext : Buffer.concat(hashes)).digest();
      wires.set(id, Buffer.concat([ciphertext, tag]));
      return { id, chatMid, from: isMyMessage ? "u-self" : "u-peer", to: "u-peer", text: null,
        contentType: "VIDEO", createdTime: Date.now(), isMyMessage,
        contentMetadata: { SID: "emv", OID: id, keyMaterial: key.toString("base64"), e2eeVersion: "2" },
        savedAt: new Date().toISOString() };
    });
    await chatStore.upsertMessages(accountId, chatMid, sourceMessages);
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors: string[] = [];
    const responses: { id: string; status: number; preview: string | null; range: string | null }[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== base) return route.abort();
      if (url.pathname.startsWith(`/api/line/${accountId}/media/`)) {
        const response = await lineRouter.request(`http://localhost${url.pathname.slice("/api/line".length)}${url.search}`,
          { headers: route.request().headers() });
        responses.push({ id: url.pathname.split("/").at(-1)!, status: response.status,
          preview: url.searchParams.get("preview"), range: response.headers.get("content-range") });
        return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers),
          body: Buffer.from(await response.arrayBuffer()) });
      }
      if (url.pathname.startsWith("/api/")) return route.fulfill({ json: { ok: true, chats: [], members: [], results: [] } });
      return route.continue();
    });
    await page.addInitScript(mode => localStorage.setItem("vyline:design-system",
      JSON.stringify({ state: { mode, appearance: "light" }, version: 0 })), mode);
    await page.goto(`${base}/pr-demo`);
    await expect.poll(() => page.evaluate(async () => {
      const path = performance.getEntriesByType("resource")
        .findLast(entry => new URL(entry.name).pathname === "/src/lib/store.ts")?.name;
      if (!path) return false;
      const { useStore } = await import(path);
      return useStore.getState().demoMode && useStore.getState().accountId === null;
    }), { timeout: 15000 }).toBe(true);
    if (mode !== "legacy") await expect(page.locator('[data-kmp-ready="true"]')).toBeVisible({ timeout: 60000 });
    await page.evaluate(async ({ messages, accountId }) => {
      const load = (path: string) => import(performance.getEntriesByType("resource")
        .findLast(entry => new URL(entry.name).pathname === path)?.name ?? path);
      const { useStore } = await load("/src/lib/store.ts");
      const { mapMessage } = await load("/src/lib/mappers.ts");
      const state = useStore.getState();
      if (!state.demoMode || state.accountId !== null) throw new Error("Demo-only fixture");
      useStore.setState({ messages: messages.map(message => ({ ...mapMessage(message, state.activeChatId, accountId),
        file: { name: `${message.id}.mp4` } })) });
    }, { messages: sourceMessages.map(({ contentMetadata: _, ...message }) => message), accountId });
    const videos = mode === "legacy" ? page.locator("video") : page.frameLocator('iframe[title="Vyline Compose UI"]').locator("video");
    await expect(videos).toHaveCount(2);
    const played = [await playback(videos.nth(0)), await playback(videos.nth(1))];
    await page.screenshot({ path: join(output, `${mode}.png`) });
    for (const message of sourceMessages) {
      const media = await mediaStorage.statMediaStorage(accountId, chatMid, message.id);
      assert(media);
      assert.deepEqual(await readFile(media.path), plain);
      assert(responses.some(response => response.id === message.id && response.status === 206 && response.range));
    }
    if (mode === "legacy") {
      await page.evaluate(async ({ accountId, chatMid, id }) => {
        const load = (path: string) => import(performance.getEntriesByType("resource")
          .findLast(entry => new URL(entry.name).pathname === path)?.name ?? path);
        const React = (await load("/node_modules/.vite/deps/react.js")).default;
        const { createRoot } = (await load("/node_modules/.vite/deps/react-dom_client.js")).default;
        const { MediaLightbox } = await load("/src/components/media-lightbox.tsx");
        const host = document.createElement("div"); document.body.append(host);
        const root = createRoot(host);
        root.render(React.createElement(MediaLightbox, { kind: "video", src: `/api/line/${accountId}/media/${chatMid}/${id}?preview=1`,
          onClose: () => { root.unmount(); host.remove(); } }));
      }, { accountId, chatMid, id: sourceMessages[0]!.id });
      const viewer = page.locator("dialog video");
      await expect(viewer).toHaveAttribute("src", /\?preview=0$/);
      await playback(viewer);
      await page.getByRole("button", { name: "閉じる", exact: true }).click();
    } else {
      // Keep the viewer open while a message is updated from image to video.
      // The viewer must switch to a video element instead of image decoding.
      const id = sourceMessages[0]!.id;
      const updateMedia = async (kind: "image" | "video") => page.evaluate(async ({ id, kind, accountId, chatMid }) => {
        const path = performance.getEntriesByType("resource")
          .findLast(entry => new URL(entry.name).pathname === "/src/lib/store.ts")!.name;
        const { useStore } = await import(path);
        const state = useStore.getState();
        if (!state.demoMode || state.accountId !== null) throw new Error("Demo-only fixture");
        useStore.setState({ messages: state.messages.map((message: { id: string }) => message.id === id
          ? { ...message, kind, imageSrc: kind === "image" ? "/demo/chat-photo.svg?preview=1"
            : `/api/line/${accountId}/media/${chatMid}/${id}?preview=1` } : message) });
      }, { id, kind, accountId, chatMid });
      const native = page.frameLocator('iframe[title="Vyline Compose UI"]');
      await updateMedia("image");
      const image = native.getByLabel(`${id}.mp4`, { exact: true });
      await expect(image).toBeVisible();
      const imageBox = await image.boundingBox(); assert(imageBox);
      await page.mouse.click(imageBox.x + imageBox.width / 2, imageBox.y + imageBox.height / 2);
      await expect(native.getByRole("button", { name: "閉じる", exact: true })).toBeAttached();
      await updateMedia("video");
      const viewer = native.locator("video:visible");
      await expect(viewer).toHaveCount(1);
      await playback(viewer);
      await page.screenshot({ path: join(output, `${mode}-viewer.png`) });
    }
    assert.deepEqual(errors, []);
    assert(responses.every(response => response.preview === "0" && response.status < 400));
    results.push({ mode, playback: played, responses, consoleErrors: errors });
    await page.close();
  }
  assert.equal(downloads, 8, "Each uncached sent/received original is decrypted once");
  await writeFile(join(output, "results.json"), JSON.stringify({ downloads, results }, null, 2));
  console.log(JSON.stringify({ modes: results.length, videosPlayed: 8, downloads, lightbox: "passed", output }));
} finally {
  await browser.close();
  clientSpy.mockRestore();
  await chatStore.closeAccountChatDb(accountId);
  await mediaStorage.closeMediaStorage();
  await rm(root, { recursive: true, force: true });
}
