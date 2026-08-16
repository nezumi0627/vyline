/**
 * NezuStorage — Nezu ブランドの永続 JSON ストレージ
 *
 * data/nezu-{namespace}-{accountId}.json に debounce 書き込み。
 * メモリ優先・ディスクは起動時 hydrate / 定期 flush。
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { childLogger } from "../logger.js";

const log = childLogger("NezuStorage");
const _dir = dirname(fileURLToPath(import.meta.url));
const DATA_DIR =
  process.env["VYLINE_DATA_DIR"] ?? join(_dir, "..", "..", "data");

const SAVE_DEBOUNCE_MS = Number(process.env["VYLINE_NEZU_SAVE_MS"] ?? 350);

export class NezuStorage<T extends object> {
  readonly namespace: string;
  private readonly memory = new Map<string, T>();
  private readonly dirty = new Set<string>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly factory: () => T;

  constructor(namespace: string, empty: () => T) {
    this.namespace = namespace;
    this.factory = empty;
  }

  private path(accountId: string): string {
    return join(DATA_DIR, `nezu-${this.namespace}-${accountId}.json`);
  }

  peek(accountId: string): T | undefined {
    return this.memory.get(accountId);
  }

  async load(accountId: string): Promise<T> {
    const cached = this.memory.get(accountId);
    if (cached) return cached;

    const p = this.path(accountId);
    if (!existsSync(p)) {
      const empty = this.factory();
      this.memory.set(accountId, empty);
      return empty;
    }

    try {
      const raw = await readFile(p, "utf8");
      const parsed = JSON.parse(raw) as T;
      this.memory.set(accountId, parsed);
      return parsed;
    } catch (err) {
      log.warn({ accountId, namespace: this.namespace, err }, "NezuStorage load failed");
      const empty = this.factory();
      this.memory.set(accountId, empty);
      return empty;
    }
  }

  /** メモリ上を即更新し、debounce でディスクへ */
  async mutate(accountId: string, fn: (data: T) => void): Promise<T> {
    const data = await this.load(accountId);
    fn(data);
    this.memory.set(accountId, data);
    this.scheduleSave(accountId);
    return data;
  }

  async replace(accountId: string, data: T): Promise<void> {
    this.memory.set(accountId, data);
    this.scheduleSave(accountId);
  }

  private scheduleSave(accountId: string): void {
    this.dirty.add(accountId);
    const prev = this.timers.get(accountId);
    if (prev) clearTimeout(prev);
    this.timers.set(
      accountId,
      setTimeout(() => {
        void this.flush(accountId);
      }, SAVE_DEBOUNCE_MS),
    );
  }

  async flush(accountId: string): Promise<void> {
    if (!this.dirty.has(accountId)) return;
    this.dirty.delete(accountId);
    const data = this.memory.get(accountId);
    if (!data) return;
    try {
      await mkdir(DATA_DIR, { recursive: true });
      await writeFile(this.path(accountId), JSON.stringify(data), "utf8");
    } catch (err) {
      this.dirty.add(accountId);
      log.warn({ accountId, namespace: this.namespace, err }, "NezuStorage flush failed");
    }
  }

  async flushAll(): Promise<void> {
    await Promise.all([...this.dirty].map((id) => this.flush(id)));
  }
}
