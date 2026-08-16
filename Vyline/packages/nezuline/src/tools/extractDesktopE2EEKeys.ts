/**
 * 稼働中 LINE.exe メモリから E2EE 自己鍵を抽出する。
 *
 * Desktop は keychain を JSON 風に保持する:
 *   {"keyId":N,"publicKey":{"_hs_...":"<b64>"},"privateKey":{"_hs_...":"<b64>"},...}
 *
 * 手順:
 * 1. "privateKey" ASCII をメモリ走査し近傍を dump
 * 2. keyId / publicKey / privateKey をパース
 * 3. Curve25519 でペア検証 → desktop-e2ee-keys.json に保存
 *
 * 実行: bun Vyline/packages/nezuline/src/tools/extractDesktopE2EEKeys.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { generateKeyPair } from "curve25519-js";
import { loginWithToken } from "../client/NezuClient.js";
import { loadCachedOrFallback } from "../desktop/persist.js";
import type { DesktopE2EEKey, DesktopE2EEKeyDump } from "../login/importDesktopE2EE.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const DATA = join(REPO, "Vyline", "backend", "data");
const OUT = join(DATA, "desktop-e2ee-keys.json");
const RAW_OUT = join(DATA, "e2ee-selfchain-raw.txt");

function verifyPair(privB64: string, pubB64: string): boolean {
  try {
    const derived = Buffer.from(
      generateKeyPair(Uint8Array.from(Buffer.from(privB64, "base64"))).public,
    );
    return derived.equals(Buffer.from(pubB64, "base64"));
  } catch {
    return false;
  }
}

/** PowerShell: "privateKey" ヒット近傍の ASCII 窓を dump */
function dumpPrivateKeyWindows(): string {
  const ps1 = join(dirname(fileURLToPath(import.meta.url)), "scanLinePrivateKeyWindows.ps1");
  const r = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1, "-OutFile", RAW_OUT],
    { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024, timeout: 180_000 },
  );
  if (r.error) throw r.error;
  if (r.status !== 0) {
    throw new Error(`scan failed: ${r.stderr || r.stdout}`);
  }
  if (!existsSync(RAW_OUT)) return "";
  return readFileSync(RAW_OUT, "utf8");
}

function parseKeys(raw: string): Map<number, DesktopE2EEKey> {
  const flat = raw.replace(/\r?\n/g, "");
  const byId = new Map<number, DesktopE2EEKey>();
  const keyIdRe = /"keyId"\s*:\s*(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = keyIdRe.exec(flat))) {
    const keyId = Number(m[1]);
    if (!Number.isFinite(keyId) || keyId < 1000) continue;
    if (byId.has(keyId)) continue;
    const start = Math.max(0, m.index - 20);
    const end = Math.min(flat.length, m.index + 420);
    const window = flat.slice(start, end);
    const privM =
      /"privateKey"\s*:\s*\{"_hs_[0-9a-f]+"\s*:\s*"([A-Za-z0-9+/=]+)"\}/.exec(window);
    const pubM =
      /"publicKey"\s*:\s*\{"_hs_[0-9a-f]+"\s*:\s*"([A-Za-z0-9+/=]+)"\}/.exec(window);
    if (!privM || !pubM) continue;
    byId.set(keyId, {
      keyId,
      privKey: privM[1]!,
      pubKey: pubM[1]!,
      e2eeVersion: 1,
    });
  }
  return byId;
}

async function main(): Promise<void> {
  const tokensPath = join(DATA, "tokens.json");
  if (!existsSync(tokensPath)) throw new Error(`missing ${tokensPath}`);
  const tokens = JSON.parse(readFileSync(tokensPath, "utf8")) as {
    main?: { authToken: string };
  };
  if (!tokens.main?.authToken) throw new Error("no main authToken");

  console.log("[extract] scanning LINE.exe for privateKey windows...");
  const raw = dumpPrivateKeyWindows();
  if (!raw || raw.includes("NO_PROCESS") || raw.includes("OPENFAIL")) {
    throw new Error("LINE.exe not readable — open official LINE Desktop and retry");
  }

  const byId = parseKeys(raw);
  console.log(
    `[extract] parsed ${byId.size} candidate keys:`,
    [...byId.keys()].sort((a, b) => a - b).join(","),
  );

  const profile = loadCachedOrFallback(join(DATA, "nezuline"));
  const client = await loginWithToken(tokens.main.authToken, {
    profile,
    storagePath: join(DATA, "storage-main.json"),
  });
  await client.base.talk.getProfile();
  const mid = client.base.profile?.mid;
  if (!mid) throw new Error("no profile mid");

  const serverKeys = await client.base.talk.getE2EEPublicKeys();
  const serverById = new Map<number, Buffer>();
  for (const k of serverKeys) {
    const raw = k as unknown as {
      keyId?: number;
      keyData?: Uint8Array;
      2?: number;
      4?: Uint8Array;
    };
    const keyId = Number(raw.keyId ?? raw[2]);
    const keyData = raw.keyData ?? raw[4];
    if (Number.isFinite(keyId) && keyData) serverById.set(keyId, Buffer.from(keyData));
  }

  const good: DesktopE2EEKey[] = [];
  for (const k of byId.values()) {
    if (!verifyPair(k.privKey, k.pubKey)) {
      console.log(`[extract] skip bad pair keyId=${k.keyId}`);
      continue;
    }
    const sp = serverById.get(Number(k.keyId));
    if (sp && !verifyPair(k.privKey, sp.toString("base64"))) {
      console.log(`[extract] skip server mismatch keyId=${k.keyId}`);
      continue;
    }
    if (sp) k.pubKey = sp.toString("base64");
    good.push(k);
    console.log(`[extract] recovered keyId=${k.keyId}`);
  }
  good.sort((a, b) => Number(a.keyId) - Number(b.keyId));

  const dump: DesktopE2EEKeyDump = {
    mid,
    extractedAt: new Date().toISOString(),
    keys: good,
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(dump, null, 2), "utf8");
  console.log(`[extract] wrote ${dump.keys.length} keys -> ${OUT}`);
  console.log(
    `[extract] has 5953546: ${good.some((k) => k.keyId === 5953546)} | latest=${good.at(-1)?.keyId}`,
  );
  const missing = [...serverById.keys()]
    .filter((id) => !good.some((k) => k.keyId === id))
    .sort((a, b) => b - a);
  if (missing.length) {
    console.log(`[extract] still missing vs server: ${missing.join(",")}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
