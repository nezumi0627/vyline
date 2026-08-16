/**
 * VylineFileStorage — stack/storage の FileStorage 相当を自前実装
 *
 * 1アカウント = 1 JSON ファイルの単純な KV ストア。書き込みは直列化する
 * (同時書き込みで JSON が壊れないようにキュー化)。
 */

import { mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type StorageValue = string | number | boolean | null | Record<string | number, unknown>;

export class VylineFileStorage {
  private path: string;
  private cache: Record<string, StorageValue> | null = null;
  private writeLock: Promise<void> = Promise.resolve();

  constructor(path: string) {
    this.path = path;
  }

  private load(): Record<string, StorageValue> {
    if (this.cache) return this.cache;
    let loaded: Record<string, StorageValue> = {};
    if (existsSync(this.path)) {
      try {
        loaded = JSON.parse(readFileSync(this.path, "utf-8"));
      } catch {
        loaded = {};
      }
    }
    this.cache = loaded;
    return loaded;
  }

  private persist(): Promise<void> {
    const data = this.load();
    this.writeLock = this.writeLock.then(() => {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, JSON.stringify(data, null, 2), "utf-8");
    });
    return this.writeLock;
  }

  async get(key: string): Promise<StorageValue | undefined> {
    return this.load()[key];
  }

  async set(key: string, value: StorageValue): Promise<void> {
    this.load()[key] = value;
    await this.persist();
  }

  async delete(key: string): Promise<void> {
    delete this.load()[key];
    await this.persist();
  }

  async clear(): Promise<void> {
    this.cache = {};
    await this.persist();
  }

  /** 別ストレージへ全キーをコピーする (protocol BaseStorage 互換のため用意) */
  async migrate(target: { set(key: string, value: StorageValue): Promise<void> }): Promise<void> {
    const data = this.load();
    for (const [key, value] of Object.entries(data)) {
      await target.set(key, value);
    }
  }
}
