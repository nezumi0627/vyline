/**
 * tokenStore.ts
 *
 * authToken とセッションメタのアカウント別ローカル保存。
 * 保存先: <backend>/data/accounts/<accountId>/credentials.json
 * protocol storage: <backend>/data/accounts/<accountId>/protocol.json
 * 旧 data/tokens.json は読み込み・移行互換のみ。
 */

import { join, dirname } from "node:path";
import { chmod, copyFile, mkdir, readFile, readdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from "node:crypto";
import { childLogger } from "../logger.js";
import { protectSecret, unprotectSecret } from "./secureStore.js";
import { writeJsonAtomic } from "./safeFile.js";

const log = childLogger("tokenStore");

const _dir = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_DIR = join(_dir, "..", "..", "data");
const HANDOFF_SCHEMA = "vyline-credential-handoff";
const HANDOFF_VERSION = 1;
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

function dataDir(): string {
  return process.env.VYLINE_DATA_DIR ?? DEFAULT_DATA_DIR;
}

function accountsDir(): string {
  return join(dataDir(), "accounts");
}

function tokensFile(): string {
  return join(dataDir(), "tokens.json");
}

function accountDir(accountId: string): string {
  return join(accountsDir(), encodeURIComponent(accountId));
}

function accountTokenFile(accountId: string): string {
  return join(accountDir(accountId), "credentials.json");
}

export function storagePathForAccount(accountId: string): string {
  return join(accountDir(accountId), "protocol.json");
}

export async function getProtocolTokenState(accountId: string): Promise<{
  hasRefreshToken: boolean;
  expire?: number;
}> {
  const path = storagePathForAccount(accountId);
  if (!existsSync(path)) return { hasRefreshToken: false };
  try {
    await hardenCredentialFile(path);
    const protocol = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    const refreshToken = protocol.refreshToken;
    const expire = protocol.expire;
    return {
      hasRefreshToken: typeof refreshToken === "string" && refreshToken.length > 0,
      ...(typeof expire === "number" && Number.isFinite(expire) ? { expire } : {}),
    };
  } catch (err) {
    log.warn({ accountId, err }, "failed to inspect protocol token state");
    return { hasRefreshToken: false };
  }
}

export interface TokenEntry {
  authToken: string;
  authTokenProtected?: string;
  /** VylineFileStorage のパス */
  storageFile: string;
  savedAt: string;
  mid?: string;
  displayName?: string;
  picturePath?: string;
  statusMessage?: string;
  /** セッション発行時のデバイス種別。復元時に別端末種別へ化けるのを防ぐ。 */
  deviceMode?: string;
  /** access tokenが期限切れで、同じaccountIdの再認証が必要。 */
  reauthRequired?: boolean;
  premium?: {
    active: boolean;
    planType?: string | number;
    validUntil?: number;
    onFreeTrial?: boolean;
    willExpire?: boolean;
  };
}

export type TokenMap = Record<string, TokenEntry>;

export type SessionMeta = {
  storageFile?: string;
  mid?: string;
  displayName?: string;
  picturePath?: string;
  statusMessage?: string;
  deviceMode?: string;
  reauthRequired?: boolean;
  premium?: {
    active: boolean;
    planType?: string | number;
    validUntil?: number;
    onFreeTrial?: boolean;
    willExpire?: boolean;
  };
};

async function correctPrivateMode(
  path: string,
  mode: number,
  kind: "directory" | "credential file",
  required: boolean,
): Promise<void> {
  // POSIX modes are not an ACL boundary on Windows. Preserve the existing
  // DPAPI + user-profile ACL behavior instead of pretending chmod secures it.
  if (process.platform === "win32") return;
  try {
    await chmod(path, mode);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    if (required) throw error;
    log.warn({ error, path }, `could not tighten existing ${kind} permissions`);
  }
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  await correctPrivateMode(path, PRIVATE_DIRECTORY_MODE, "directory", true);
}

async function hardenCredentialFile(path: string, required = false): Promise<void> {
  if (!existsSync(path)) return;
  await correctPrivateMode(path, PRIVATE_FILE_MODE, "credential file", required);
}

async function ensureDataDir(): Promise<void> {
  const root = dataDir();
  const accounts = accountsDir();
  const created = !existsSync(root);
  await ensurePrivateDirectory(root);
  if (created) {
    log.debug({ dir: root }, "created data dir");
  }
  await ensurePrivateDirectory(accounts);
}

async function decodePersistedEntry(
  accountId: string,
  entry: TokenEntry,
): Promise<TokenEntry | undefined> {
  const targetStorage = storagePathForAccount(accountId);
  await ensurePrivateDirectory(accountDir(accountId));
  await hardenCredentialFile(accountTokenFile(accountId));
  await hardenCredentialFile(targetStorage);
  if (
    entry?.storageFile &&
    entry.storageFile !== targetStorage &&
    existsSync(entry.storageFile) &&
    !existsSync(targetStorage)
  ) {
    await hardenCredentialFile(entry.storageFile);
    await copyFile(entry.storageFile, targetStorage);
    await hardenCredentialFile(targetStorage, true);
    log.info({ accountId }, "migrated protocol storage into account directory");
  }
  if (entry?.authTokenProtected && typeof entry.authTokenProtected === "string") {
    const token = await unprotectSecret(entry.authTokenProtected);
    return { ...entry, authToken: token, storageFile: targetStorage };
  }
  if (entry?.authToken && typeof entry.authToken === "string") {
    return { ...entry, storageFile: targetStorage };
  }
  return undefined;
}

async function persistAccount(accountId: string, entry: TokenEntry): Promise<void> {
  await ensurePrivateDirectory(accountDir(accountId));
  const { authToken: _plain, ...safeEntry } = entry;
  const persisted = entry.authTokenProtected ? safeEntry : entry;
  const path = accountTokenFile(accountId);
  await writeJsonAtomic(path, persisted);
  await hardenCredentialFile(path, true);
}

export async function loadTokens(): Promise<TokenMap> {
  await ensureDataDir();
  const cleaned: TokenMap = {};
  const accounts = accountsDir();
  const legacyTokens = tokensFile();
  try {
    for (const dir of await readdir(accounts, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const id = decodeURIComponent(dir.name);
      const path = accountTokenFile(id);
      if (!existsSync(path)) continue;
      await ensurePrivateDirectory(accountDir(id));
      await hardenCredentialFile(path);
      const entry = JSON.parse(await readFile(path, "utf8")) as TokenEntry;
      const decoded = await decodePersistedEntry(id, entry);
      if (decoded) cleaned[id] = decoded;
    }
  } catch (err) {
    log.warn({ err }, "failed to read account credential files");
  }

  // Legacy shared tokens.json remains readable. Account files win, and a legacy
  // entry is migrated lazily without deleting the recoverable source file.
  if (existsSync(legacyTokens)) {
    try {
      await hardenCredentialFile(legacyTokens);
      const parsed = JSON.parse(await readFile(legacyTokens, "utf8")) as TokenMap;
      for (const [id, entry] of Object.entries(parsed)) {
        if (cleaned[id]) continue;
        const decoded = await decodePersistedEntry(id, entry);
        if (decoded) {
          cleaned[id] = decoded;
          await persistAccount(id, decoded);
        }
      }
    } catch (err) {
      log.warn({ err }, "failed to parse legacy tokens.json");
    }
  }
  return cleaned;
}

function normalizeAuthToken(authToken: unknown): string | null {
  if (typeof authToken === "string" && authToken.trim()) return authToken.trim();
  if (authToken && typeof authToken === "object") {
    const obj = authToken as Record<string, unknown>;
    const access =
      (typeof obj.accessToken === "string" && obj.accessToken) ||
      (typeof obj.authToken === "string" && obj.authToken) ||
      (typeof obj.token === "string" && obj.token);
    if (access) return access;
  }
  return null;
}

export async function saveToken(
  accountId: string,
  authToken: unknown,
  meta?: SessionMeta,
): Promise<void> {
  const token = normalizeAuthToken(authToken);
  if (!token) {
    log.warn({ accountId }, "skip token save — empty authToken");
    return;
  }

  await ensureDataDir();
  const tokens = await loadTokens();
  const existing = tokens[accountId];
  const entry: TokenEntry = {
    authToken: token,
    storageFile: storagePathForAccount(accountId),
    savedAt: new Date().toISOString(),
  };
  try {
    entry.authTokenProtected = await protectSecret(token);
  } catch (error) {
    if (process.platform === "win32") throw error;
    entry.authToken = token;
    log.warn("OS secure storage unavailable; token is stored only for local development");
  }
  const mid = meta?.mid ?? existing?.mid;
  const displayName = meta?.displayName ?? existing?.displayName;
  const picturePath = meta?.picturePath ?? existing?.picturePath;
  const statusMessage = meta?.statusMessage ?? existing?.statusMessage;
  const deviceMode = meta?.deviceMode ?? existing?.deviceMode;
  const premium = meta?.premium ?? existing?.premium;
  if (mid) entry.mid = mid;
  if (displayName) entry.displayName = displayName;
  if (picturePath) entry.picturePath = picturePath;
  if (statusMessage) entry.statusMessage = statusMessage;
  if (deviceMode) entry.deviceMode = deviceMode;
  // saveTokenは認証成功後だけ呼ばれるため、期限切れ状態を解除する。
  entry.reauthRequired = meta?.reauthRequired ?? false;
  if (premium) entry.premium = premium;
  tokens[accountId] = entry;
  await persistAccount(accountId, entry);
  log.info(
    { accountId, hasDisplayName: Boolean(entry.displayName), hasMid: Boolean(entry.mid) },
    "token saved",
  );
}

export async function updateSessionMeta(accountId: string, meta: SessionMeta): Promise<void> {
  const tokens = await loadTokens();
  const existing = tokens[accountId];
  if (!existing) return;
  if (meta.mid != null) existing.mid = meta.mid;
  if (meta.displayName != null) existing.displayName = meta.displayName;
  if (meta.picturePath != null) existing.picturePath = meta.picturePath;
  if (meta.statusMessage != null) existing.statusMessage = meta.statusMessage;
  if (meta.deviceMode != null) existing.deviceMode = meta.deviceMode;
  if (meta.reauthRequired != null) existing.reauthRequired = meta.reauthRequired;
  if (meta.premium != null) existing.premium = meta.premium;
  existing.savedAt = new Date().toISOString();
  await persistAccount(accountId, existing);
}

export async function saveRefreshToken(
  accountId: string,
  refreshToken: string,
  expire?: number,
): Promise<void> {
  const token = refreshToken.trim();
  if (!token) throw new Error("refresh token is empty");
  await ensureDataDir();
  await ensurePrivateDirectory(accountDir(accountId));
  const path = storagePathForAccount(accountId);
  let protocol: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      await hardenCredentialFile(path);
      protocol = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    } catch {
      protocol = {};
    }
  }
  protocol.refreshToken = token;
  if (typeof expire === "number" && Number.isFinite(expire)) protocol.expire = expire;
  await writeJsonAtomic(path, protocol);
  await hardenCredentialFile(path, true);
}

export async function deleteToken(accountId: string): Promise<void> {
  try {
    await unlink(accountTokenFile(accountId));
  } catch {
    // already absent
  }
  log.info({ accountId }, "token deleted");
}

export interface CredentialHandoffBundle {
  schema: typeof HANDOFF_SCHEMA;
  version: typeof HANDOFF_VERSION;
  accountId: string;
  createdAt: string;
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

function handoffKey(passphrase: string, salt: Buffer): Buffer {
  if (passphrase.length < 8) throw new Error("引き継ぎパスフレーズは8文字以上にしてください");
  return pbkdf2Sync(passphrase, salt, 210_000, 32, "sha256");
}

/** Auth/refresh/channel tokens and protocol credentials as an encrypted portable bundle. */
export async function exportCredentialHandoff(
  accountId: string,
  passphrase: string,
): Promise<CredentialHandoffBundle> {
  const entry = await getToken(accountId);
  if (!entry) throw new Error("保存済みセッションがありません");
  let protocol: Record<string, unknown> = {};
  if (existsSync(entry.storageFile)) {
    await hardenCredentialFile(entry.storageFile);
    protocol = JSON.parse(await readFile(entry.storageFile, "utf8")) as Record<string, unknown>;
  }
  const payload = JSON.stringify({
    authToken: entry.authToken,
    meta: {
      mid: entry.mid,
      displayName: entry.displayName,
      picturePath: entry.picturePath,
      statusMessage: entry.statusMessage,
      deviceMode: entry.deviceMode,
      premium: entry.premium,
    },
    protocol,
  });
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", handoffKey(passphrase, salt), iv);
  const ciphertext = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
  return {
    schema: HANDOFF_SCHEMA,
    version: HANDOFF_VERSION,
    accountId,
    createdAt: new Date().toISOString(),
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export async function importCredentialHandoff(
  bundle: CredentialHandoffBundle,
  passphrase: string,
  targetAccountId = bundle.accountId,
): Promise<void> {
  if (bundle.schema !== HANDOFF_SCHEMA || bundle.version !== HANDOFF_VERSION) {
    throw new Error("未対応の引き継ぎファイルです");
  }
  const salt = Buffer.from(bundle.salt, "base64");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    handoffKey(passphrase, salt),
    Buffer.from(bundle.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(bundle.tag, "base64"));
  const raw = Buffer.concat([
    decipher.update(Buffer.from(bundle.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
  const payload = JSON.parse(raw) as {
    authToken: string;
    meta?: SessionMeta;
    protocol?: Record<string, unknown>;
  };
  await saveToken(targetAccountId, payload.authToken, payload.meta);
  const target = storagePathForAccount(targetAccountId);
  await ensurePrivateDirectory(accountDir(targetAccountId));
  await writeJsonAtomic(target, payload.protocol ?? {});
  await hardenCredentialFile(target, true);
}

export async function getToken(accountId: string): Promise<TokenEntry | undefined> {
  const tokens = await loadTokens();
  return tokens[accountId];
}

/** ログイン画面用のセッション一覧 */
export async function listSavedSessions(): Promise<
  Array<{
    accountId: string;
    savedAt: string;
    mid?: string;
    displayName?: string;
    picturePath?: string;
    statusMessage?: string;
    reauthRequired?: boolean;
    hasRefreshToken?: boolean;
    tokenRefreshAt?: number;
    hasToken: boolean;
  }>
> {
  const tokens = await loadTokens();
  const sessions = await Promise.all(
    Object.entries(tokens)
      .filter(([accountId]) => !accountId.endsWith(":content"))
      .map(async ([accountId, entry]) => {
        const protocolState = await getProtocolTokenState(accountId);
      const row: {
        accountId: string;
        savedAt: string;
        mid?: string;
        displayName?: string;
        picturePath?: string;
        statusMessage?: string;
        reauthRequired?: boolean;
        hasRefreshToken?: boolean;
        tokenRefreshAt?: number;
        premium?: TokenEntry["premium"];
        hasToken: boolean;
      } = {
        accountId,
        savedAt: entry.savedAt,
        hasToken: Boolean(entry.authToken || entry.authTokenProtected),
      };
      if (entry.mid) row.mid = entry.mid;
      if (entry.displayName) row.displayName = entry.displayName;
      if (entry.picturePath) row.picturePath = entry.picturePath;
      if (entry.statusMessage) row.statusMessage = entry.statusMessage;
      if (entry.reauthRequired) row.reauthRequired = true;
      row.hasRefreshToken = protocolState.hasRefreshToken;
      if (typeof protocolState.expire === "number") row.tokenRefreshAt = protocolState.expire;
      if (entry.premium) row.premium = entry.premium;
      return row;
      }),
  );
  return sessions.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
}
