/**
 * clientManager.ts
 *
 * Vyline クライアントのライフサイクル管理。
 * LINE Desktop 互換 identity は VylineUpdater が供給する。
 */

import {
  loginWithEmail as vylineLoginEmail,
  loginWithQR as vylineLoginQR,
  loginWithToken as vylineLoginToken,
  resolveDeviceMode,
  kicksOfficialDesktop,
  patchGroupKeyLookup,
  type VylineClient,
} from "@vyline/protocol";
import { childLogger } from "../logger.js";
import {
  saveToken,
  getToken,
  loadTokens,
  deleteToken,
  updateSessionMeta,
} from "../storage/tokenStore.js";
import { getVylineProfile } from "../vyline/profileBridge.js";
import {
  attachTalkPushBridge,
  detachTalkPushBridge,
  warmLineCache,
} from "../service/lineService.js";

const log = childLogger("clientManager");

function deviceLogFields() {
  const device = resolveDeviceMode();
  return {
    device,
    kicksOfficialDesktop: kicksOfficialDesktop(device),
  };
}

interface ManagedClient {
  client: VylineClient;
  accountId: string;
  qrUrl: string | null;
  qrExpired: boolean;
  pincode: string | null;
  loggedInAt: number | null;
}

type TalkListenState = {
  abort: AbortController;
  mounted: boolean;
};

const clients = new Map<string, ManagedClient>();
const talkListenByAccount = new Map<string, TalkListenState>();

function mountTalkListen(client: VylineClient, accountId: string): void {
  const abort = new AbortController();
  talkListenByAccount.set(accountId, { abort, mounted: true });
  client.listen({ talk: true, square: false, signal: abort.signal });
}

/** バックグラウンド RPC 用（poll / 既読）。送信はキューに入れない */
const talkRpcBackground = new Map<string, Promise<unknown>>();
/** 履歴取得の直列化（Desktop 準拠: push は維持したまま /S4 RPC を実行） */
const talkFetchGate = new Map<string, { chain: Promise<unknown>; depth: number }>();

export function enqueueTalkRpcBackground<T>(accountId: string, work: () => Promise<T>): Promise<T> {
  const prev = talkRpcBackground.get(accountId) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(work);
  talkRpcBackground.set(accountId, next);
  return next.finally(() => {
    if (talkRpcBackground.get(accountId) === next) talkRpcBackground.delete(accountId);
  });
}

/** @deprecated 送信などユーザー操作には使わない */
export function enqueueTalkRpc<T>(accountId: string, work: () => Promise<T>): Promise<T> {
  return enqueueTalkRpcBackground(accountId, work);
}

/** 送信など — Desktop 同様 Push を維持したまま即実行 */
export function runTalkRpcImmediate<T>(accountId: string, work: () => Promise<T>): Promise<T> {
  void accountId;
  return work();
}

/**
 * 送信の直列化。連続送信で共有 H2 セッション上に同時リクエストが乗り
 * 1 通目が ECONNRESET で落ちる問題を防ぐ（Desktop も送信は直列化する）。
 * 固まった送信が「送信中…」のまま残らないよう 15s で打ち切る。
 */
const sendQueue = new Map<string, Promise<unknown>>();
const SEND_TIMEOUT_MS = 15_000;

function withSendTimeout<T>(p: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`send timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

export function runSendRpc<T>(
  accountId: string,
  work: () => Promise<T>,
  opts?: { timeoutMs?: number },
): Promise<T> {
  const timeoutMs = opts?.timeoutMs ?? SEND_TIMEOUT_MS;
  const prev = sendQueue.get(accountId) ?? Promise.resolve();
  // キューは「タイムアウト race」ではなく work そのもので保持する。
  // タイムアウトで reject されても work は H2 セッションを使い続けるため、
  // 次の送信が並行すると ECONNRESET 等で連続失敗するのを防ぐ。
  const started = prev.catch(() => undefined).then(() => work());
  sendQueue.set(accountId, started);
  const raced = Promise.race([
    started,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`send timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
  return raced.finally(() => {
    if (sendQueue.get(accountId) === started) sendQueue.delete(accountId);
  });
}

/**
 * 履歴取得 — 同時呼び出しを直列化する（Desktop 準拠: Push は中断しない）。
 */
export function runTalkFetchUrgent<T>(accountId: string, work: () => Promise<T>): Promise<T> {
  const gate = talkFetchGate.get(accountId) ?? { chain: Promise.resolve(), depth: 0 };
  talkFetchGate.set(accountId, gate);

  const run = async (): Promise<T> => {
    gate.depth += 1;
    try {
      return await work();
    } finally {
      gate.depth -= 1;
      if (gate.depth === 0 && talkFetchGate.get(accountId) === gate) {
        talkFetchGate.delete(accountId);
      }
    }
  };

  const next = gate.chain.catch(() => undefined).then(run);
  gate.chain = next;
  return next;
}

/** @deprecated 送信には runTalkRpcImmediate、取得には runTalkFetchUrgent */
export function runTalkRpcUrgent<T>(accountId: string, work: () => Promise<T>): Promise<T> {
  return runTalkFetchUrgent(accountId, work);
}

/** @deprecated */
export async function withTalkChannelIdle<T>(
  accountId: string,
  work: () => Promise<T>,
): Promise<T> {
  return enqueueTalkRpcBackground(accountId, work);
}

import { dirname, join as pathJoin } from "node:path";
import { fileURLToPath } from "node:url";

const _dir = dirname(fileURLToPath(import.meta.url));

function storagePathFor(accountId: string): string {
  const dataDir = process.env["VYLINE_DATA_DIR"] ?? pathJoin(_dir, "../../data");
  return `${dataDir}/storage-${accountId}.json`;
}

function loginInit(accountId: string) {
  const deviceMode = process.env["VYLINE_DEVICE"];
  return {
    profile: getVylineProfile(),
    storagePath: storagePathFor(accountId),
    // VYLINE_DEVICE 未設定時は IOSIPAD（共存 + 安定認証）
    ...(deviceMode !== undefined ? { deviceMode } : {}),
  };
}

function startTalkListeners(client: VylineClient, accountId: string): void {
  if (process.env["VYLINE_TALK_LISTEN"] === "0") {
    log.info({ accountId }, "talk listener disabled (VYLINE_TALK_LISTEN=0)");
    return;
  }
  client.on("call:incoming", (ev) => {
    log.info(
      { accountId, from: ev.from, callMid: ev.callMid, kind: ev.kind },
      "incoming call (NOTIFIED_RECEIVED_CALL)",
    );
  });
  client.on("call:cancel", (ev) => {
    log.info(
      { accountId, from: ev.from, callMid: ev.callMid, reason: ev.reason },
      "call cancelled",
    );
  });
  // Push 長ポールは Talk RPC と競合し得る — セッション復元後に遅延起動
  const delayMs = Number(process.env["VYLINE_TALK_LISTEN_DELAY_MS"] ?? 15_000);
  setTimeout(() => {
    try {
      mountTalkListen(client, accountId);
      log.info({ accountId, delayMs }, "talk event listener started");
    } catch (err) {
      log.warn({ accountId, err }, "failed to start talk listener");
    }
  }, delayMs);
}

function watchAuthToken(client: VylineClient, accountId: string): void {
  try {
    patchGroupKeyLookup(client);
  } catch (err) {
    log.warn({ accountId, err }, "patchGroupKeyLookup failed");
  }

  startTalkListeners(client, accountId);
  attachTalkPushBridge(accountId, client);

  // スタック内部ログ（[LEGY/PUSH] 等）を pino へ — 接続状態の観測用
  client.base.on("log", ({ type, data }) => {
    log.debug(
      { vylineType: type, ...(data as Record<string, unknown> | undefined) },
      "vyline stack log",
    );
  });

  const persist = async (reason: string) => {
    const token = client.authToken ?? client.base.authToken;
    const profile = client.base.profile;
    const meta: {
      mid?: string;
      displayName?: string;
      picturePath?: string;
      statusMessage?: string;
    } = {};
    if (profile?.mid) meta.mid = String(profile.mid);
    if (profile?.displayName) meta.displayName = String(profile.displayName);
    const pic =
      (profile as { picturePath?: string } | undefined)?.picturePath ??
      (profile as { pictureStatus?: string } | undefined)?.pictureStatus;
    if (pic) meta.picturePath = String(pic);
    if (profile?.statusMessage) meta.statusMessage = String(profile.statusMessage);
    try {
      await saveToken(accountId, token, meta);
      log.debug({ accountId, reason }, "session persisted");
    } catch (err) {
      log.warn({ accountId, reason, err }, "session persist failed");
    }
  };

  void persist("initial");

  // プロフィール取得後に表示名などを追記
  void client.base.talk
    .getProfile()
    .then(async (profile) => {
      client.base.profile = profile;
      const meta: {
        mid?: string;
        displayName?: string;
        picturePath?: string;
        statusMessage?: string;
      } = {};
      if (profile.mid) meta.mid = String(profile.mid);
      if (profile.displayName) meta.displayName = String(profile.displayName);
      const pic =
        (profile as { picturePath?: string }).picturePath ??
        (profile as { pictureStatus?: string }).pictureStatus;
      if (pic) meta.picturePath = String(pic);
      if (profile.statusMessage) meta.statusMessage = String(profile.statusMessage);
      await updateSessionMeta(accountId, meta);
      await persist("profile");
    })
    .catch((err) => {
      log.debug({ accountId, err }, "profile enrich for session skipped");
    });

  let lastToken = String(client.authToken ?? client.base.authToken ?? "");
  const interval = setInterval(
    () => {
      const current = String(client.authToken ?? client.base.authToken ?? "");
      if (current && current !== lastToken) {
        lastToken = current;
        void persist("token-refresh");
      }
    },
    5 * 60 * 1000,
  );

  process.on("exit", () => clearInterval(interval));
}

export async function loginWithEmail(
  accountId: string,
  email: string,
  password: string,
  onPincode: (pin: string) => void,
  pincode?: string,
): Promise<VylineClient> {
  const profile = getVylineProfile();
  log.info(
    {
      accountId,
      ...deviceLogFields(),
      appVersion: profile.identity.appVersion,
      desktopXLineApplication: profile.identity.xLineApplication,
    },
    "starting email login via Vyline",
  );

  const client = await vylineLoginEmail(
    {
      email,
      password,
      ...(pincode !== undefined ? { pincode } : {}),
      onPincodeRequest(pin: string) {
        log.info({ accountId, pincode: pin }, "pincode requested");
        onPincode(pin);
      },
    },
    loginInit(accountId),
  );

  watchAuthToken(client, accountId);
  void warmLineCache(accountId).catch(() => undefined);
  clients.set(accountId, {
    client,
    accountId,
    qrUrl: null,
    qrExpired: false,
    pincode: null,
    loggedInAt: Date.now(),
  });
  log.info({ accountId }, "email login success");
  return client;
}

export async function loginWithQRCode(
  accountId: string,
  onQrUrl: (url: string) => void,
): Promise<VylineClient> {
  const profile = getVylineProfile();
  log.info(
    {
      accountId,
      ...deviceLogFields(),
      appVersion: profile.identity.appVersion,
      desktopXLineApplication: profile.identity.xLineApplication,
    },
    "starting QR login via Vyline",
  );

  const managed: ManagedClient = {
    client: null as unknown as VylineClient,
    accountId,
    qrUrl: null,
    qrExpired: false,
    pincode: null,
    loggedInAt: null,
  };
  clients.set(accountId, managed);

  const isExpiredError = (err: unknown): boolean => {
    if (!(err instanceof Error)) return false;
    const code = (err as NodeJS.ErrnoException).code ?? "";
    const msg = err.message ?? "";
    return (
      code === "ECONNRESET" ||
      msg.includes("socket connection was closed") ||
      msg.includes("timeout") ||
      msg.includes("expired")
    );
  };

  try {
    const client = await vylineLoginQR(
      {
        onReceiveQRUrl(url: string) {
          log.info({ accountId, url }, "QR URL received");
          managed.qrUrl = url;
          managed.qrExpired = false;
          onQrUrl(url);
        },
        onPincodeRequest(pin: string) {
          log.info({ accountId, pin }, "QR pincode requested");
          managed.pincode = pin;
        },
      },
      loginInit(accountId),
    );

    managed.client = client;
    managed.qrUrl = null;
    managed.qrExpired = false;
    managed.pincode = null;
    managed.loggedInAt = Date.now();
    watchAuthToken(client, accountId);
    void warmLineCache(accountId).catch(() => undefined);
    log.info({ accountId }, "QR login success");
    return client;
  } catch (err) {
    if (isExpiredError(err)) {
      log.info({ accountId }, "QR expired — waiting for user to regenerate");
      managed.qrExpired = true;
      managed.qrUrl = null;
      managed.pincode = null;
      throw err;
    }
    clients.delete(accountId);
    throw err;
  }
}

export async function loginWithToken(accountId: string): Promise<VylineClient> {
  const entry = await getToken(accountId);
  if (!entry) throw new Error(`no token for accountId: ${accountId}`);

  log.info({ accountId }, "restoring session with authToken via Vyline");

  const client = await vylineLoginToken(entry.authToken, {
    profile: getVylineProfile(),
    storagePath: entry.storageFile,
  });

  watchAuthToken(client, accountId);
  void warmLineCache(accountId).catch(() => undefined);
  clients.set(accountId, {
    client,
    accountId,
    qrUrl: null,
    qrExpired: false,
    pincode: null,
    loggedInAt: Date.now(),
  });
  log.info({ accountId }, "token login success");
  return client;
}

export async function loginWithAuthToken(
  accountId: string,
  authToken: string,
): Promise<VylineClient> {
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const _dir = dirname(fileURLToPath(import.meta.url));
  const dataDir = process.env["VYLINE_DATA_DIR"] ?? join(_dir, "../../data");
  const storagePath = join(dataDir, `storage-${accountId}.json`);

  log.info({ accountId }, "login with authToken via Vyline");

  const client = await vylineLoginToken(authToken, {
    profile: getVylineProfile(),
    storagePath,
  });

  watchAuthToken(client, accountId);
  void warmLineCache(accountId).catch(() => undefined);
  clients.set(accountId, {
    client,
    accountId,
    qrUrl: null,
    qrExpired: false,
    pincode: null,
    loggedInAt: Date.now(),
  });
  log.info({ accountId }, "authToken login success");
  return client;
}

export async function restoreAllSessions(): Promise<void> {
  const tokens = await loadTokens();
  const ids = Object.keys(tokens);
  if (ids.length === 0) {
    log.info("no saved sessions to restore");
    return;
  }
  log.info({ count: ids.length }, "restoring sessions");
  await Promise.allSettled(
    ids.map(async (id) => {
      try {
        await loginWithToken(id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const authFailed =
          msg.includes("AUTHENTICATION_FAILED") ||
          msg.includes("Authentication Failed") ||
          msg.includes("status=403") ||
          msg.includes("NOT_AUTHORIZED_DEVICE") ||
          msg.includes("V3_TOKEN_CLIENT_LOGGED_OUT") ||
          msg.includes("logged out");
        if (authFailed) {
          await deleteToken(id);
          removeClient(id);
          log.warn({ accountId: id }, "cleared invalid saved token");
        } else {
          log.warn({ accountId: id, err }, "failed to restore session");
        }
      }
    }),
  );
}

export function getClient(accountId: string): VylineClient | undefined {
  return clients.get(accountId)?.client;
}

export function listAccounts(): string[] {
  return [...clients.keys()];
}

export function getQrState(accountId: string): {
  url: string | null;
  expired: boolean;
  pincode: string | null;
  /** QR ログイン処理がメモリ上で進行中か */
  inProgress: boolean;
} {
  const m = clients.get(accountId);
  if (!m) return { url: null, expired: false, pincode: null, inProgress: false };
  const inProgress = m.loggedInAt === null && !m.qrExpired;
  return {
    url: m.qrUrl,
    expired: m.qrExpired,
    pincode: m.pincode,
    inProgress,
  };
}

export function getAuthToken(accountId: string): string | null {
  const m = clients.get(accountId);
  if (!m?.client) return null;
  return m.client.authToken ?? m.client.base.authToken ?? null;
}

export function getQrUrl(accountId: string): string | null {
  return clients.get(accountId)?.qrUrl ?? null;
}

export function getLoggedInAt(accountId: string): number | null {
  return clients.get(accountId)?.loggedInAt ?? null;
}

export function removeClient(accountId: string): void {
  talkListenByAccount.get(accountId)?.abort.abort();
  talkListenByAccount.delete(accountId);
  detachTalkPushBridge(accountId);
  clients.delete(accountId);
  log.info({ accountId }, "client removed");
}
