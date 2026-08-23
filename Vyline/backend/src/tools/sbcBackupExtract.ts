#!/usr/bin/env bun
/**
 * SBC クラウドバックアップ抽出 CLI（/EKBS4 + /LKBS4）
 *
 * 使い方:
 *   bun run vyline:sbc-extract -- --account main --info
 *   bun run vyline:sbc-extract -- --account main --pin 123456
 *   bun run vyline:sbc-extract -- --account main --password "xxx" --save-keys
 *
 * フロー (docs/analysis/sbc-key-restore.md 参照):
 *   1. getE2EEKeyBackupCertificates → OBS から証明書 PEM 取得
 *   2. getE2EEKeyBackupInfo         → バックアップ存在確認
 *   3. RestoreClaim.createFromPin   → restoreE2EEKeyBackup (/EKBS4)
 *      → claim.Restore(recoveryKey, blobPayload) で E2EE 鍵束復元
 *   4. restoreLifetimeKeyBackupHeader + getLifetimeKeyBackupPayloadDataList (/LKBS4)
 *      → トーク履歴 payload blob の取得
 *
 * 安全性:
 *   - メッセージ送信なし（読み取り系 RPC のみ）
 *   - 誤 PIN はロックアウト (max 10 回) を招くため本ツールはリトライしない
 */

import { parseArgs } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loginWithToken } from "../line/clientManager.js";
import { getToken } from "../storage/tokenStore.js";
import { initVylineProfile } from "../vyline/profileBridge.js";
import { LINEStruct } from "@vyline/protocol/stack/thrift";
import { RestoreClaim, type RestoreClaimV3, createFromPassword } from "@vyline/protocol/sbc";

const _dir = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.VYLINE_DATA_DIR ?? join(_dir, "..", "..", "..", "data");

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    account: { type: "string", default: "main" },
    info: { type: "boolean", default: false },
    pin: { type: "string" },
    password: { type: "string" },
    out: { type: "string" },
    "save-keys": { type: "boolean", default: false },
    "skip-lkbs": { type: "boolean", default: false },
  },
});

/** protocolType=4 の Thrift RPC 汎用呼び出し（extraFeaturesService.ekbsRpc と同型） */
async function backupRpc(
  base: unknown,
  method: string,
  args: unknown,
  path: string,
): Promise<unknown> {
  const structFn = (LINEStruct as unknown as Record<string, (p: unknown) => unknown>)[
    `${method}_args`
  ];
  if (!structFn) throw new Error(`unknown rpc: ${method}`);
  const req = base as {
    request: {
      request(a: unknown, n: string, p: number, flag: boolean, path: string): Promise<unknown>;
    };
  };
  return await req.request.request(structFn(args), method, 4, true, path);
}

function toBuf(v: unknown): Buffer {
  if (v instanceof Uint8Array) return Buffer.from(v);
  if (typeof v === "string") return Buffer.from(v, "utf8");
  return Buffer.alloc(0);
}

function hex(v: unknown, max = 32): string {
  const b = toBuf(v);
  return `${b.subarray(0, max).toString("hex")}${b.length > max ? "…" : ""} (${b.length}B)`;
}

function jsonSafe(v: unknown): string {
  return JSON.stringify(
    v,
    (_, x) => {
      if (x instanceof Uint8Array) return `bin(${hex(x)})`;
      if (typeof x === "bigint") return x.toString();
      return x;
    },
    2,
  );
}

async function downloadCertPem(urlHashList: string[]): Promise<string | null> {
  for (const id of urlHashList) {
    const url = `https://obs.line-scdn.net/${id}`;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const text = await res.text();
      if (text.includes("BEGIN CERTIFICATE")) {
        console.log(`[cert] OK ${url} (${text.length} bytes)`);
        return text;
      }
      console.log(`[cert] not PEM at ${url}`);
    } catch (err) {
      console.log(`[cert] fetch failed for ${url}: ${(err as Error).message}`);
    }
  }
  // フォールバック: バンドル証明書
  const fallback = join(
    _dir,
    "..",
    "..",
    "..",
    "packages",
    "protocol",
    "src",
    "sbc",
    "certs",
    "backup.security.linecorp.com.pem",
  );
  if (existsSync(fallback)) {
    console.log("[cert] using bundled fallback: backup.security.linecorp.com.pem");
    return await readFile(fallback, "utf8");
  }
  return null;
}

interface RestoredKeysLike {
  e2eeKeys: {
    keyID: number;
    e2eeKey: {
      created_time: number;
      version: number;
      encoded_private_key: string;
      encoded_public_key: string;
    };
  }[];
  passcode?: string;
  masterKey?: Uint8Array;
}

async function main(): Promise<void> {
  const accountId = values.account ?? "main";
  const token = await getToken(accountId);
  if (!token?.authToken) throw new Error(`no saved token for account: ${accountId}`);

  console.log(`[login] restoring session: ${accountId} (mid=${token.mid ?? "?"})`);
  await initVylineProfile();
  const client = await loginWithToken(accountId);
  const base = client.base;
  const mid = token.mid || String((base.profile as { mid?: string })?.mid ?? "");
  if (!mid.startsWith("u")) throw new Error(`mid not resolvable: "${mid}"`);

  // ── 1) 証明書 ──
  const certs = (await backupRpc(base, "getE2EEKeyBackupCertificates", {}, "/EKBS4")) as
    | { urlHashList?: string[] }
    | undefined;
  const urlHashList: string[] = certs?.urlHashList ?? [];
  console.log(`[cert] urlHashList: ${JSON.stringify(urlHashList)}`);
  const certPem = await downloadCertPem(urlHashList);
  if (!certPem) throw new Error("no backup certificate available");

  // ── 2) バックアップ情報 ──
  const info = await backupRpc(base, "getE2EEKeyBackupInfo", {}, "/EKBS4");
  console.log(`[info] ${jsonSafe(info)}`);

  if (values.info && !values.pin && !values.password) {
    console.log("[done] info-only run (--pin/--password 未指定のため restore はスキップ)");
    return;
  }

  // ── 3) EKBS4 restore ──
  let keys: RestoredKeysLike | null = null;
  let lkbsClaim: Uint8Array | null = null;

  if (values.pin) {
    const claim = await RestoreClaim.createFromPin(mid, values.pin, certPem);
    lkbsClaim = claim.claim();
    console.log(`[ekbs] restoreE2EEKeyBackup with PIN claim (${lkbsClaim.length}B claim)`);
    const restored = (await backupRpc(
      base,
      "restoreE2EEKeyBackup",
      { request: { restoreClaim: Buffer.from(lkbsClaim) } },
      "/EKBS4",
    )) as { recoveryKey?: unknown; blobPayload?: unknown } | undefined;
    keys = claim.restore(toBuf(restored?.recoveryKey), toBuf(restored?.blobPayload));
  } else if (values.password) {
    const builder = createFromPassword(mid, values.password);
    const claimV3: RestoreClaimV3 = builder.claim(certPem);
    lkbsClaim = claimV3.claim();
    console.log(`[ekbs] restoreE2EEKeyBackup with password(v3) claim (${lkbsClaim.length}B claim)`);
    const restored = (await backupRpc(
      base,
      "restoreE2EEKeyBackup",
      { request: { restoreClaim: Buffer.from(lkbsClaim) } },
      "/EKBS4",
    )) as { recoveryKey?: unknown; blobPayload?: unknown } | undefined;
    const secret = claimV3.restore(toBuf(restored?.recoveryKey), toBuf(restored?.blobPayload));
    console.log(`[ekbs] v3 payloadSecret: type=${secret.type} key=${hex(secret.key)}`);
    console.log("[ekbs] v3 経路は鍵束 JSON 復元に未対応 — LKBS4 probe へ進みます");
  }

  if (keys) {
    console.log(`[keys] e2eeKeys: ${keys.e2eeKeys.length} 本`);
    for (const k of keys.e2eeKeys) {
      console.log(
        `  - keyID=${k.keyID} version=${k.e2eeKey.version} created=${k.e2eeKey.created_time}`,
      );
    }
    console.log(`[keys] passcode: ${keys.passcode ? "あり" : "なし"}`);
    console.log(`[keys] masterKey: ${keys.masterKey ? hex(keys.masterKey) : "なし"}`);

    if (values["save-keys"]) {
      const outDir = values.out ?? join(DATA_DIR, "sbc-extract");
      await mkdir(outDir, { recursive: true });
      const file = join(outDir, `sbc-keys-${Date.now()}.json`);
      await writeFile(
        file,
        JSON.stringify(
          {
            mid,
            savedAt: new Date().toISOString(),
            e2eeKeys: keys.e2eeKeys,
            passcode: keys.passcode,
            masterKey: keys.masterKey ? Buffer.from(keys.masterKey).toString("base64") : undefined,
          },
          null,
          2,
        ),
      );
      console.log(`[keys] saved → ${file}`);
    }
  }

  // ── 4) LKBS4（トーク履歴本体） ──
  if (values["skip-lkbs"]) {
    console.log("[done] (--skip-lkbs)");
    return;
  }
  try {
    if (lkbsClaim) {
      const hdr = (await backupRpc(
        base,
        "restoreLifetimeKeyBackupHeader",
        { request: { restoreClaim: Buffer.from(lkbsClaim) } },
        "/LKBS4",
      )) as { recoveryKey?: unknown } | undefined;
      console.log(`[lkbs] header restored: recoveryKey=${hex(hdr?.recoveryKey)}`);
    }

    const payloads = (await backupRpc(
      base,
      "getLifetimeKeyBackupPayloadDataList",
      { request: { metadataList: [] } },
      "/LKBS4",
    )) as
      | {
          payloadDataList?: { metadata?: unknown; blobPayload?: unknown }[];
          failedPayloads?: unknown[];
        }
      | undefined;
    const list = payloads?.payloadDataList ?? [];
    const failed = payloads?.failedPayloads ?? [];
    console.log(`[lkbs] payloads: ${list.length} 件 (failed: ${failed.length})`);
    for (const f of failed) console.log(`  [failed] ${jsonSafe(f)}`);

    if (list.length > 0) {
      const outDir = values.out ?? join(DATA_DIR, "sbc-extract", `lkbs-${Date.now()}`);
      await mkdir(outDir, { recursive: true });
      const meta: unknown[] = [];
      let i = 0;
      for (const p of list) {
        const m = p.metadata as
          | { e2ee?: { e2EEPublicKeyId?: number | bigint }; singleValue?: { type?: unknown } }
          | undefined;
        const kid = m?.e2ee?.e2EEPublicKeyId ?? null;
        const sv = m?.singleValue?.type ?? null;
        const blob = toBuf(p.blobPayload);
        console.log(`  [payload ${i}] keyId=${kid} singleValue=${String(sv)} blob=${blob.length}B`);
        meta.push({ index: i, keyId: kid, singleValue: sv, size: blob.length });
        await writeFile(join(outDir, `payload-${String(i).padStart(3, "0")}.bin`), blob);
        i++;
      }
      await writeFile(join(outDir, "meta.json"), JSON.stringify(meta, null, 2));
      console.log(`[lkbs] saved → ${outDir}`);
    }
  } catch (err) {
    console.error(`[lkbs] error: ${(err as Error).message}`);
  }

  console.log("[done]");
}

main()
  .then(() => {
    // ops loop 等のバックグラウンドタイマーで bun が終了しないため明示 exit
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
