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
} from "../storage/tokenStore.js";
import { getVylineProfile } from "../vyline/profileBridge.js";
import { ProtocolSqliteStorage } from "../storage/protocolSqliteStorage.js";
import { currentTalkEventSequence } from "./talkEventBuffer.js";
import { runAccountSingleFlight } from "./accountSingleFlight.js";
import {
  completeOperationInboxBatch,
  getOperationSyncCursor,
  getPendingOperationInboxBatches,
  saveOperationSyncCursor,
  stageOperationInboxBatch,
} from "../storage/chatStore.js";
import { warmLineCache, detachFetchOps } from "../service/lineService.js";

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
const tokenRestoreInflight = new Map<string, Promise<VylineClient>>();

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
const talkListenerTimers = new Map<string, ReturnType<typeof setTimeout>>();

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
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`send timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  void started.finally(() => {
    if (sendQueue.get(accountId) === started) sendQueue.delete(accountId);
  }).catch(() => undefined);
  return Promise.race([started, timeout]).finally(() => clearTimeout(timeoutId));
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

function legacyStoragePathFor(accountId: string): string {
  const dataDir = process.env.VYLINE_DATA_DIR ?? pathJoin(_dir, "../../data");
  return `${dataDir}/storage-${accountId}.json`;
}

function loginInit(accountId: string) {
  const deviceMode = process.env.VYLINE_DEVICE;
  const legacyStoragePath = legacyStoragePathFor(accountId);
  return {
    profile: getVylineProfile(),
    storage: new ProtocolSqliteStorage(accountId, legacyStoragePath),
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
  const previous = talkListenerTimers.get(accountId);
  if (previous) clearTimeout(previous);
  const timer = setTimeout(() => {
    talkListenerTimers.delete(accountId);
    if (clients.get(accountId)?.client !== client) return;
    startFetchOpsLoop(client, accountId);
    log.info({ accountId, delayMs }, "ops loop started");
  }, delayMs);
  talkListenerTimers.set(accountId, timer);
}

function waitForAbortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout>;
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) finish();
  });
}

function revisionFromStorage(value: string): number | bigint {
  if (/^-?\d+$/.test(value)) {
    try {
      return BigInt(value);
    } catch {
      // Preserve compatibility with non-standard revision values below.
    }
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function cursorStorageValue(cursor: { revision: number | bigint; globalRev: number | bigint; individualRev: number | bigint }) {
  return {
    revision: String(cursor.revision),
    globalRevision: String(cursor.globalRev),
    individualRevision: String(cursor.individualRev),
  };
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
  let cursorLoaded = false;
  type SyncOperation = {
    type?: string | number;
    param1?: string;
    param2?: string;
    param3?: string;
    message?: unknown;
    revision?: number | bigint;
  };

  async function processPendingInbox(): Promise<number> {
    const batches = await getPendingOperationInboxBatches<SyncOperation>(accountId);
    if (batches.length === 0) return 0;
    const { processFetchedOperations } = await import("../service/lineService.js");
    for (const batch of batches) {
      if (abort.signal.aborted || opsAbortByAccount.get(accountId) !== abort) {
        throw new Error("operation sync loop was superseded before inbox processing");
      }
      await processFetchedOperations(accountId, batch.operations, async (events) => {
        if (abort.signal.aborted || opsAbortByAccount.get(accountId) !== abort) {
          throw new Error("operation sync loop was superseded before inbox acknowledgement");
        }
        const committedSequences = await completeOperationInboxBatch(
          accountId,
          batch.batchId,
          batch.cursor,
          events,
          currentTalkEventSequence(accountId),
        );
        opsRevision.set(accountId, {
          revision: revisionFromStorage(batch.cursor.revision),
          globalRev: revisionFromStorage(batch.cursor.globalRevision),
          individualRev: revisionFromStorage(batch.cursor.individualRevision),
        });
        return committedSequences;
      });
    }
    return batches.length;
  }

  async function loop(): Promise<void> {
    let errorStreak = 0;
    while (!abort.signal.aborted && client.base.authToken) {
      try {
        if (!cursorLoaded) {
          const stored = await getOperationSyncCursor(accountId);
          if (stored) {
            opsRevision.set(accountId, {
              revision: revisionFromStorage(stored.revision),
              globalRev: revisionFromStorage(stored.globalRevision),
              individualRev: revisionFromStorage(stored.individualRevision),
            });
          }
          cursorLoaded = true;
        }
        await processPendingInbox();
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
        let nextCursor = { ...cursor };
        if (fullSync?.nextRevision) {
          nextCursor.revision = fullSync.nextRevision;
        }
        if (opResp?.globalEvents?.lastRevision) {
          nextCursor.globalRev = opResp.globalEvents.lastRevision;
        }
        if (opResp?.individualEvents?.lastRevision) {
          nextCursor.individualRev = opResp.individualEvents.lastRevision;
        }

        const ops = opResp?.operations ?? [];
        if (ops.length > 0) {
          const lastOp = ops[ops.length - 1];
          if (lastOp?.revision != null) {
            nextCursor.revision = lastOp.revision;
          }
          log.debug({ accountId, count: ops.length }, "ops received");
          await stageOperationInboxBatch(
            accountId,
            cursorStorageValue(cursor),
            cursorStorageValue(nextCursor),
            ops,
          );
          await processPendingInbox();
        } else {
          const storedCursor = cursorStorageValue(cursor);
          const nextStoredCursor = cursorStorageValue(nextCursor);
          if (
            storedCursor.revision !== nextStoredCursor.revision ||
            storedCursor.globalRevision !== nextStoredCursor.globalRevision ||
            storedCursor.individualRevision !== nextStoredCursor.individualRevision
          ) {
            if (abort.signal.aborted || opsAbortByAccount.get(accountId) !== abort) break;
            await saveOperationSyncCursor(accountId, nextStoredCursor);
            opsRevision.set(accountId, nextCursor);
          }
        }

        await waitForAbortableDelay(ops.length > 0 ? POLL_INTERVAL_MS : IDLE_INTERVAL_MS, abort.signal);
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
          await waitForAbortableDelay(5_000, abort.signal);
        } else {
          // 連続エラー時は指数バックオフ（5s → 10s → 20s ... 最大60s）でサーバ負荷を避ける
          errorStreak++;
          const retryMs = Math.min(5_000 * 2 ** (errorStreak - 1), 60_000);
          log.warn({ accountId, msg }, `ops loop error, retrying in ${retryMs / 1000}s`);
          await waitForAbortableDelay(retryMs, abort.signal);
        }
      }
    }
    if (opsAbortByAccount.get(accountId) === abort) opsAbortByAccount.delete(accountId);
    log.info({ accountId }, "ops loop stopped");
  }

  void loop();
}

export function stopFetchOpsLoop(accountId: string): void {
  const listenerTimer = talkListenerTimers.get(accountId);
  if (listenerTimer) clearTimeout(listenerTimer);
  talkListenerTimers.delete(accountId);
  opsAbortByAccount.get(accountId)?.abort();
  opsAbortByAccount.delete(accountId);
  opsRevision.delete(accountId);
}

async function watchAuthToken(client: VylineClient, accountId: string): Promise<void> {
  try {
    patchGroupKeyLookup(client);
  } catch (err) {
    log.warn({ accountId, err }, "patchGroupKeyLookup failed");
  }

  startTalkListeners(client, accountId);

  let lastToken = String(client.authToken ?? client.base.authToken ?? "");
  let persistTail: Promise<void> = Promise.resolve();
  const persist = (reason: string, tokenOverride?: string, profileOverride?: VylineClient["base"]["profile"]): Promise<void> => {
    const token = tokenOverride ?? client.authToken ?? client.base.authToken;
    const profile = profileOverride ?? client.base.profile;
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
    const task = persistTail.catch(() => undefined).then(async () => {
      await saveToken(accountId, token, meta);
      log.debug({ accountId, reason }, "session persisted");
    });
    persistTail = task.catch((err) => {
      log.warn({ accountId, reason, err }, "session persist failed");
    });
    return persistTail;
  };

  // The stack emits the replacement token immediately after refresh. Persist it
  // synchronously through SQLite instead of waiting for the five-minute poll.
  client.base.on("update:authtoken", (authToken) => {
    if (!authToken || authToken === lastToken) return;
    lastToken = authToken;
    void persist("token-refresh-event", authToken);
  });

  // Never include event payloads in logs: login and request payloads may contain credentials.
  client.base.on("log", ({ type }) => {
    const t = type as string;
    if (t === "update:authtoken" || t.startsWith("vyline:e2ee") || t.startsWith("vyline:init")) {
      log.debug({ vylineType: t }, "vyline stack event");
      return;
    }
    log.trace({ vylineType: t }, "vyline stack log");
  });

  await persist("initial");

  // プロフィール取得後に表示名などを追記
  void client.base.talk
    .getProfile()
    .then(async (profile) => {
      client.base.profile = profile;
      await persist("profile", undefined, profile);
    })
    .catch((err) => {
      log.debug({ accountId, err }, "profile enrich for session skipped");
    });

  const previousInterval = tokenWatchIntervals.get(accountId);
  if (previousInterval) clearInterval(previousInterval);
  const interval = setInterval(
    () => {
      const current = String(client.authToken ?? client.base.authToken ?? "");
      if (current && current !== lastToken) {
        lastToken = current;
        void persist("token-refresh", current);
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
        log.info({ accountId, received: Boolean(pin) }, "pincode requested");
        onPincode(pin);
      },
    },
    loginInit(accountId),
  );

  await watchAuthToken(client, accountId);
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
          log.info({ accountId, received: Boolean(url) }, "QR URL received");
          managed.qrUrl = url;
          managed.qrExpired = false;
          onQrUrl(url);
        },
        onPincodeRequest(pin: string) {
          log.info({ accountId, received: Boolean(pin) }, "QR pincode requested");
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
    await watchAuthToken(client, accountId);
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

export function loginWithToken(
  accountId: string,
  options: { background?: boolean } = {},
): Promise<VylineClient> {
  const active = clients.get(accountId);
  if (active?.client && active.loggedInAt !== null) return Promise.resolve(active.client);
  return runAccountSingleFlight(tokenRestoreInflight, accountId, async () => {
    const current = clients.get(accountId);
    if (current?.client && current.loggedInAt !== null) return current.client;
    return restoreSavedToken(accountId, options);
  });
}

async function restoreSavedToken(
  accountId: string,
  options: { background?: boolean },
): Promise<VylineClient> {
  const entry = await getToken(accountId);
  if (!entry) throw new Error(`no token for accountId: ${accountId}`);

  log.info({ accountId }, "restoring session with authToken via Vyline");

  const client = await vylineLoginToken(entry.authToken, {
    profile: getVylineProfile(),
    storage: new ProtocolSqliteStorage(accountId, entry.storageFile),
  });

  if (options.background !== false) {
    await watchAuthToken(client, accountId);
    void warmLineCache(accountId).catch(() => undefined);
  }
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
  const dataDir = process.env.VYLINE_DATA_DIR ?? join(_dir, "../../data");
  const legacyStoragePath = join(dataDir, `storage-${accountId}.json`);

  log.info({ accountId }, "login with authToken via Vyline");

  const client = await vylineLoginToken(authToken, {
    profile: getVylineProfile(),
    storage: new ProtocolSqliteStorage(accountId, legacyStoragePath),
  });

  await watchAuthToken(client, accountId);
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
  stopFetchOpsLoop(accountId);
  detachFetchOps(accountId);
  const tokenWatch = tokenWatchIntervals.get(accountId);
  if (tokenWatch) {
    clearInterval(tokenWatch);
    tokenWatchIntervals.delete(accountId);
  }
  clients.delete(accountId);
  log.info({ accountId }, "client removed");
}
