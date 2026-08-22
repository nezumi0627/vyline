/**
 * VylineStorage — Vyline ブランドの永続 JSON ストレージ
 *
 * data/vyline-{namespace}-{accountId}.json に debounce 書き込み。
 * メモリ優先・ディスクは起動時 hydrate / 定期 flush。
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { childLogger } from "../logger.js";
import { accountDir, readAccountJson } from "./accountDirs.js";

const log = childLogger("VylineStorage");
const _dir = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.VYLINE_DATA_DIR ?? join(_dir, "..", "..", "data");

const SAVE_DEBOUNCE_MS = Number(process.env.VYLINE_CACHE_SAVE_MS ?? 350);

export class VylineStorage<T extends object> {
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
    return join(accountDir(accountId), `vyline-${this.namespace}.json`);
  }
  private legacyPath(accountId: string): string {
    return join(DATA_DIR, `vyline-${this.namespace}-${accountId}.json`);
  }

  peek(accountId: string): T | undefined {
    return this.memory.get(accountId);
  }

  async load(accountId: string): Promise<T> {
    const cached = this.memory.get(accountId);
    if (cached) return cached;

    const p = this.path(accountId);
    if (!existsSync(p)) {
      // 旧フラット (vyline-<ns>-<id>.json / nezu-<ns>-<id>.json) からの移行:
      // あれば読んで accounts/<id>/ へ保存
      const legacy = await readAccountJson<T>(
        accountId,
        `vyline-${this.namespace}.json`,
        this.legacyPath(accountId),
      );
      if (!legacy) {
        const nezuLegacy = join(DATA_DIR, `nezu-${this.namespace}-${accountId}.json`);
        if (existsSync(nezuLegacy)) {
          try {
            const parsed = JSON.parse(await readFile(nezuLegacy, "utf8")) as T;
            this.memory.set(accountId, parsed);
            await mkdir(dirname(p), { recursive: true });
            await writeFile(p, JSON.stringify(parsed), "utf8");
            return parsed;
          } catch {
            // fallthrough to empty
          }
        }
        const empty = this.factory();
        this.memory.set(accountId, empty);
        return empty;
      }
      this.memory.set(accountId, legacy);
      return legacy;
    }

    try {
      const raw = await readFile(p, "utf8");
      const parsed = JSON.parse(raw) as T;
      this.memory.set(accountId, parsed);
      return parsed;
    } catch (err) {
      log.warn({ accountId, namespace: this.namespace, err }, "VylineStorage load failed");
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
      await writeFile(
        this.path(accountId),
        JSON.stringify(data, (key, value) => {
          if (typeof value === "bigint") return value.toString();
          return value;
        }),
        "utf8",
      );
    } catch (err) {
      this.dirty.add(accountId);
      log.warn({ accountId, namespace: this.namespace, err }, "VylineStorage flush failed");
    }
  }

  async flushAll(): Promise<void> {
    await Promise.all([...this.dirty].map((id) => this.flush(id)));
  }
}
