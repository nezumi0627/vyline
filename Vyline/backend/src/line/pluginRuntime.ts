/**
 * line/pluginRuntime.ts — プラグイン実行ランタイム
 *
 * 設計:
 * - プラグインは Bun の動的 import（.ts/.js を直接実行）で読み込む
 * - activate / deactivate / 各イベントハンドラはすべて try/catch で隔離し、
 *   プラグインのクラッシュが Vyline 本体に影響しない
 * - PluginContext は宣言された権限のみを公開する（権限の強制）
 * - すべての操作はアカウントスコープ（accountId バウンド）
 */

import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type {
  PluginContext,
  PluginLogger,
  PluginMessageSnapshot,
  VylinePlugin,
} from "@vyline/plugin-sdk";
import { childLogger } from "../logger.js";
import { safePathComponent, writeJsonAtomic } from "../storage/safeFile.js";
import { getDataDir, getPluginDir } from "./pluginPaths.js";

const log = childLogger("plugins");

function settingsDir(): string {
  return join(getDataDir(), "plugin-settings");
}

interface ActivePlugin {
  accountId: string;
  pluginId: string;
  permissions: Set<string>;
  messageHandlers: Set<(m: PluginMessageSnapshot) => void>;
  plugin: VylinePlugin;
  context: PluginContext;
}

const active = new Map<string, ActivePlugin>();
// Settings updates are read-modify-write transactions. Serialize only the
// same account/plugin pair so concurrent plugins cannot overwrite each other.
const settingsLocks = new Map<string, Promise<void>>();

function key(accountId: string, pluginId: string): string {
  return `${accountId}:${pluginId}`;
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return Boolean(rel) && !rel.startsWith("..") && !rel.includes(":");
}

function settingsPath(accountId: string, pluginId: string): string {
  const account = safePathComponent(accountId, "account");
  const plugin = safePathComponent(pluginId, "plugin");
  return join(settingsDir(), `${account}.${plugin}.json`);
}

export function isPluginActive(accountId: string, pluginId: string): boolean {
  return active.has(key(accountId, pluginId));
}

/** プラグインのエントリポイントファイルを解決する（index.ts → index.js → main） */
export function resolvePluginEntry(pluginDirName: string, manifestMain?: string): string | null {
  const dir = resolve(getPluginDir(), pluginDirName);
  const candidates = manifestMain
    ? [resolve(dir, manifestMain)]
    : [resolve(dir, "index.ts"), resolve(dir, "index.js")];
  for (const candidate of candidates) {
    if (!isInside(dir, candidate)) continue;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

async function makeLogger(pluginId: string): Promise<PluginLogger> {
  const base = childLogger(`plugin:${pluginId}`);
  return {
    debug: (msg, ...args) => base.debug({ args }, msg),
    info: (msg, ...args) => base.info({ args }, msg),
    warn: (msg, ...args) => base.warn({ args }, msg),
    error: (msg, ...args) => base.error({ args }, msg),
  };
}

async function readSettingsFile(
  accountId: string,
  pluginId: string,
): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(settingsPath(accountId, pluginId), "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return {};
  }
}

async function writeSettingsFile(
  accountId: string,
  pluginId: string,
  data: Record<string, unknown>,
): Promise<void> {
  await mkdir(settingsDir(), { recursive: true });
  await writeJsonAtomic(settingsPath(accountId, pluginId), data);
}

async function withSettingsLock<T>(
  accountId: string,
  pluginId: string,
  work: () => Promise<T>,
): Promise<T> {
  const lockKey = key(accountId, pluginId);
  const previous = settingsLocks.get(lockKey) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chain = previous.then(() => current);
  settingsLocks.set(lockKey, chain);
  await previous;
  try {
    return await work();
  } finally {
    release();
    if (settingsLocks.get(lockKey) === chain) settingsLocks.delete(lockKey);
  }
}

/**
 * プラグインを有効化して activate を呼ぶ。
 * 失敗しても例外を投げず false を返す（本体は絶対に落とさない）。
 */
export async function activatePlugin(
  accountId: string,
  pluginId: string,
  pluginDirName: string,
  permissions: string[],
  loaded?: VylinePlugin,
  manifestMain?: string,
): Promise<boolean> {
  const k = key(accountId, pluginId);
  if (active.has(k)) return true;

  let plugin: VylinePlugin | undefined = loaded;
  try {
    if (!plugin) {
      const entry = resolvePluginEntry(pluginDirName, manifestMain);
      if (!entry) throw new Error("no loadable entry file");
      const mod = (await import(entry)) as { default?: VylinePlugin };
      plugin = mod.default;
    }
    if (!plugin?.activate) throw new Error("default export is not a VylinePlugin");

    const perms = new Set<string>(permissions);
    const logger = await makeLogger(pluginId);
    const handlers = new Set<(m: PluginMessageSnapshot) => void>();

    const ctx: PluginContext = {
      accountId,
      logger,
      messages: {
        on(event, handler) {
          if (event !== "message") return () => {};
          // 権限強制: messages:read が無い場合は何も購読させない
          if (!perms.has("messages:read")) {
            logger.warn("messages.on ignored: missing permission messages:read");
            return () => {};
          }
          handlers.add(handler);
          return () => handlers.delete(handler);
        },
      },
      settings: {
        async get<T>(keyName: string, fallback: T): Promise<T> {
          if (!perms.has("settings:read")) {
            logger.warn(`settings.get('${keyName}') ignored: missing permission settings:read`);
            return fallback;
          }
          return withSettingsLock(accountId, pluginId, async () => {
            const data = await readSettingsFile(accountId, pluginId);
            return (data[keyName] as T | undefined) ?? fallback;
          });
        },
        async set<T>(keyName: string, value: T): Promise<void> {
          if (!perms.has("settings:write")) {
            logger.warn(`settings.set('${keyName}') ignored: missing permission settings:write`);
            return;
          }
          await withSettingsLock(accountId, pluginId, async () => {
            const data = await readSettingsFile(accountId, pluginId);
            data[keyName] = value;
            await writeSettingsFile(accountId, pluginId, data);
          });
        },
      },
    };

    // activate 自体も隔離（タイムアウトは不要 — 同期的な初期化を想定）
    await Promise.resolve()
      .then(() => plugin!.activate(ctx))
      .catch((err) => {
        throw err;
      });

    active.set(k, {
      accountId,
      pluginId,
      permissions: perms,
      messageHandlers: handlers,
      plugin,
      context: ctx,
    });
    logger.info(`activated (${[...perms].join(",") || "no permissions"})`);
    return true;
  } catch (err) {
    log.error(
      { accountId, pluginId, err: err instanceof Error ? err.message : String(err) },
      "plugin activation failed",
    );
    return false;
  }
}

/** プラグインを無効化する。deactivate のエラーは握りつぶす */
export async function deactivatePlugin(accountId: string, pluginId: string): Promise<void> {
  const k = key(accountId, pluginId);
  const entry = active.get(k);
  if (!entry) return;
  active.delete(k);
  try {
    await entry.plugin.deactivate(entry.context);
  } catch (error) {
    log.warn({ accountId, pluginId, error }, "plugin deactivation failed (isolated)");
  }
}

/** 受信メッセージをアクティブなプラグインへ配信する（個別にエラー隔離） */
export function dispatchPluginMessage(accountId: string, message: PluginMessageSnapshot): void {
  for (const [, entry] of active) {
    if (entry.accountId !== accountId) continue;
    for (const handler of entry.messageHandlers) {
      try {
        handler(message);
      } catch (err) {
        log.warn(
          {
            accountId,
            pluginId: entry.pluginId,
            err: err instanceof Error ? err.message : String(err),
          },
          "plugin message handler crashed (isolated)",
        );
      }
    }
  }
}

export function activePluginIdsFor(accountId: string): string[] {
  return [...active.values()].filter((e) => e.accountId === accountId).map((e) => e.pluginId);
}
