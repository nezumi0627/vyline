import { join } from "node:path";

const DEFAULT_DATA_DIR = join(import.meta.dir, "..", "..", "data");

/** Backend の永続データディレクトリ。`VYLINE_DATA_DIR` で上書きできる。 */
export function getDataDir(): string {
  return process.env.VYLINE_DATA_DIR ?? DEFAULT_DATA_DIR;
}
