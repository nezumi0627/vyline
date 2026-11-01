/**
 * scripts/apiSmokeTest.ts — BFF API の全エンドポイント smoke test
 *
 * 使い方: backend を起動してから
 *   bun run test:api [--account main]
 *
 * 送信系は AGENTS.md の許可されたテスト先のみ使用する。
 */

const BASE = process.env.VYLINE_BACKEND_URL ?? "http://127.0.0.1:3001";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail?: string): void {
  if (ok) {
    pass++;
    console.log(`  ok  ${name}`);
  } else {
    fail++;
    const d = detail ? ` — ${detail}` : "";
    console.log(`FAIL  ${name}${d}`);
    failures.push(`${name}${d}`);
  }
}

async function json(path: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE}${path}`, init);
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

async function post(path: string, data: unknown): Promise<{ status: number; body: unknown }> {
  return json(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });
}

// テスト先（AGENTS.md 許可）
const TEST_GROUP = "c1efe9d6cf1848350bc91848a8a29963e";
const account = arg("account", "main");

console.log(`== Vyline API smoke test (${BASE}, account=${account}) ==\n`);

// ── infra ──
{
  const r = await fetch(`${BASE}/healthz`);
  check("GET /healthz", r.ok);
}
{
  const { status, body } = await json("/api/v1/status");
  const b = body as { ok?: boolean; uptimeSec?: number };
  check("GET /api/v1/status", status === 200 && b.ok === true);
}
{
  const r = await fetch(`${BASE}/metrics`);
  const text = await r.text();
  check(
    "GET /metrics",
    r.ok && text.includes("vyline_requests_total") && text.includes("vyline_memory_rss_bytes"),
  );
}
{
  const r = await fetch(`${BASE}/docs`);
  const html = await r.text();
  check("GET /docs (swagger ui)", r.ok && html.includes("SwaggerUIBundle"));
}
{
  const r = await fetch(`${BASE}/swagger`);
  check("GET /swagger", r.ok);
}
{
  const { status, body } = await json("/openapi.json");
  const b = body as { openapi?: string; paths?: Record<string, unknown> };
  check(
    "GET /openapi.json",
    status === 200 && b.openapi === "3.1.0" && Object.keys(b.paths ?? {}).length >= 15,
    `paths=${Object.keys(b.paths ?? {}).length}`,
  );
}
{
  const r = await fetch(`${BASE}/openapi.yaml`);
  check("GET /openapi.yaml", r.ok && (await r.text()).includes("openapi:"));
}

// ── session / chats ──
let profileMid = "";
{
  const { status, body } = await json(`/line/${account}/getProfile`);
  const b = body as { profile?: { mid?: string; displayName?: string } };
  profileMid = b.profile?.mid ?? "";
  check("GET /line/:accountId/getProfile", status === 200 && Boolean(profileMid));
}
{
  const { status, body } = await json("/auth/accounts");
  const b = body as { ok?: boolean };
  check("GET /auth/accounts", status === 200 && b.ok === true);
}
{
  const { status, body } = await json(`/line/${account}/bootstrap`);
  const b = body as { chats?: unknown[] };
  check("GET /line/:accountId/bootstrap", status === 200 && Array.isArray(b.chats));
}
{
  const { status, body } = await json(`/line/${account}/getMessageBoxes`);
  const b = body as { chats?: unknown[] };
  check("GET /line/:accountId/getMessageBoxes", status === 200 && Array.isArray(b.chats));
}
{
  const { status, body } = await json(
    `/line/${account}/getPreviousMessagesV2WithRequest/${TEST_GROUP}?limit=10&force=1`,
  );
  const b = body as { messages?: unknown[] };
  check("GET /getPreviousMessagesV2WithRequest (force)", status === 200 && Array.isArray(b.messages));
}
{
  const { status } = await json(
    `/line/${account}/getPreviousMessagesV2WithRequest/${TEST_GROUP}?limit=5&local=1`,
  );
  check("GET /getPreviousMessagesV2WithRequest (local)", status === 200);
}

// ── validation errors ──
{
  const { status } = await post(`/line/${account}/sendMessage`, {});
  check("POST /sendMessage without body -> 400", status === 400);
}
{
  const { status } = await post(`/line/${account}/send-media-batch`, {});
  check("POST /send-media-batch empty -> 400", status === 400);
}
{
  const { status, body } = await post(`/line/${account}/send-media-batch`, {
    chatMid: TEST_GROUP,
    items: [{ mimeType: "image/png" }],
  });
  const b = body as { error?: string };
  check(
    "POST /send-media-batch item w/o dataBase64 -> 400",
    status === 400,
    `got ${status} ${b.error ?? ""}`,
  );
}
{
  // 存在しないプラグインの enable -> 404
  const { status } = await post(`/line/${account}/plugins/definitely-not-a-plugin/enable`, {});
  check("POST plugins unknown -> 404", status === 404);
}

// ── plugins ──
{
  const { status, body } = await json(`/line/${account}/plugins`);
  const b = body as { plugins?: unknown[] };
  check("GET /line/:accountId/plugins", status === 200 && Array.isArray(b.plugins));
}

// ── storage / misc ──
{
  const { status } = await json(`/line/${account}/vyline/cache`);
  check("GET /vyline/cache", status === 200 || status === 404);
}
{
  const { status } = await json(`/line/${account}/feature-locks`);
  check("GET /feature-locks", status === 200 || status === 404);
}
{
  const { status } = await fetch(
    `${BASE}/line/${account}/media/${TEST_GROUP}/000000000000000000?preview=0`,
  ).then(async (r) => ({ status: r.status }));
  // 実在しないメディアは 4xx（422/404）になるのが正
  check("GET media unknown id -> 4xx", status >= 400 && status < 500, `got ${status}`);
}

// ── notes (read-only; #54 未マージ環境では skip) ──
if (profileMid) {
  const res = await fetch(`${BASE}/line/${account}/notes?homeId=${profileMid}`);
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("text/html") || !res.ok) {
    console.log(`SKIP  GET /notes (route not present: ${res.status})`);
  } else {
    const body = (await res.json()) as { code?: number };
    if (body.code === 403) {
      console.log("SKIP  GET /notes (account has no Note permission)");
    } else {
      check("GET /notes (own home)", body.code === 0, JSON.stringify(body).slice(0, 80));
    }
  }
}

// ── send to approved test target only ──
if (process.env.API_TEST_SEND !== "1") {
  console.log("\n(skip actual sends — set API_TEST_SEND=1 to include them)");
} else {
  const png1x1 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const { status, body } = await post(`/line/${account}/send-media-batch`, {
    chatMid: TEST_GROUP,
    items: [
      { dataBase64: png1x1, mimeType: "image/png", filename: "smoke1.png", mediaType: "image" },
      { dataBase64: png1x1, mimeType: "image/png", filename: "smoke2.png", mediaType: "image" },
    ],
  });
  const b = body as { count?: number };
  check(
    "POST /send-media-batch (2 images to test group)",
    status === 200 && b.count === 2,
    `got ${status} count=${b.count}`,
  );
}

console.log(`\n== result: ${pass} pass, ${fail} fail ==`);
for (const f of failures) console.log(`  FAIL: ${f}`);
process.exit(fail > 0 ? 1 : 0);
