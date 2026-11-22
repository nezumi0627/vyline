/**
 * line/pluginPaths.ts — プラグイン関連パス（pluginManager / pluginRuntime 共用）
 */

import { join } from "node:path";
import { getDataDir } from "../storage/dataDir.js";

export { getDataDir };

export function getPluginDir(): string {
  return process.env.VYLINE_PLUGIN_DIR ?? join(getDataDir(), "plugins");
}
