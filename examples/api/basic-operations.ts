/**
 * examples/api/basic-operations.ts — Vyline BFF API の基本操作サンプル
 *
 * 使い方: backend 起動後に
 *   bun examples/api/basic-operations.ts
 */

const BASE = process.env.VYLINE_BACKEND_URL ?? "http://127.0.0.1:3001";
const ACCOUNT = process.env.VYLINE_ACCOUNT ?? "main";

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

async function post<T>(path: string, data?: unknown): Promise<T> {
  return json<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: data ? JSON.stringify(data) : undefined,
  });
}

// 1. プロフィール取得
const { profile } = await json<{ profile: { mid: string; displayName: string } }>(
  `/line/${ACCOUNT}/profile`,
);
console.log("profile:", profile.displayName);

// 2. チャット一覧
const { chats } = await json<{ chats: Array<{ mid: string; name: string }> }>(
  `/line/${ACCOUNT}/chats`,
);
console.log(`chats: ${chats.length}`);

// 3. 直近メッセージ取得（最初のチャット）
if (chats[0]) {
  const { messages } = await json<{ messages: unknown[] }>(
    `/line/${ACCOUNT}/messages/${chats[0].mid}?limit=5`,
  );
  console.log(`latest messages in "${chats[0].name}": ${messages.length}`);
}

// 4. プラグイン一覧
const plugins = await json<{ plugins: Array<{ id: string; enabled: boolean }> }>(
  `/line/${ACCOUNT}/plugins`,
);
console.log(
  "plugins:",
  plugins.plugins.map((p) => `${p.id}(${p.enabled ? "on" : "off"})`).join(", ") || "(none)",
);

// 5. ストレージ使用量
const storage = await json<Record<string, unknown>>(`/line/${ACCOUNT}/vyline/cache`);
console.log("storage:", JSON.stringify(storage).slice(0, 120));

// ── 送信系（実行する場合はコメントを外し、chatMid には許可されたテスト先を指定） ──
// const TEST_CHAT = "c1efe9d6cf1848350bc91848a8a29963e"; // うがうがうー
// await post(`/line/${ACCOUNT}/send`, { chatMid: TEST_CHAT, text: "hello from Vyline API" });
