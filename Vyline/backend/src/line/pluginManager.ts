/**
 * line/pluginManager.ts — プラグインレジストリ（基盤）
 *
 * 現状はマニフェストの検出と有効/無効状態の管理のみを行う。
 * プラグインコードの実行（activate/deactivate）は権限サンドボックス設計後に有効化する。
 * 詳細: README「Plugin System」/ docs/developer-guide/plugin-system.md
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PluginManifest } from "@vyline/plugin-sdk";
import { childLogger } from "../logger.js";

const log = childLogger("plugins");

const _dir = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.VYLINE_DATA_DIR ?? join(_dir, "../../data");
const PLUGIN_DIR = process.env.VYLINE_PLUGIN_DIR ?? join(DATA_DIR, "plugins");
const STATES_PATH = join(DATA_DIR, "plugin-states.json");

export interface PluginEntry extends PluginManifest {
  /** プラグインコードの実行は未対応（サンドボックス設計待ち）。常に true */
  runtimePending: true;
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
    require("node:fs").writeFileSync(STATES_PATH, JSON.stringify(states, null, 2), "utf8");
  } catch (err) {
    log.warn({ err }, "failed to save plugin states");
  }
}

/** プラグインディレクトリを走査し manifest.json を読む（コードは実行しない） */
export function listPlugins(): PluginEntry[] {
  if (!existsSync(PLUGIN_DIR)) return [];
  const out: PluginEntry[] = [];
  for (const entry of readdirSync(PLUGIN_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(PLUGIN_DIR, entry.name, "manifest.json");
    if (!existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Partial<PluginManifest>;
      if (!manifest.id || !manifest.name) continue;
      out.push({
        id: manifest.id,
        name: manifest.name,
        version: manifest.version ?? "0.0.0",
        ...(manifest.description ? { description: manifest.description } : {}),
        permissions: Array.isArray(manifest.permissions) ? manifest.permissions : [],
        runtimePending: true,
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

export function setPluginState(accountId: string, pluginId: string, enabled: boolean): void {
  const states = loadStates();
  const known = new Set(listPlugins().map((p) => p.id));
  if (!known.has(pluginId)) {
    throw new Error(`unknown plugin: ${pluginId}`);
  }
  states[accountId] = states[accountId] ?? {};
  states[accountId]![pluginId] = enabled;
  saveStates(states);
}
