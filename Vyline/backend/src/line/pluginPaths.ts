/**
 * line/pluginPaths.ts — プラグイン関連パス（pluginManager / pluginRuntime 共用）
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const _dir = dirname(fileURLToPath(import.meta.url));
const defaultDataDir = join(_dir, "../../data");

export function getDataDir(): string {
  return process.env.VYLINE_DATA_DIR ?? defaultDataDir;
}

export function getPluginDir(): string {
  return process.env.VYLINE_PLUGIN_DIR ?? join(getDataDir(), "plugins");
}
