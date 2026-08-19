/**
 * api/debug.ts
 *
 * 開発時のみ有効なデバッグエンドポイント
 *
 * GET /debug/tokens   — 保存済みトークン一覧 (authToken は伏せる)
 * GET /debug/accounts — アクティブアカウント一覧
 * GET /debug/health   — ヘルスチェック
 */

import { Hono } from "hono";
import { detectInstalledDesktop, ensureValidE2EEIdentity } from "@vyline/protocol";
import { childLogger } from "../logger.js";
import { loadTokens } from "../storage/tokenStore.js";
import { listAccounts, getClient } from "../line/clientManager.js";
import {
  getVylineProfile,
  getVylineUpdater,
  refreshVylineProfile,
} from "../vyline/profileBridge.js";

const log = childLogger("api:debug");
export const debugRouter = new Hono();

debugRouter.get("/health", (c) => {
  return c.json({ ok: true, uptime: process.uptime() });
});

/**
 * POST /debug/e2ee/repair/:accountId
 * Desktop 抽出鍵の取り込み + 自己 E2EE 鍵とサーバ登録鍵の整合。
 */
debugRouter.post("/e2ee/repair/:accountId", async (c) => {
  const accountId = c.req.param("accountId");
  const client = getClient(accountId);
  if (!client) return c.json({ ok: false, error: "not logged in" }, 401);
  const force = c.req.query("force") === "1" || c.req.query("force") === "true";
  try {
    const status = await ensureValidE2EEIdentity(client, {
      forceNewSenderKey: force,
    });
    log.info({ accountId, force, ...status }, "E2EE identity repair");
    return c.json({ ...status });
  } catch (err) {
    log.error({ accountId, err }, "E2EE identity repair failed");
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

/**
 * GET /debug/e2ee/status/:accountId
 * ローカルに持つ自己鍵 keyId とサーバ鍵の一覧。
 */
debugRouter.get("/e2ee/status/:accountId", async (c) => {
  const accountId = c.req.param("accountId");
  const client = getClient(accountId);
  if (!client) return c.json({ ok: false, error: "not logged in" }, 401);
  try {
    await client.base.talk.getProfile();
    const mid = client.base.profile?.mid;
    const serverKeys = await client.base.talk.getE2EEPublicKeys();
    const local: Array<{ keyId: number; match: boolean }> = [];
    for (const sk of serverKeys) {
      const keyId = Number(sk.keyId ?? (sk as { 2?: number })[2]);
      const pub = sk.keyData ?? (sk as { 4?: string | Uint8Array })[4];
      const serverPub =
        pub == null
          ? Buffer.alloc(0)
          : typeof pub === "string"
            ? Buffer.from(pub)
            : Buffer.from(pub);
      const raw = await client.base.storage.get(`e2eeKeys:${keyId}`);
      let match = false;
      if (raw && typeof raw === "string") {
        try {
          const localKey = JSON.parse(raw) as { privKey: string };
          match = client.base.e2ee.verifyE2EEKeyPair(
            Buffer.from(localKey.privKey, "base64"),
            serverPub,
          );
        } catch {
          match = false;
        }
      }
      local.push({ keyId, match });
    }
    return c.json({
      ok: true,
      mid,
      serverKeyIds: serverKeys.map((k) => Number(k.keyId ?? (k as { 2?: number })[2])),
      serverLatestKeyId:
        serverKeys.length > 0
          ? Math.max(...serverKeys.map((k) => Number(k.keyId ?? (k as { 2?: number })[2])))
          : null,
      local,
      midKey: mid
        ? await (async () => {
            const raw = await client.base.storage.get(`e2eeKeys:${mid}`);
            if (!raw || typeof raw !== "string") return null;
            try {
              const k = JSON.parse(raw) as { keyId: number };
              return { keyId: k.keyId };
            } catch {
              return null;
            }
          })()
        : null,
    });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

debugRouter.get("/tokens", async (c) => {
  const tokens = await loadTokens();
  // authToken の値は伏せる
  const safe = Object.fromEntries(
    Object.entries(tokens).map(([id, entry]) => [
      id,
      {
        authToken: `${entry.authToken.slice(0, 8)}...`,
        storageFile: entry.storageFile,
        savedAt: entry.savedAt,
      },
    ]),
  );
  log.debug("debug/tokens requested");
  return c.json({ ok: true, tokens: safe });
});

debugRouter.get("/accounts", (c) => {
  const active = listAccounts();
  return c.json({ ok: true, active });
});

/**
 * GET /debug/decrypt-test/:accountId/:chatMid?limit=50
 *
 * E2EE 復号テスト。
 * - 直近メッセージを取得
 * - 各メッセージで decryptE2EEMessage を試行
 * - 失敗しても継続し、統計とサンプルを返す
 */
debugRouter.get("/decrypt-test/:accountId/:chatMid", async (c) => {
  const accountId = c.req.param("accountId");
  const chatMid = c.req.param("chatMid");
  const client = getClient(accountId);
  if (!client) return c.json({ ok: false, error: "not logged in" }, 401);

  const limitParam = Number(c.req.query("limit") ?? "50");
  const limit = Math.min(Math.max(1, limitParam), 200);

  try {
    const boxes = await client.base.talk.getMessageBoxes({
      messageBoxListRequest: {},
    });
    const box = boxes.messageBoxes.find((b) => b.id === chatMid);
    if (!box) {
      return c.json({
        ok: true,
        accountId,
        chatMid,
        limit,
        error: "message box not found",
        stats: { total: 0, e2ee: 0, decrypted: 0, failed: 0, plain: 0 },
        samples: [],
      });
    }

    const rawMessages = await client.base.talk.getPreviousMessagesV2WithRequest({
      request: {
        messageBoxId: box.id,
        endMessageId: box.lastDeliveredMessageId,
        messagesCount: limit,
      },
    });

    try {
      await ensureValidE2EEIdentity(client);
    } catch {
      /* ignore */
    }
    try {
      const { prepareGroupKeysForMessages, ensureGroupKeyById, groupKeyIdFromMessage } =
        await import("@vyline/protocol");
      await prepareGroupKeysForMessages(client, chatMid, rawMessages as unknown[]);
      for (const msg of rawMessages) {
        const gk = groupKeyIdFromMessage(msg);
        if (gk != null) {
          await ensureGroupKeyById(client, chatMid, gk).catch(() => undefined);
        }
      }
    } catch (err) {
      log.warn({ err }, "decrypt-test group key prepare failed");
    }

    let e2ee = 0;
    let decrypted = 0;
    let failed = 0;
    let plain = 0;

    const samples: Array<{
      id: string;
      contentType: string;
      e2ee: boolean;
      decryptOk: boolean;
      textPreview: string | null;
      error?: string;
    }> = [];

    for (const msg of rawMessages) {
      const isE2EE = Boolean(msg.contentMetadata?.e2eeVersion);
      const senderKeyId = msg.chunks?.[3]
        ? Buffer.from(typeof msg.chunks[3] === "string" ? msg.chunks[3] : msg.chunks[3]).reduce(
            (acc, b) => acc * 256 + b,
            0,
          )
        : null;
      const receiverKeyId = msg.chunks?.[4]
        ? Buffer.from(typeof msg.chunks[4] === "string" ? msg.chunks[4] : msg.chunks[4]).reduce(
            (acc, b) => acc * 256 + b,
            0,
          )
        : null;
      let decryptOk = true;
      let current = msg;
      let decryptError: string | undefined;

      if (isE2EE) {
        e2ee += 1;
        try {
          msg.contentMetadata = msg.contentMetadata ?? {};
          if (!msg.chunks) throw new Error("missing chunks for e2ee message");
          current = await client.base.e2ee.decryptE2EEMessage(msg);
          decrypted += 1;
        } catch (err) {
          decryptOk = false;
          failed += 1;
          decryptError = err instanceof Error ? err.message : String(err);
        }
      } else {
        plain += 1;
      }

      if (samples.length < 30) {
        const sample: {
          id: string;
          contentType: string;
          e2ee: boolean;
          senderKeyId: number | null;
          receiverKeyId: number | null;
          decryptOk: boolean;
          textPreview: string | null;
          error?: string;
        } = {
          id: String(msg.id),
          contentType: String(msg.contentType),
          e2ee: isE2EE,
          senderKeyId,
          receiverKeyId,
          decryptOk,
          textPreview: current.text ? current.text.slice(0, 80) : null,
        };
        if (decryptError) {
          sample.error = decryptError;
        }
        samples.push({
          ...sample,
        });
      }
    }

    const result = {
      ok: true,
      accountId,
      chatMid,
      limit,
      stats: {
        total: rawMessages.length,
        e2ee,
        decrypted,
        failed,
        plain,
      },
      samples,
    };

    log.info({ accountId, chatMid, stats: result.stats }, "decrypt test completed");
    return c.json(result);
  } catch (err) {
    log.error({ accountId, chatMid, err }, "decrypt test failed");
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

/**
 * GET  /debug/vyline/profile  — 現在の Desktop プロファイル
 * POST /debug/vyline/refresh  — LINE Desktop から強制再抽出
 */
debugRouter.get("/vyline/profile", (c) => {
  try {
    const profile = getVylineProfile();
    return c.json({ ok: true, profile });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

debugRouter.get("/vyline/status", (c) => {
  try {
    const profile = getVylineProfile();
    const installed = detectInstalledDesktop();
    return c.json({
      ok: true,
      profileVersion: profile.identity.appVersion,
      installedVersion: installed?.version ?? null,
      method: profile.source.detectionMethod,
      userAgent: profile.identity.userAgent,
      xLineApplication: profile.identity.xLineApplication,
      exePath: installed?.exePath ?? profile.source.exePath,
      updaterReady: Boolean(getVylineUpdater()),
    });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

debugRouter.post("/vyline/refresh", async (c) => {
  try {
    const profile = await refreshVylineProfile();
    log.info({ appVersion: profile.identity.appVersion }, "Vyline profile refreshed via debug");
    return c.json({ ok: true, profile });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

/** GET /debug/read-ranges/:accountId/:chatMid — getMessageReadRange 生レスポンス確認 */
debugRouter.get("/read-ranges/:accountId/:chatMid", async (c) => {
  const accountId = c.req.param("accountId");
  const chatMid = c.req.param("chatMid");
  const client = getClient(accountId);
  if (!client) return c.json({ ok: false, error: "not logged in" }, 401);
  try {
    const myMid = client.base.profile?.mid ?? "";
    const raw = await client.base.talk.getMessageReadRange({ chatIds: [chatMid] });
    const { fetchReadRanges, memberReadWatermarks, peerReadUpToMessageId } = await import(
      "../service/lineService.js"
    );
    const normalized = await fetchReadRanges(accountId, chatMid);
    const jsonSafe = (v: unknown) =>
      JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));
    return c.json({
      ok: true,
      myMid,
      raw: jsonSafe(raw),
      normalized: jsonSafe(normalized),
      peerUpTo: myMid ? peerReadUpToMessageId(normalized, chatMid, myMid) : null,
      watermarks: myMid
        ? memberReadWatermarks(normalized, chatMid, myMid).map((w) => ({
            mid: w.mid,
            upTo: w.upTo.toString(),
          }))
        : [],
    });
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});
