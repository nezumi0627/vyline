/**
 * scripts/sendTestMediaBatch.ts — テスト先への複数画像送信スニペット
 *
 * 使い方:
 *   bun scripts/sendTestMediaBatch.ts [--chat <chatMid>] [--account main] [--n 3]
 *
 * 既定の送信先は AGENTS.md 許可のテストグループのみ。実グループ・実友だちには送らないこと。
 * 生成画像は実行ごとにランダム色の PNG。
 */

import { deflateSync } from "node:zlib";

const APPROVED_TEST_CHATS = new Set([
  "c1efe9d6cf1848350bc91848a8a29963e", // うがうがうー
  "u81c530b68cc2efdd36911d214bd5f084", // ねずBOT
]);

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

/** 単色 PNG を生成する（IDAT は zlib 圧縮が必須） */
function solidPng(r: number, g: number, b: number, size = 64): Buffer {
  const w = size;
  const h = size;
  const stride = 1 + w * 3;
  const raw = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * stride + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const crcTable: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc32 = (buf: Buffer): number => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const account = arg("account", "main");
const chatMid = arg("chat", "");
const count = Math.min(Math.max(Number(arg("n", "3")), 1), 10);

if (!chatMid || !APPROVED_TEST_CHATS.has(chatMid)) {
  console.error(
    `--chat には許可されたテスト先のみ指定できます:\n${[...APPROVED_TEST_CHATS].join("\n")}`,
  );
  process.exit(1);
}

const base = process.env.VYLINE_BACKEND_URL ?? "http://127.0.0.1:3001";
const items = [];
for (let i = 0; i < count; i++) {
  const png = solidPng(
    60 + Math.floor(Math.random() * 180),
    60 + Math.floor(Math.random() * 180),
    60 + Math.floor(Math.random() * 180),
  );
  items.push({
    dataBase64: png.toString("base64"),
    mimeType: "image/png",
    filename: `vyline-test-${Date.now()}-${i}.png`,
    mediaType: "image" as const,
  });
}

const res = await fetch(`${base}/line/${account}/send-media-batch`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ chatMid, items }),
});
const body = await res.text();
console.log(`POST /send-media-batch -> ${res.status}`);
console.log(body);

// 履歴を確認して relation / IMAGE の有無を表示
await new Promise((r) => setTimeout(r, 4000));
const hist = await fetch(
  `${base}/line/${account}/getPreviousMessagesV2WithRequest/${chatMid}?limit=${count + 5}&force=1`,
);
if (!hist.ok) {
  console.error(`GET /getPreviousMessagesV2WithRequest -> ${hist.status}`);
  console.error(await hist.text());
  process.exit(1);
}
const data = (await hist.json()) as {
  messages?: Array<{ id: string; contentType: string; relatedMessageId?: string }>;
};
const recent = (data.messages ?? []).sort((a, b) => Number(b.id) - Number(a.id)).slice(0, count);
for (const m of recent) {
  console.log(`${m.id} ${m.contentType} rel=${m.relatedMessageId ?? "-"}`);
}
