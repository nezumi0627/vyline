/**
 * examples/api/send-media-batch.ts — 複数画像の一括送信サンプル
 *
 * 使い方:
 *   bun examples/api/send-media-batch.ts <chatMid> <image1.png> <image2.png> ...
 *
 * chatMid は AGENTS.md の許可されたテスト先のみを指定すること。
 */

const BASE = process.env.VYLINE_BACKEND_URL ?? "http://127.0.0.1:3001";
const ACCOUNT = process.env.VYLINE_ACCOUNT ?? "main";

const APPROVED = new Set([
  "c1efe9d6cf1848350bc91848a8a29963e", // うがうがうー
  "u81c530b68cc2efdd36911d214bd5f084", // ねずBOT
  "u7c6ea9ca829a8dd6249015f79e53a703", // ClockAngel（テスト垢）
]);

const [chatMid, ...files] = process.argv.slice(2);
if (!chatMid || !APPROVED.has(chatMid) || files.length === 0) {
  console.error(
    `usage: bun examples/api/send-media-batch.ts <approved chatMid> <img1> <img2>...\napproved: ${[...APPROVED].join(", ")}`,
  );
  process.exit(1);
}

const items = [];
for (const file of files) {
  const bytes = await Bun.file(file).arrayBuffer();
  items.push({
    dataBase64: Buffer.from(bytes).toString("base64"),
    mimeType: file.endsWith(".jpg") || file.endsWith(".jpeg") ? "image/jpeg" : "image/png",
    filename: file.split(/[\\/]/).pop(),
    mediaType: "image" as const,
  });
}

const res = await fetch(`${BASE}/line/${ACCOUNT}/send-media-batch`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ chatMid, items }),
});
console.log(res.status, await res.text());
