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
  storagePathForAccount,
  loadTokens,
  deleteToken,
  updateSessionMeta,
} from "../storage/tokenStore.js";
import { getVylineProfile } from "../vyline/profileBridge.js";
import { warmLineCache, detachFetchOps } from "../service/lineService.js";
import { redactForDiagnostics } from "../service/redaction.js";
import { restoreEnabledPlugins } from "./pluginManager.js";

const log = childLogger("clientManager");

function deviceLogFields() {
  const device = resolveDeviceMode();
  return {
    device,
    kicksOfficialDesktop: kicksOfficialDesktop(device),
  };
}

const RPC_TRACE_METADATA_FIELDS = new Set([
  "methodName",
  "protocolType",
  "path",
  "method",
  "timeout",
  "status",
  "requestBytes",
  "responseBytes",
  "hasError",
  "received",
  "verified",
]);
const RPC_TRACE_TYPES = new Set(["writeThrift", "request", "response", "readThrift"]);

function safeStackLogData(type: string, data: unknown): unknown {
  if (!RPC_TRACE_TYPES.has(type) || !data || typeof data !== "object") {
    return redactForDiagnostics(data);
  }
  return Object.fromEntries(
    Object.entries(data as Record<string, unknown>).filter(([key]) =>
      RPC_TRACE_METADATA_FIELDS.has(key),
    ),
  );
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
/** Deduplicate startup restore and frontend /auth/restore for the same account. */
const sessionRestoreInflight = new Map<string, Promise<VylineClient>>();
/** The process-wide startup restore is sequential and may only run once. */
let initialSessionRestore: Promise<void> | null = null;
type QrLoginState = {
  url: string | null;
  expired: boolean;
  pincode: string | null;
  inProgress: boolean;
  error: string | null;
};
const qrLoginState = new Map<string, QrLoginState>();
const qrLoginInflight = new Map<string, Promise<VylineClient>>();
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
  work: (signal?: AbortSignal) => Promise<T>,
  opts?: { timeoutMs?: number; abortOnTimeout?: boolean },
): Promise<T> {
  const timeoutMs = opts?.timeoutMs ?? SEND_TIMEOUT_MS;
  const prev = sendQueue.get(accountId) ?? Promise.resolve();
  const abort = opts?.abortOnTimeout ? new AbortController() : undefined;
  // キューは「タイムアウト race」ではなく work そのもので保持する。
  // タイムアウトで reject されても work は H2 セッションを使い続けるため、
  // 次の送信が並行すると ECONNRESET 等で連続失敗するのを防ぐ。
  const started = prev.catch(() => undefined).then(() => work(abort?.signal));
  sendQueue.set(accountId, started);
  if (abort) {
    let timedOut = false;
    const timeoutError = new Error(`send timed out after ${timeoutMs}ms`);
    const timeoutId = setTimeout(() => {
      timedOut = true;
      abort.abort(timeoutError);
    }, timeoutMs);
    // Media staging must stay alive until the aborted upload has actually
    // unwound; callers may safely remove its files only after this settles.
    return started
      .then(
        (value) => {
          if (timedOut) throw timeoutError;
          return value;
        },
        (error) => {
          if (timedOut) throw timeoutError;
          throw error;
        },
      )
      .finally(() => {
        clearTimeout(timeoutId);
        if (sendQueue.get(accountId) === started) sendQueue.delete(accountId);
      });
  }
  void started
    .finally(() => {
      if (sendQueue.get(accountId) === started) sendQueue.delete(accountId);
    })
    .catch(() => undefined);
  return withSendTimeout(started, timeoutMs);
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

function loginInit(accountId: string) {
  const deviceMode = process.env.VYLINE_DEVICE;
  return {
    profile: getVylineProfile(),
    storagePath: storagePathForAccount(accountId),
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
  const previousWatch = tokenWatchIntervals.get(accountId);
  if (previousWatch) clearInterval(previousWatch);
  tokenWatchIntervals.delete(accountId);
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
      log.debug({ vylineType: t, stackData: safeStackLogData(t, data) }, "vyline stack event");
      return;
    }
    // RPC request/response など高頻度ログ → trace のみ
    log.trace({ vylineType: t, stackData: safeStackLogData(t, data) }, "vyline stack log");
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

  // activateClient() が取得済みの profile を再利用する。未取得時だけ RPC する。
  // ログイン直後に同じ getProfile を重ねると複数 account の H2 初期化と競合しやすい。
  void (async () => {
    const profile = client.base.profile ?? (await client.base.talk.getProfile());
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
  })().catch((err) => {
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

const SESSION_READY_GRACE_MS = 1_500;
const SESSION_READY_RETRY_DELAYS_MS = [0, 250, 750] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * protocol は authToken 発行直後に client を返すため、特に 2 アカウント目以降では
 * loginProcess.ready()（getProfile）がまだ完了していないことがある。
 * その状態で fetchOps / Talk RPC を開始すると「active だが送受信不能」な半端な
 * セッションになるので、バックエンドに登録する前に Talk が使える状態まで待つ。
 *
 * E2EE の後処理は protocol 側で best-effort のまま継続する。ここでは profile 取得だけを
 * readiness 条件にして、既に発行済みの token を E2EE enrichment の失敗で捨てない。
 */
async function ensureOperationalSession(client: VylineClient, accountId: string): Promise<void> {
  if (client.base.profile?.mid) return;

  // protocol の post-auth finalize が先に完了するなら、その結果をそのまま使う。
  const deadline = Date.now() + SESSION_READY_GRACE_MS;
  while (!client.base.profile?.mid && Date.now() < deadline) {
    await sleep(50);
  }
  if (client.base.profile?.mid) return;

  let lastError: unknown;
  for (let attempt = 0; attempt < SESSION_READY_RETRY_DELAYS_MS.length; attempt += 1) {
    const delayMs = SESSION_READY_RETRY_DELAYS_MS[attempt]!;
    if (delayMs > 0) await sleep(delayMs);
    try {
      await client.base.loginProcess.ready();
      if (client.base.profile?.mid) {
        log.debug({ accountId, attempt: attempt + 1 }, "authenticated session is ready");
        return;
      }
      lastError = new Error("profile unavailable after login readiness check");
    } catch (error) {
      lastError = error;
      log.warn(
        { accountId, attempt: attempt + 1, error },
        "authenticated session not ready yet; retrying",
      );
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`authenticated session not ready: ${accountId}`);
}

async function persistIssuedToken(client: VylineClient, accountId: string): Promise<void> {
  const token = client.authToken ?? client.base.authToken;
  if (!token) throw new Error(`login returned without auth token: ${accountId}`);

  const profile = client.base.profile;
  const meta: {
    mid?: string;
    displayName?: string;
    picturePath?: string;
    statusMessage?: string;
    deviceMode?: string;
  } = { deviceMode: String(client.base.device) };
  if (profile?.mid) meta.mid = String(profile.mid);
  if (profile?.displayName) meta.displayName = String(profile.displayName);
  const picturePath =
    (profile as { picturePath?: string } | undefined)?.picturePath ??
    (profile as { pictureStatus?: string } | undefined)?.pictureStatus;
  if (picturePath) meta.picturePath = String(picturePath);
  if (profile?.statusMessage) meta.statusMessage = String(profile.statusMessage);

  try {
    // ready() が失敗しても LINE が発行した token 自体は失わない。次回 restore で再試行できる。
    await saveToken(accountId, token, meta);
  } catch (error) {
    log.warn({ accountId, error }, "issued auth token could not be persisted immediately");
  }
}

async function activateClient(accountId: string, client: VylineClient): Promise<VylineClient> {
  // Persist once as soon as LINE issues the token, then again after ready() so
  // account metadata (MID/name/avatar) is guaranteed to be available to the UI.
  await persistIssuedToken(client, accountId);
  await ensureOperationalSession(client, accountId);
  await persistIssuedToken(client, accountId);

  clients.set(accountId, {
    client,
    accountId,
    qrUrl: null,
    qrExpired: false,
    pincode: null,
    loggedInAt: Date.now(),
  });
  watchAuthToken(client, accountId);
  void warmLineCache(accountId).catch((error) =>
    log.warn({ accountId, error }, "post-login cache warm skipped"),
  );
  restorePluginsForSession(accountId);
  return client;
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
        log.info({ accountId }, "pincode requested");
        onPincode(pin);
      },
    },
    loginInit(accountId),
  );

  await activateClient(accountId, client);
  log.info({ accountId }, "email login success");
  return client;
}

export async function loginWithQRCode(
  accountId: string,
  onQrUrl: (url: string) => void,
): Promise<VylineClient> {
  const active = clients.get(accountId);
  if (active?.loggedInAt != null && active.client) return active.client;
  const existing = qrLoginInflight.get(accountId);
  if (existing) return existing;

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

  const state: QrLoginState = {
    url: null,
    expired: false,
    pincode: null,
    inProgress: true,
    error: null,
  };
  qrLoginState.set(accountId, state);

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

  const login = (async () => {
    let authenticated = false;
    try {
      const client = await vylineLoginQR(
        {
          onReceiveQRUrl(url: string) {
            log.info({ accountId }, "QR URL received");
            state.url = url;
            state.expired = false;
            state.error = null;
            onQrUrl(url);
          },
          onPincodeRequest(pin: string) {
            log.info({ accountId }, "QR pincode requested");
            state.pincode = pin;
          },
        },
        loginInit(accountId),
      );

      authenticated = true;
      await activateClient(accountId, client);
      state.url = null;
      state.expired = false;
      state.pincode = null;
      state.inProgress = false;
      state.error = null;

      log.info({ accountId }, "QR login success");
      return client;
    } catch (err) {
      state.inProgress = false;
      state.error = err instanceof Error ? err.message : String(err);
      state.url = null;
      state.pincode = null;
      if (!authenticated && isExpiredError(err)) {
        log.info({ accountId }, "QR expired — waiting for user to regenerate");
        state.expired = true;
      } else {
        log.warn({ accountId, err }, "QR login failed before client registration");
      }
      throw err;
    }
  })();

  qrLoginInflight.set(accountId, login);
  try {
    return await login;
  } finally {
    if (qrLoginInflight.get(accountId) === login) qrLoginInflight.delete(accountId);
  }
}

export async function loginWithToken(accountId: string): Promise<VylineClient> {
  const active = clients.get(accountId);
  if (active?.loggedInAt != null && active.client) return active.client;
  const existingRestore = sessionRestoreInflight.get(accountId);
  if (existingRestore) return existingRestore;

  const restore = (async () => {
    const entry = await getToken(accountId);
    if (!entry) throw new Error(`no token for accountId: ${accountId}`);

    log.info({ accountId }, "restoring session with authToken via Vyline");

    const client = await vylineLoginToken(entry.authToken, {
      profile: getVylineProfile(),
      storagePath: entry.storageFile,
      ...(entry.deviceMode ? { deviceMode: entry.deviceMode } : {}),
    });

    await activateClient(accountId, client);
    log.info({ accountId }, "token login success");
    return client;
  })();

  sessionRestoreInflight.set(accountId, restore);
  try {
    return await restore;
  } finally {
    if (sessionRestoreInflight.get(accountId) === restore) {
      sessionRestoreInflight.delete(accountId);
    }
  }
}

export async function loginWithAuthToken(
  accountId: string,
  authToken: string,
  deviceMode?: string,
): Promise<VylineClient> {
  const storagePath = storagePathForAccount(accountId);

  log.info({ accountId }, "login with authToken via Vyline");

  const client = await vylineLoginToken(authToken, {
    profile: getVylineProfile(),
    storagePath,
    ...(deviceMode ? { deviceMode } : {}),
  });

  await activateClient(accountId, client);
  log.info({ accountId }, "authToken login success");
  return client;
}

async function restoreAllSessionsImpl(): Promise<void> {
  const tokens = await loadTokens();
  const ids = Object.keys(tokens).filter((id) => !id.endsWith(":content"));
  if (ids.length === 0) {
    log.info("no saved sessions to restore");
    return;
  }
  log.info({ count: ids.length }, "restoring sessions");
  // The protocol stack and its file-storage initialization are not safe to
  // stampede at process start. Sequential restore is fast enough and prevents
  // the third/fourth account from losing its client while earlier logins settle.
  for (const id of ids) {
    try {
      await loginWithToken(id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const expiredDevice = msg.includes("NOT_AUTHORIZED_DEVICE") && msg.includes("EXPIRED");
      if (expiredDevice) {
        removeClient(id);
        await updateSessionMeta(id, { reauthRequired: true });
        log.warn({ accountId: id }, "saved session expired; reauthentication required");
        continue;
      }
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
  }
}

export function restoreAllSessions(): Promise<void> {
  if (!initialSessionRestore) initialSessionRestore = restoreAllSessionsImpl();
  return initialSessionRestore;
}

export function waitForSessionRestore(): Promise<void> {
  return restoreAllSessions();
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

  const state: {
    url: string | null;
    expired: boolean;
    pincode: string | null;
    inProgress: boolean;
  } = {
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
        storagePath: `${storagePathForAccount(accountId)}.content-secondary`,
        deviceMode: "ANDROIDSECONDARY",
      },
    );

    const token = client.authToken ?? client.base.authToken;
    if (!token) throw new Error("content login completed without auth token");
    await saveToken(contentTokenId(accountId), token, {
      storageFile: `${storagePathForAccount(accountId)}.content-secondary`,
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
  return [...clients.entries()]
    .filter(([, managed]) => managed.loggedInAt !== null && Boolean(managed.client))
    .map(([accountId]) => accountId);
}

export function getQrState(accountId: string): {
  url: string | null;
  expired: boolean;
  pincode: string | null;
  /** QR ログイン処理がメモリ上で進行中か */
  inProgress: boolean;
  error?: string | null;
} {
  const active = clients.get(accountId);
  if (active?.loggedInAt != null && active.client) {
    return { url: null, expired: false, pincode: null, inProgress: false, error: null };
  }
  const state = qrLoginState.get(accountId);
  return {
    url: state?.url ?? null,
    expired: state?.expired ?? false,
    pincode: state?.pincode ?? null,
    inProgress: state?.inProgress ?? false,
    error: state?.error ?? null,
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
  sessionRestoreInflight.delete(accountId);
  contentClients.delete(accountId);
  contentQrState.delete(accountId);
  log.info({ accountId }, "client removed");
}
