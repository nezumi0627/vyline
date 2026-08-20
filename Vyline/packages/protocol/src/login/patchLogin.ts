/**
 * Desktop 関数レベル Login パッチ
 *
 * LINE.exe メモリから確定した RPC / パスに合わせる:
 *   QR: createSession → createQrCodeForSecure → checkQrCodeVerified
 *       → qrCodeLoginV2ForSecure(systemName=hostname, modelName=PCモデル)
 *   Email: getRSAKeyInfo(/api/v3/TalkService.do) → loginV2(/api/v3p/rs)
 *          → /LF1 → confirmE2EELogin(/api/v3p/rs) → loginV2
 */

import type { BaseClient } from "@vyline/protocol/stack/base";
import {
  decryptKeyChain,
  generateSharedSecret,
  getSHA256Sum,
  verifyE2EEKeyPair,
  xorHalves,
} from "../e2ee/primitives.js";
import { VylineRequestClient } from "../protocol/requestClient.js";
import type { ThriftField } from "../protocol/thrift.js";
import { getDesktopPcIdentity } from "./pcIdentity.js";
import { DESKTOP_AUTH_RS, DESKTOP_TALK_RSA } from "./patchTransport.js";

type LoginAny = any;

/**
 * getRSAKeyInfo / loginV2 / confirmE2EELogin は元々プロトコルスタックの高レベル
 * TalkService/Login クラスを経由せず、生の thrift フィールド配列を直接
 * 組み立てて `base.request.request()` へ渡している (下記参照)。
 * この3メソッドに限り resultType=false (名前付き型変換なし) で完結するため、
 * ワイヤーエンコード/HTTP 部分を Vyline 自前の VylineRequestClient に
 * 差し替えても互換性が壊れない。loginZ (named type "LoginResult") のみ
 * 元のプロトコルスタック実装にフォールバックする。
 */
function nativeRequest(base: BaseClient): VylineRequestClient {
  const req = base.request as unknown as {
    endpoint: string;
    userAgent: string;
    systemType: string;
  };
  const authToken = (base as unknown as { authToken?: string }).authToken;
  return new VylineRequestClient({
    endpoint: req.endpoint,
    userAgent: req.userAgent,
    systemType: req.systemType,
    ...(authToken !== undefined ? { authToken } : {}),
  });
}

export function patchDesktopLogin(base: BaseClient): void {
  const login = base.loginProcess as LoginAny;
  const pc = getDesktopPcIdentity();

  // ── QR: systemName / modelName を Desktop PC 名に ──
  const origQrSecure = login.qrCodeLoginV2ForSecure.bind(login) as (
    session: string,
    nonce: string,
    modelName?: string,
    systemName?: string,
    autoLoginIsRequired?: boolean,
  ) => Promise<unknown>;

  login.qrCodeLoginV2ForSecure = (
    authSessionId: string,
    nonce: string,
    modelName?: string,
    systemName?: string,
    autoLoginIsRequired = true,
  ) => {
    const model = !modelName || modelName === "evex-device" ? pc.modelName : modelName;
    const system = !systemName || systemName === "vyline-device" ? pc.systemName : systemName;
    base.log("vyline:qr", {
      systemName: system,
      modelName: model,
      method: "qrCodeLoginV2ForSecure",
    });
    return origQrSecure(authSessionId, nonce, model, system, autoLoginIsRequired);
  };

  // 非 ForSecure 経路も同様にガード
  if (typeof login.qrCodeLoginV2 === "function") {
    const origV2 = login.qrCodeLoginV2.bind(login) as (
      session: string,
      modelName?: string,
      systemName?: string,
      autoLoginIsRequired?: boolean,
    ) => Promise<unknown>;
    login.qrCodeLoginV2 = (
      authSessionId: string,
      modelName?: string,
      systemName?: string,
      autoLoginIsRequired = true,
    ) => {
      const model = !modelName || modelName === "evex-device" ? pc.modelName : modelName;
      const system = !systemName || systemName === "vyline-device" ? pc.systemName : systemName;
      return origV2(authSessionId, model, system, autoLoginIsRequired);
    };
  }

  // ── RSA: getRSAKeyInfo は /api/v3/TalkService.do (v4 だと x-lc:400) ──
  // レスポンスは RSAKey struct (1:keynm, 2:nvalue, 3:evalue, 4:keySessionKn) だが
  // 呼び出し元 (Login.requestEmailLoginV2) は文字列を期待するため、
  // 名前付き変換 ("RSAKey") が必要な間は元のプロトコルスタック実装を使う。
  login.getRSAKeyInfo = async (provider = 0) => {
    base.log("vyline:rsa", { path: DESKTOP_TALK_RSA, method: "getRSAKeyInfo" });
    return await base.request.request(
      [[12, 1, [[8, 2, provider]]]],
      "getRSAKeyInfo",
      3,
      "RSAKey",
      DESKTOP_TALK_RSA,
    );
  };

  // ── decodeE2EEKeyV1: keychain 内の全鍵を、各エントリ自身の keyId で保存 ──
  // プロトコルスタック既定は metadata.keyId だけを使い、かつ auth 前 verify が常に true になる。
  const origDecode = base.e2ee.decodeE2EEKeyV1.bind(base.e2ee);
  base.e2ee.decodeE2EEKeyV1 = async (
    data: {
      encryptedKeyChain?: string;
      keyId?: number | string;
      publicKey?: string;
      e2eeVersion?: number | string;
    },
    secret: Buffer,
  ) => {
    if (!data?.encryptedKeyChain) return origDecode(data as never, secret);

    try {
      const encryptedKeyChain = Buffer.from(data.encryptedKeyChain, "base64");
      const serverPub = Buffer.from(data.publicKey ?? "", "base64");
      const keychainData = decryptKeyChain(serverPub, secret, encryptedKeyChain);
      const parsed = base.thrift.readThriftStruct(keychainData) as {
        1?: Array<Record<number, unknown>>;
      };
      const entries = parsed?.[1] ?? [];

      let saved: {
        keyId: number | string;
        privKey: Buffer;
        pubKey: Buffer;
        e2eeVersion: number | string;
      } | null = null;
      let firstEntry: { privKey: Buffer; pubKey: Buffer } | null = null;

      for (const entry of entries) {
        const entryKeyId = entry[2] as number | undefined;
        const entryPub = entry[4] ? Buffer.from(entry[4] as Uint8Array) : null;
        const entryPriv = entry[5] ? Buffer.from(entry[5] as Uint8Array) : null;
        if (entryKeyId == null || !entryPub || !entryPriv) continue;
        if (!firstEntry) firstEntry = { privKey: entryPriv, pubKey: entryPub };
        if (!verifyE2EEKeyPair(entryPriv, entryPub)) continue;

        const payload = {
          keyId: entryKeyId,
          privKey: entryPriv.toString("base64"),
          pubKey: entryPub.toString("base64"),
          e2eeVersion: data.e2eeVersion ?? 1,
        };
        await base.storage.set(`e2eeKeys:${entryKeyId}`, JSON.stringify(payload));
        base.log("vyline:e2ee", {
          phase: "keychain-save",
          keyId: entryKeyId,
          pub: entryPub.toString("base64").slice(0, 24),
        });
        saved = {
          keyId: entryKeyId,
          privKey: entryPriv,
          pubKey: entryPub,
          e2eeVersion: data.e2eeVersion ?? 1,
        };
      }

      // 有効なエントリが1件も取れなければ、先頭鍵を metadata.keyId で保存 (フォールバック)
      if (!saved && firstEntry) {
        const keyId = data.keyId ?? "unknown";
        const payload = {
          keyId,
          privKey: firstEntry.privKey.toString("base64"),
          pubKey: firstEntry.pubKey.toString("base64"),
          e2eeVersion: data.e2eeVersion ?? 1,
        };
        await base.storage.set(`e2eeKeys:${keyId}`, JSON.stringify(payload));
        saved = {
          keyId,
          privKey: firstEntry.privKey,
          pubKey: firstEntry.pubKey,
          e2eeVersion: data.e2eeVersion ?? 1,
        };
      }

      if (!saved) return undefined;
      return {
        keyId: saved.keyId,
        privKey: saved.privKey,
        pubKey: saved.pubKey,
        e2eeVersion: saved.e2eeVersion,
      };
    } catch (err) {
      base.log("vyline:e2ee", {
        phase: "keychain-decode-failed",
        err: err instanceof Error ? err.message : String(err),
      });
      return origDecode(data as never, secret);
    }
  };

  // ── loginV2: /api/v3p/rs + 実 PC モデル名 ──
  login.loginV2 = async (
    keynm: string,
    encryptedMessage: string,
    deviceName: string,
    verifier: string | undefined,
    secret: string | undefined,
    cert: string | undefined,
    methodName: string,
  ) => {
    let loginType = 2;
    if (!secret) loginType = 0;
    if (verifier) loginType = 1;

    base.log("vyline:loginV2", {
      path: DESKTOP_AUTH_RS,
      method: methodName,
      modelName: pc.modelName,
      loginType,
    });

    const fields: ThriftField[] = [
      [
        12,
        2,
        [
          [8, 1, loginType],
          [8, 2, 1],
          [11, 3, keynm],
          [11, 4, encryptedMessage],
          [2, 5, 0],
          [11, 6, ""],
          [11, 7, deviceName],
          [11, 8, cert],
          [11, 9, verifier],
          [11, 10, secret],
          [8, 11, 1],
          [11, 12, pc.modelName],
        ],
      ],
    ];

    // loginZ は名前付き型 "LoginResult" への変換が必要なためプロトコルスタックのまま。
    // それ以外 (loginType 0/1/2 の通常フロー) は生 struct で完結するため自前
    // トランスポートを使う (ensureE2EE.ts / VylineClient.ts 側は既に生の
    // フィールド番号でレスポンスを読んでいる)。
    if (methodName === "loginZ") {
      return await base.request.request(
        fields as never,
        methodName,
        3,
        "LoginResult",
        DESKTOP_AUTH_RS,
      );
    }
    return await nativeRequest(base).request(fields, methodName, 3, false, DESKTOP_AUTH_RS);
  };

  // ── confirmE2EELogin: /api/v3p/rs ──
  login.confirmE2EELogin = async (verifier: string, deviceSecret: string) => {
    base.log("vyline:confirmE2EE", { path: DESKTOP_AUTH_RS });
    return await nativeRequest(base).request(
      [
        [11, 1, verifier],
        [11, 2, deviceSecret],
      ],
      "confirmE2EELogin",
      3,
      false,
      DESKTOP_AUTH_RS,
    );
  };
}
