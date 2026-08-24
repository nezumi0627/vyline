/**
 * line/pluginManager.ts — プラグインレジストリ
 *
 * マニフェスト検出 + アカウント単位の有効/無効状態の永続化 + 実行ランタイムの起動。
 * プラグインの実行詳細は pluginRuntime.ts、
 * ユーザー向けガイドは docs/developer-guide/plugin-system.md を参照。
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PluginManifest } from "@vyline/plugin-sdk";
import { childLogger } from "../logger.js";
import { DATA_DIR, PLUGIN_DIR } from "./pluginPaths.js";
import { activatePlugin, deactivatePlugin, resolvePluginEntry } from "./pluginRuntime.js";

const log = childLogger("plugins");

const STATES_PATH = join(DATA_DIR, "plugin-states.json");

export interface PluginEntry extends PluginManifest {
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
    return JSON.parse(readFileSync(STATES_PATH, "utf8")) as PluginStates;
  } catch {
    return {};
  }
}

function saveStates(states: PluginStates): void {
  try {
    writeFileSync(STATES_PATH, JSON.stringify(states, null, 2), "utf8");
  } catch (err) {
    log.warn({ err }, "failed to save plugin states");
  }
}

/** プラグインディレクトリを走査し manifest.json を読む（この関数自体はコードを実行しない） */
export function listPlugins(): PluginEntry[] {
  if (!existsSync(PLUGIN_DIR)) return [];
  const out: PluginEntry[] = [];
  for (const entry of readdirSync(PLUGIN_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(PLUGIN_DIR, entry.name, "manifest.json");
    if (!existsSync(manifestPath)) continue;
    try {
      const raw = JSON.parse(readFileSync(manifestPath, "utf8")) as Partial<PluginManifest> & {
        main?: string;
      };
      if (!raw.id || !raw.name) continue;
      out.push({
        id: raw.id,
        name: raw.name,
        version: raw.version ?? "0.0.0",
        ...(raw.description ? { description: raw.description } : {}),
        permissions: Array.isArray(raw.permissions) ? raw.permissions : [],
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

/** バックエンド再起動後に、そのアカウントで有効化済みのローカルプラグインを戻す。 */
export async function restoreEnabledPlugins(accountId: string): Promise<void> {
  const enabled = getPluginStates(accountId);
  for (const plugin of listPlugins()) {
    if (!enabled[plugin.id]) continue;
    try {
      await setPluginState(accountId, plugin.id, true);
    } catch (err) {
      log.warn({ accountId, pluginId: plugin.id, err }, "saved plugin was not restored");
    }
  }
}
