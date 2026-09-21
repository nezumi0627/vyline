/**
 * line/pluginManager.ts — プラグインレジストリ
 *
 * マニフェスト検出 + アカウント単位の有効/無効状態の永続化 + 実行ランタイムの起動。
 * プラグインの実行詳細は pluginRuntime.ts、
 * ユーザー向けガイドは docs/developer-guide/plugin-system.md を参照。
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PluginManifest, PluginPermission } from "@vyline/plugin-sdk";
import { childLogger } from "../logger.js";
import { getDataDir, getPluginDir } from "./pluginPaths.js";
import {
  activatePlugin,
  activePluginIdsFor,
  deactivatePlugin,
  resolvePluginEntry,
} from "./pluginRuntime.js";

const log = childLogger("plugins");
const SUPPORTED_PERMISSIONS = new Set<PluginPermission>([
  "messages:read",
  "messages:send",
  "chats:read",
  "media:read",
  "media:write",
  "storage:read",
  "storage:write",
  "notifications:send",
  "ui:extend",
  "network:request",
  "settings:read",
  "settings:write",
]);
const MAX_PLUGIN_STATE_BYTES = 1 * 1024 * 1024;
const MAX_STATE_ACCOUNTS = 256;
const MAX_STATE_PLUGINS_PER_ACCOUNT = 256;

function statesPath(): string {
  return join(getDataDir(), "plugin-states.json");
}

export interface PluginEntry extends PluginManifest {
  /** プラグインディレクトリ名（= manifest の置かれたフォルダ） */
  dir: string;
  /** エントリファイルが存在し実行可能か */
  loadable: boolean;
  /** manifest.json の実行エントリ（未指定時は index.ts / index.js）。 */
  main?: string;
}

type PluginStates = Record<string, Record<string, boolean>>;
const pluginStateWrites = new Map<string, Promise<void>>();

/** Serialize per-account state transitions and their read-modify-write. */
export function withPluginStateLock<T>(accountId: string, work: () => Promise<T>): Promise<T> {
  const previous = pluginStateWrites.get(accountId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(work);
  const marker = next.then(
    () => undefined,
    () => undefined,
  );
  pluginStateWrites.set(accountId, marker);
  return next.finally(() => {
    if (pluginStateWrites.get(accountId) === marker) pluginStateWrites.delete(accountId);
  });
}

function loadStates(): PluginStates {
  try {
    const raw = readFileSync(statesPath(), "utf8");
    if (Buffer.byteLength(raw) > MAX_PLUGIN_STATE_BYTES) {
      log.warn("plugin state file exceeds the size limit");
      return {};
    }
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const states: PluginStates = {};
    for (const [accountId, rawPlugins] of Object.entries(parsed)) {
      if (Object.keys(states).length >= MAX_STATE_ACCOUNTS) break;
      if (!rawPlugins || typeof rawPlugins !== "object" || Array.isArray(rawPlugins)) continue;
      const plugins: Record<string, boolean> = {};
      for (const [pluginId, enabled] of Object.entries(rawPlugins)) {
        if (Object.keys(plugins).length >= MAX_STATE_PLUGINS_PER_ACCOUNT) break;
        if (typeof enabled === "boolean") plugins[pluginId] = enabled;
      }
      states[accountId] = plugins;
    }
    return states;
  } catch {
    return {};
  }
}

function saveStates(states: PluginStates): void {
  try {
    writeFileSync(statesPath(), JSON.stringify(states, null, 2), "utf8");
  } catch (err) {
    log.warn({ err }, "failed to save plugin states");
  }
}

/** プラグインディレクトリを走査し manifest.json を読む（この関数自体はコードを実行しない） */
export function listPlugins(): PluginEntry[] {
  const pluginDir = getPluginDir();
  if (!existsSync(pluginDir)) return [];
  const out: PluginEntry[] = [];
  const seenIds = new Set<string>();
  for (const entry of readdirSync(pluginDir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(pluginDir, entry.name, "manifest.json");
    if (!existsSync(manifestPath)) continue;
    try {
      const raw = JSON.parse(readFileSync(manifestPath, "utf8")) as Partial<PluginManifest> & {
        main?: string;
      };
      if (!raw.id || !raw.name) continue;
      if (seenIds.has(raw.id)) {
        log.warn({ pluginId: raw.id, plugin: entry.name }, "duplicate plugin id ignored");
        continue;
      }
      const permissions = Array.isArray(raw.permissions) ? raw.permissions : [];
      if (
        permissions.some((permission) => !SUPPORTED_PERMISSIONS.has(permission as PluginPermission))
      ) {
        log.warn({ pluginId: raw.id, plugin: entry.name }, "plugin has unsupported permission");
        continue;
      }
      seenIds.add(raw.id);
      out.push({
        id: raw.id,
        name: raw.name,
        version: raw.version ?? "0.0.0",
        ...(raw.description ? { description: raw.description } : {}),
        permissions: permissions as PluginPermission[],
        dir: entry.name,
        loadable: resolvePluginEntry(entry.name, raw.main) != null,
        ...(raw.main ? { main: raw.main } : {}),
      });
    } catch (err) {
      log.warn({ plugin: entry.name, err }, "invalid plugin manifest");
    }
  }
  return out;
}

function findPluginDir(pluginId: string): string | null {
  return listPlugins().find((p) => p.id === pluginId)?.dir ?? null;
}

export function getPluginStates(accountId: string): Record<string, boolean> {
  return loadStates()[accountId] ?? {};
}

async function applyPluginStateNow(
  accountId: string,
  entry: PluginEntry,
  enabled: boolean,
): Promise<void> {
  const pluginId = entry.id;

  if (enabled) {
    if (!entry.loadable) throw new Error("plugin has no index.ts / index.js entry");
    const ok = await activatePlugin(
      accountId,
      pluginId,
      entry.dir,
      entry.permissions ?? [],
      undefined,
      entry.main,
    );
    if (!ok) throw new Error("plugin activation failed (see backend logs)");
  } else {
    await deactivatePlugin(accountId, pluginId);
  }

  const states = loadStates();
  states[accountId] = states[accountId] ?? {};
  states[accountId]![pluginId] = enabled;
  saveStates(states);
}

async function applyPluginState(
  accountId: string,
  entry: PluginEntry,
  enabled: boolean,
): Promise<void> {
  await withPluginStateLock(accountId, () => applyPluginStateNow(accountId, entry, enabled));
}

/**
 * 有効/無効を永続化し、ランタイムへも反映する。
 * activate 失敗時は状態を disabled に戻してエラーを返す（本体は落とさない）。
 */
export async function setPluginState(
  accountId: string,
  pluginId: string,
  enabled: boolean,
): Promise<void> {
  const entry = listPlugins().find((p) => p.id === pluginId);
  if (!entry) throw new Error(`unknown plugin: ${pluginId}`);
  await applyPluginState(accountId, entry, enabled);
}

/** バックエンド再起動後に、そのアカウントで有効化済みのローカルプラグインを戻す。 */
export async function restoreEnabledPlugins(accountId: string): Promise<void> {
  const enabled = getPluginStates(accountId);
  for (const plugin of listPlugins()) {
    if (!enabled[plugin.id]) continue;
    try {
      await applyPluginState(accountId, plugin, true);
    } catch (error) {
      log.warn({ accountId, pluginId: plugin.id, error }, "saved plugin was not restored");
    }
  }
}

/** Stop all in-memory plugin handlers before an account session is removed. */
export async function deactivatePluginsForAccount(accountId: string): Promise<void> {
  for (const pluginId of activePluginIdsFor(accountId)) {
    await deactivatePlugin(accountId, pluginId);
  }
}
