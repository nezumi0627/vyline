/**
 * line/pluginManager.ts — プラグインレジストリ
 *
 * マニフェスト検出、保存済みのアカウント単位の有効/無効状態の読み込み、アカウント終了時のランタイム停止。
 * プラグインの実行詳細は pluginRuntime.ts、
 * ユーザー向けガイドは docs/developers/plugin-system.md を参照。
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PluginManifest, PluginPermission } from "@vyline/plugin-sdk";
import { childLogger } from "../logger.js";
import { getDataDir, getPluginDir } from "./pluginPaths.js";
import { activePluginIdsFor, deactivatePlugin, resolvePluginEntry } from "./pluginRuntime.js";

const log = childLogger("plugins");
// Keep this list aligned with the capabilities actually exposed by PluginContext.
// Declaring a permission here is an API promise: accepting a permission that has
// no corresponding context method would make a plugin appear authorized while
// silently doing nothing at runtime.
const SUPPORTED_PERMISSIONS = new Set<PluginPermission>([
  "messages:read",
  "settings:read",
  "settings:write",
]);
const MAX_PLUGIN_STATE_BYTES = 1 * 1024 * 1024;
const MAX_STATE_ACCOUNTS = 256;
const MAX_STATE_PLUGINS_PER_ACCOUNT = 256;

function statesPath(): string {
  return join(getDataDir(), "plugin-states.json");
}

interface PluginEntry extends PluginManifest {
  /** プラグインディレクトリ名（= manifest の置かれたフォルダ） */
  dir: string;
  /** エントリファイルが存在し実行可能か */
  loadable: boolean;
  /** manifest.json の実行エントリ（未指定時は index.ts / index.js）。 */
  main?: string;
}

type PluginStates = Record<string, Record<string, boolean>>;

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

export function getPluginStates(accountId: string): Record<string, boolean> {
  return loadStates()[accountId] ?? {};
}

/** Stop all in-memory plugin handlers before an account session is removed. */
export async function deactivatePluginsForAccount(accountId: string): Promise<void> {
  for (const pluginId of activePluginIdsFor(accountId)) {
    await deactivatePlugin(accountId, pluginId);
  }
}
