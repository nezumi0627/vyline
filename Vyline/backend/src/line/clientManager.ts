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
  loginWithStoredRefreshToken as vylineLoginStoredRefreshToken,
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
import { warmLineCache, detachFetchOps } from "../service/lineService.js";
import { restoreEnabledPlugins } from "./pluginManager.js";

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

const clients = new Map<string, ManagedClient>();
const contentClients = new Map<string, Promise<VylineClient>>();
const contentQrState = new Map<
  string,
  { url: string | null; expired: boolean; pincode: string | null; inProgress: boolean }
>();
const contentTokenId = (accountId: string) => `${accountId}:content`;

function restorePluginsForSession(accountId: string): void {
  void restoreEnabledPlugins(accountId).catch((error) =>
    log.warn({ accountId, error }, "enabled plugins could not be restored"),
  );
}

/** アカウントごとの fetchOps カーソル（revision ベース） */
const opsRevision = new Map<
  string,
  {
    revision: number | bigint;
    globalRev: number | bigint;
    individualRev: number | bigint;
  }
>();

/** fetchOps ループの AbortController */
const opsAbortByAccount = new Map<string, AbortController>();

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
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`send timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    p.then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
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
  const dataDir = process.env.VYLINE_DATA_DIR ?? pathJoin(_dir, "../../data");
  return `${dataDir}/storage-${accountId}.json`;
}

function loginInit(accountId: string) {
  const deviceMode = process.env.VYLINE_DEVICE;
  return {
    profile: getVylineProfile(),
    storagePath: storagePathFor(accountId),
    // VYLINE_DEVICE 未設定時は IOSIPAD（共存 + 安定認証）
    ...(deviceMode !== undefined ? { deviceMode } : {}),
  };
}

function startTalkListeners(client: VylineClient, accountId: string): void {
  if (process.env.VYLINE_TALK_LISTEN === "0") {
    log.info({ accountId }, "ops loop disabled (VYLINE_TALK_LISTEN=0)");
    return;
  }
  const delayMs = Number(process.env.VYLINE_TALK_LISTEN_DELAY_MS ?? 5_000);
  setTimeout(() => {
    startFetchOpsLoop(client, accountId);
    log.info({ accountId, delayMs }, "ops loop started");
  }, delayMs);
}

function startFetchOpsLoop(client: VylineClient, accountId: string): void {
  opsAbortByAccount.get(accountId)?.abort();
  const abort = new AbortController();
  opsAbortByAccount.set(accountId, abort);

  const POLL_INTERVAL_MS = Number(process.env.VYLINE_OPS_POLL_MS ?? 2_000);
  const IDLE_INTERVAL_MS = Number(process.env.VYLINE_OPS_IDLE_MS ?? 8_000);
  const POLL_TIMEOUT_MS = Number(process.env.VYLINE_OPS_TIMEOUT_MS ?? 60_000);

  const getCursor = () =>
    opsRevision.get(accountId) ?? { revision: 0, globalRev: 0, individualRev: 0 };

  async function loop(): Promise<void> {
    let errorStreak = 0;
    while (!abort.signal.aborted && client.base.authToken) {
      try {
        const cursor = getCursor();
        const resp = await client.base.talk.sync({
          limit: 100,
          revision: cursor.revision,
          globalRev: cursor.globalRev,
          individualRev: cursor.individualRev,
          timeout: POLL_TIMEOUT_MS,
        });

        const opResp = resp?.operationResponse;
        const fullSync = resp?.fullSyncResponse;
        if (fullSync?.nextRevision) {
          opsRevision.set(accountId, { ...getCursor(), revision: fullSync.nextRevision });
        }
        if (opResp?.globalEvents?.lastRevision) {
          opsRevision.set(accountId, {
            ...getCursor(),
            globalRev: opResp.globalEvents.lastRevision,
          });
        }
        if (opResp?.individualEvents?.lastRevision) {
          opsRevision.set(accountId, {
            ...getCursor(),
            individualRev: opResp.individualEvents.lastRevision,
          });
        }

        const ops = opResp?.operations ?? [];
        if (ops.length > 0) {
          const lastOp = ops[ops.length - 1];
          if (lastOp?.revision != null) {
            opsRevision.set(accountId, { ...getCursor(), revision: lastOp.revision });
          }
          log.debug({ accountId, count: ops.length }, "ops received");
          const { processFetchedOperations } = await import("../service/lineService.js");
          await processFetchedOperations(accountId, ops);
        }

        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, ops.length > 0 ? POLL_INTERVAL_MS : IDLE_INTERVAL_MS);
          abort.signal.addEventListener(
            "abort",
            () => {
              clearTimeout(t);
              resolve();
            },
            { once: true },
          );
        });
        errorStreak = 0;
      } catch (err) {
        if (abort.signal.aborted) break;
        const msg = err instanceof Error ? err.message : String(err);
        const isTimeout =
          err instanceof Error &&
          (err.name === "TimeoutError" || err.message === "The operation timed out.");
        if (isTimeout) {
          // /SYNC4 は長ポール。新着がないままクライアント側の
          // 期限を迎えるのは通常の待機終了なので、警告にしない。
          errorStreak = 0;
          log.debug({ accountId, msg }, "ops long poll timed out, retrying in 5s");
          await new Promise<void>((resolve) => setTimeout(resolve, 5_000));
        } else {
          // 連続エラー時は指数バックオフ（5s → 10s → 20s ... 最大60s）でサーバ負荷を避ける
          errorStreak++;
          const retryMs = Math.min(5_000 * 2 ** (errorStreak - 1), 60_000);
          log.warn({ accountId, msg }, `ops loop error, retrying in ${retryMs / 1000}s`);
          await new Promise<void>((resolve) => setTimeout(resolve, retryMs));
        }
      }
    }
    opsAbortByAccount.delete(accountId);
    log.info({ accountId }, "ops loop stopped");
  }

  void loop();
}

export function stopFetchOpsLoop(accountId: string): void {
  opsAbortByAccount.get(accountId)?.abort();
  opsAbortByAccount.delete(accountId);
  opsRevision.delete(accountId);
}

function watchAuthToken(client: VylineClient, accountId: string): void {
  try {
    patchGroupKeyLookup(client);
  } catch (err) {
    log.warn({ accountId, err }, "patchGroupKeyLookup failed");
  }

  startTalkListeners(client, accountId);

  // スタック内部ログ（RPC request/response 等）は trace で埋める。
  // LOG_LEVEL=trace で詳細確認、通常運用では表示しない。
  // 認証関連など重要なものだけ debug で残す。
  client.base.on("log", ({ type, data }) => {
    const t = type as string;
    if (t === "update:authtoken" || t.startsWith("vyline:e2ee") || t.startsWith("vyline:init")) {
      log.debug(
        { vylineType: t, ...(data as Record<string, unknown> | undefined) },
        "vyline stack event",
      );
      return;
    }
    // RPC request/response など高頻度ログ → trace のみ
    log.trace(
      { vylineType: t, ...(data as Record<string, unknown> | undefined) },
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
      deviceMode?: string;
    } = {};
    meta.deviceMode = String(client.base.device);
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
  tokenWatchIntervals.set(accountId, interval);
}

const tokenWatchIntervals = new Map<string, ReturnType<typeof setInterval>>();

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
  restorePluginsForSession(accountId);
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
    restorePluginsForSession(accountId);
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
    ...(entry.deviceMode ? { deviceMode: entry.deviceMode } : {}),
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
  restorePluginsForSession(accountId);
  log.info({ accountId }, "token login success");
  return client;
}

export async function loginWithAuthToken(
  accountId: string,
  authToken: string,
  deviceMode?: string,
): Promise<VylineClient> {
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const _dir = dirname(fileURLToPath(import.meta.url));
  const dataDir = process.env.VYLINE_DATA_DIR ?? join(_dir, "../../data");
  const storagePath = join(dataDir, `storage-${accountId}.json`);

  log.info({ accountId }, "login with authToken via Vyline");

  const client = await vylineLoginToken(authToken, {
    profile: getVylineProfile(),
    storagePath,
    ...(deviceMode ? { deviceMode } : {}),
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
  restorePluginsForSession(accountId);
  log.info({ accountId }, "authToken login success");
  return client;
}

export async function restoreAllSessions(): Promise<void> {
  const tokens = await loadTokens();
  const ids = Object.keys(tokens).filter((id) => !id.endsWith(":content"));
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

export async function getContentClient(accountId: string): Promise<VylineClient> {
  const active = clients.get(accountId)?.client;
  if (!active) throw new Error("not logged in");
  return active;
}

export async function loginContentWithQRCode(
  accountId: string,
  onQrUrl: (url: string) => void,
): Promise<VylineClient> {
  if (!clients.get(accountId)?.client) throw new Error("not logged in");

  const state: { url: string | null; expired: boolean; pincode: string | null; inProgress: boolean } = {
    url: null,
    expired: false,
    pincode: null,
    inProgress: true,
  };
  contentQrState.set(accountId, state);
  try {
    const client = await vylineLoginQR(
      {
        onReceiveQRUrl(url: string) {
          state.url = url;
          state.expired = false;
          onQrUrl(url);
        },
        onPincodeRequest(pin: string) {
          state.pincode = pin;
        },
      },
      {
        profile: getVylineProfile(),
        storagePath: `${storagePathFor(accountId)}.content-secondary`,
        deviceMode: "ANDROIDSECONDARY",
      },
    );

    const token = client.authToken ?? client.base.authToken;
    if (!token) throw new Error("content login completed without auth token");
    await saveToken(contentTokenId(accountId), token, {
      storageFile: `${storagePathFor(accountId)}.content-secondary`,
    });
    contentClients.set(accountId, Promise.resolve(client));
    state.url = null;
    state.pincode = null;
    state.inProgress = false;
    log.info({ accountId }, "content secondary QR login success");
    return client;
  } catch (error) {
    state.url = null;
    state.pincode = null;
    state.inProgress = false;
    state.expired = true;
    throw error;
  }
}

export function getContentQrState(accountId: string): {
  url: string | null;
  expired: boolean;
  pincode: string | null;
  inProgress: boolean;
  ready: boolean;
} {
  const state = contentQrState.get(accountId);
  return {
    url: state?.url ?? null,
    expired: state?.expired ?? false,
    pincode: state?.pincode ?? null,
    inProgress: state?.inProgress ?? false,
    ready: contentClients.has(accountId),
  };
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
  stopFetchOpsLoop(accountId);
  detachFetchOps(accountId);
  const tokenWatch = tokenWatchIntervals.get(accountId);
  if (tokenWatch) {
    clearInterval(tokenWatch);
    tokenWatchIntervals.delete(accountId);
  }
  clients.delete(accountId);
  contentClients.delete(accountId);
  contentQrState.delete(accountId);
  log.info({ accountId }, "client removed");
}
