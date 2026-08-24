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

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  PluginContext,
  PluginLogger,
  PluginMessageSnapshot,
  VylinePlugin,
} from "@vyline/plugin-sdk";
import { childLogger } from "../logger.js";
import { PLUGIN_DIR } from "./pluginPaths.js";

const log = childLogger("plugins");

const _dir = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.VYLINE_DATA_DIR ?? join(_dir, "../../data");
const SETTINGS_DIR = join(DATA_DIR, "plugin-settings");

interface ActivePlugin {
  accountId: string;
  pluginId: string;
  permissions: Set<string>;
  messageHandlers: Set<(m: PluginMessageSnapshot) => void>;
  plugin: VylinePlugin;
  context: PluginContext;
}

const active = new Map<string, ActivePlugin>();

function key(accountId: string, pluginId: string): string {
  return `${accountId}:${pluginId}`;
}

export function isPluginActive(accountId: string, pluginId: string): boolean {
  return active.has(key(accountId, pluginId));
}

/** プラグインのエントリポイントファイルを解決する（index.ts → index.js → main） */
export function resolvePluginEntry(pluginDirName: string, manifestMain?: string): string | null {
  const dir = join(PLUGIN_DIR, pluginDirName);
  const candidates = manifestMain
    ? [join(dir, manifestMain)]
    : [join(dir, "index.ts"), join(dir, "index.js")];
  for (const c of candidates) {
    if (existsSync(c)) return c;
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

function readSettingsFile(accountId: string, pluginId: string): Record<string, unknown> {
  try {
    return JSON.parse(
      readFileSync(join(SETTINGS_DIR, `${accountId}.${pluginId}.json`), "utf8"),
    ) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeSettingsFile(
  accountId: string,
  pluginId: string,
  data: Record<string, unknown>,
): void {
  mkdirSync(SETTINGS_DIR, { recursive: true });
  writeFileSync(
    join(SETTINGS_DIR, `${accountId}.${pluginId}.json`),
    JSON.stringify(data, null, 2),
    "utf8",
  );
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
          const data = readSettingsFile(accountId, pluginId);
          return (data[keyName] as T | undefined) ?? fallback;
        },
        async set<T>(keyName: string, value: T): Promise<void> {
          if (!perms.has("settings:write")) {
            logger.warn(`settings.set('${keyName}') ignored: missing permission settings:write`);
            return;
          }
          const data = readSettingsFile(accountId, pluginId);
          data[keyName] = value;
          writeSettingsFile(accountId, pluginId, data);
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
    await entry.plugin.deactivate?.(entry.context);
  } catch (err) {
    log.warn({ accountId, pluginId, err }, "plugin deactivation failed (isolated)");
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
