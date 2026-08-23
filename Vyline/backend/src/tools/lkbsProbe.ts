/**
 * LKBS4 状態プローブ（読み取り系のみ・送信なし）
 * - restoreLifetimeKeyBackupHeader(新鮮なclaim)
 * - getLifetimeKeyBackupPayloadDataList(metadataList: [])
 * - validateLifetimeKeyBackup(masterKeyTimestamp: 0)
 */
import { initVylineProfile } from "../vyline/profileBridge.js";
import { loginWithToken } from "../line/clientManager.js";
import { RestoreClaim } from "@vyline/protocol/sbc";
import { LINEStruct } from "@vyline/protocol/stack/thrift";

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
      request(a: unknown, n: string, p: number, f: boolean, path: string): Promise<unknown>;
    };
  };
  return await req.request.request(structFn(args), method, 4, true, path);
}

const accountId = process.argv[2] ?? "main";
const pin = process.argv[3] ?? "";
await initVylineProfile();
const client = await loginWithToken(accountId);
const base = client.base;
const mid = client.base.profile?.mid ?? "";

// 証明書取得
const certs = (await backupRpc(base, "getE2EEKeyBackupCertificates", {}, "/EKBS4")) as {
  urlHashList?: string[];
};
const certId = certs?.urlHashList?.[0];
let certPem: string;
if (certId) {
  const res = await fetch(`https://obs.line-scdn.net/${certId}`);
  certPem = await res.text();
} else {
  certPem = await Bun.file(
    "Vyline/packages/protocol/src/sbc/certs/backup.security.linecorp.com.pem",
  ).text();
}
console.log("[probe] cert ready");

const claim = await RestoreClaim.createFromPin(mid, pin, certPem);
const claimBuf = Buffer.from(claim.claim());

async function tryCall(label: string, method: string, args: unknown) {
  try {
    const r = await backupRpc(base, method, args, "/LKBS4");
    console.log(`[probe] ${label}: OK`, JSON.stringify(r)?.slice(0, 300));
  } catch (err) {
    console.log(`[probe] ${label}: ${(err as Error).message.slice(0, 200)}`);
  }
}

await tryCall("restoreLifetimeKeyBackupHeader", "restoreLifetimeKeyBackupHeader", {
  request: { restoreClaim: claimBuf },
});
await tryCall("getLifetimeKeyBackupPayloadDataList", "getLifetimeKeyBackupPayloadDataList", {
  request: { metadataList: [] },
});
await tryCall("validateLifetimeKeyBackup", "validateLifetimeKeyBackup", {
  request: { masterKeyTimestamp: 0 },
});
process.exit(0);
