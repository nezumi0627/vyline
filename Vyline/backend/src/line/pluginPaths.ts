/**
 * line/pluginPaths.ts — プラグイン関連パス（pluginManager / pluginRuntime 共用）
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const _dir = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.VYLINE_DATA_DIR ?? join(_dir, "../../data");
export const PLUGIN_DIR = process.env.VYLINE_PLUGIN_DIR ?? join(DATA_DIR, "plugins");
