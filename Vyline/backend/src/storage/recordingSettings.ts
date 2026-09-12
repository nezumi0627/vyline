import { randomUUID } from "node:crypto";
import { realpath, stat, lstat, opendir } from "node:fs/promises";
import { basename, dirname, delimiter, isAbsolute, join, relative, resolve, sep } from "node:path";
import type {
  RecordingPathSuggestions,
  RecordingPreferences,
  RecordingTarget,
} from "@vyline/types";
import {
  type CallRecordingStore,
  RecordingError,
  getCallRecordingStore,
} from "./callRecordingStore.js";
import { protectSecret, unprotectSecret } from "./secureStore.js";
import { VYLINE_STORAGE_DIR } from "./vylineStorageInfo.js";
import { validateWebDavUrl, type WebDavConnection } from "./recordingWebDav.js";

type StoredTarget = RecordingTarget & { secret?: string; protected?: boolean };
type TargetInput = Omit<RecordingTarget, "id" | "hasPassword"> & { password?: string };
const defaults: RecordingPreferences = {
  automatic: false,
  kind: "audio",
  retentionDays: 30,
  targetId: null,
  consentAccepted: false,
};
function isWithin(root: string, path: string) {
  const child = relative(root, path);
  return child === "" || (child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child));
}
export class RecordingSettings {
  private browsing = 0;
  constructor(
    private store: CallRecordingStore,
    readonly roots = [
      VYLINE_STORAGE_DIR,
      ...(process.env.VYLINE_RECORDING_ALLOWED_ROOTS?.split(delimiter).filter(Boolean) ?? []),
    ],
  ) {
    store.db.exec(`CREATE TABLE IF NOT EXISTS recording_settings(owner TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS recording_targets(id TEXT PRIMARY KEY, owner TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS recording_target_owner ON recording_targets(owner);`);
  }
  get(owner: string): RecordingPreferences {
    const row = this.store.db
      .query("SELECT data FROM recording_settings WHERE owner = ?")
      .get(owner) as { data: string } | null;
    return row ? JSON.parse(row.data) : { ...defaults };
  }
  save(owner: string, input: RecordingPreferences) {
    if (
      typeof input.automatic !== "boolean" ||
      typeof input.consentAccepted !== "boolean" ||
      !["audio", "video"].includes(input.kind) ||
      !Number.isInteger(input.retentionDays) ||
      input.retentionDays < 0 ||
      input.retentionDays > 3650 ||
      (input.targetId !== null && typeof input.targetId !== "string")
    )
      throw new RecordingError("録音・録画の設定が正しくありません");
    if (input.automatic && !input.consentAccepted)
      throw new RecordingError(
        "自動記録を有効にする前に、相手への同意確認について確認してください",
      );
    if (input.targetId) this.target(owner, input.targetId);
    const value: RecordingPreferences = {
      automatic: input.automatic,
      kind: input.kind,
      retentionDays: input.retentionDays,
      targetId: input.targetId,
      consentAccepted: input.consentAccepted,
    };
    this.store.db
      .query(
        "INSERT INTO recording_settings VALUES (?, ?) ON CONFLICT(owner) DO UPDATE SET data = excluded.data",
      )
      .run(owner, JSON.stringify(value));
    return value;
  }
  targets(owner: string): RecordingTarget[] {
    return (
      this.store.db
        .query("SELECT data FROM recording_targets WHERE owner = ? ORDER BY rowid")
        .all(owner) as { data: string }[]
    ).map(({ data }) => {
      const { secret, protected: _protected, ...target }: StoredTarget = JSON.parse(data);
      return { ...target, hasPassword: !!secret };
    });
  }
  private storedTarget(owner: string, id: string): StoredTarget {
    const row = this.store.db
      .query("SELECT data FROM recording_targets WHERE owner = ? AND id = ?")
      .get(owner, id) as { data: string } | null;
    if (!row) throw new RecordingError("保存先が見つかりません", 404);
    return JSON.parse(row.data);
  }
  target(owner: string, id: string): RecordingTarget {
    const { secret, protected: _protected, ...target } = this.storedTarget(owner, id);
    return { ...target, hasPassword: !!secret };
  }
  private async allowedRoots() {
    const paths = await Promise.all(
      this.roots.map(async (root) => {
        try {
          const path = await realpath(root);
          return (await stat(path)).isDirectory() ? path : null;
        } catch {
          return null;
        }
      }),
    );
    return [...new Set(paths.filter((path): path is string => path !== null))].sort(
      (a, b) => b.length - a.length,
    );
  }
  private async allowedPath(path: string): Promise<string> {
    if (!isAbsolute(path) || path.length > 2048)
      throw new RecordingError("サーバー内の絶対パスを入力してください");
    const absolute = resolve(path);
    for (const root of await this.allowedRoots()) {
      if (!isWithin(root, absolute)) continue;
      const parts = relative(root, absolute).split(sep).filter(Boolean);
      if (parts.length > 64) throw new RecordingError("保存先の階層が深すぎます");
      let current = root;
      // Check each component without following links before resolving a deeper path.
      for (const part of parts) {
        current = join(current, part);
        const info = await lstat(current).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
          throw error;
        });
        if (!info) break;
        if (info.isSymbolicLink()) throw new RecordingError("保存先のリンクは使用できません");
      }
      return absolute;
    }
    throw new RecordingError(
      "許可された保存ルートの外です。外部ディスクはサーバーにマウントし、VYLINE_RECORDING_ALLOWED_ROOTSへ追加してください",
    );
  }
  async localPath(path: string): Promise<string> {
    const absolute = await this.allowedPath(path);
    const canonical = await realpath(absolute).catch(() => {
      throw new RecordingError(
        "保存先が見つかりません。ディスクのマウントと権限を確認してください",
      );
    });
    if (relative(canonical, absolute) !== "" || !(await stat(canonical)).isDirectory())
      throw new RecordingError("保存先にはリンクではないフォルダーを指定してください");
    return canonical;
  }
  async suggestPaths(prefix: string): Promise<RecordingPathSuggestions> {
    if (typeof prefix !== "string" || prefix.length > 2048 || /[\x00-\x1f]/.test(prefix))
      throw new RecordingError("保存先の入力が正しくありません");
    const managed = (path: string) =>
      path.split(/[\\/]/).some((part) => /^[0-9a-f]{64}$/i.test(part));
    if (managed(prefix)) throw new RecordingError("アカウント管理用フォルダーは候補に表示しません");
    if (this.browsing >= 4) throw new RecordingError("保存先を検索中です。再試行してください", 429);
    this.browsing++;
    try {
      const roots = (await this.allowedRoots()).filter((path) => !managed(path));
      const match = (value: string, text: string) =>
        process.platform === "win32"
          ? value
              .replaceAll("/", "\\")
              .toLowerCase()
              .startsWith(text.replaceAll("/", "\\").toLowerCase())
          : value.startsWith(text);
      const matchingRoots = roots.filter((root) => match(root, prefix) && root !== prefix);
      const root = isAbsolute(prefix)
        ? roots.find((root) => isWithin(root, resolve(prefix)))
        : undefined;
      if (!root && (!prefix || matchingRoots.length))
        return { items: matchingRoots.sort().slice(0, 20), truncated: matchingRoots.length > 20 };
      if (
        root &&
        relative(root, resolve(prefix))
          .split(sep)
          .some((part) => part.startsWith("."))
      )
        throw new RecordingError("隠しフォルダーは候補に表示しません");
      const absolute = await this.allowedPath(prefix);
      const info = await lstat(absolute).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
        throw error;
      });
      if (info?.isSymbolicLink()) throw new RecordingError("保存先のリンクは使用できません");
      const directory = await this.localPath(info?.isDirectory() ? absolute : dirname(absolute));
      const needle = info?.isDirectory() ? "" : basename(absolute);
      const entries = await opendir(directory);
      const items: string[] = [];
      let scanned = 0;
      let truncated = false;
      try {
        // Roots are administrator-controlled. Recheck before reading/releasing names;
        // this is not an openat-style guarantee against a hostile local OS user.
        await this.localPath(directory);
        for await (const entry of entries) {
          scanned++;
          if (
            entry.isDirectory() &&
            !entry.name.startsWith(".") &&
            !managed(entry.name) &&
            match(entry.name, needle)
          ) {
            const path = join(directory, entry.name);
            if (relative(this.store.root, path) !== "") items.push(path);
          }
          // ponytail: bounded autocomplete, not a full file browser; add paging if needed.
          if (items.length > 20 || scanned >= 512) {
            truncated = true;
            break;
          }
        }
        await this.localPath(directory);
      } finally {
        await entries.close().catch(() => {});
      }
      return { items: items.sort().slice(0, 20), truncated };
    } finally {
      this.browsing--;
    }
  }
  async localDirectory(owner: string, id: string): Promise<string> {
    const target = this.target(owner, id);
    if (target.kind !== "local") throw new RecordingError("ローカル保存先ではありません");
    return this.localPath(target.path);
  }
  async connection(owner: string, id: string): Promise<WebDavConnection> {
    const target = this.storedTarget(owner, id);
    if (target.kind !== "webdav") throw new RecordingError("WebDAV保存先ではありません");
    return {
      path: target.path,
      username: target.username ?? "",
      password: target.secret
        ? target.protected
          ? await unprotectSecret(target.secret)
          : target.secret
        : "",
      allowPrivateNetwork: target.allowPrivateNetwork ?? false,
      allowInsecureHttp: target.allowInsecureHttp ?? false,
    };
  }
  async addTarget(owner: string, input: TargetInput): Promise<RecordingTarget> {
    if (
      !input ||
      typeof input.name !== "string" ||
      !input.name.trim() ||
      input.name.length > 80 ||
      typeof input.path !== "string" ||
      input.path.length > 2048 ||
      !["local", "webdav"].includes(input.kind) ||
      (input.username !== undefined &&
        (typeof input.username !== "string" ||
          input.username.length > 256 ||
          input.username.includes(":"))) ||
      (input.password !== undefined &&
        (typeof input.password !== "string" || input.password.length > 4096)) ||
      (input.allowPrivateNetwork !== undefined && typeof input.allowPrivateNetwork !== "boolean") ||
      (input.allowInsecureHttp !== undefined && typeof input.allowInsecureHttp !== "boolean")
    )
      throw new RecordingError("保存先の設定が正しくありません");
    // No await after the second count: concurrent submissions cannot bypass this small bound.
    let path: string;
    if (input.kind === "local") path = await this.localPath(input.path);
    else path = (await validateWebDavUrl(input)).url.toString();
    const secret = input.password
      ? process.platform === "win32"
        ? await protectSecret(input.password)
        : input.password
      : undefined;
    if (this.targets(owner).length >= 16)
      throw new RecordingError("保存先は16件までです。未使用の保存先を削除してください", 409);
    const target: StoredTarget = {
      id: randomUUID(),
      name: input.name.trim(),
      kind: input.kind,
      path,
      ...(input.kind === "webdav"
        ? {
            username: input.username ?? "",
            allowPrivateNetwork: input.allowPrivateNetwork ?? false,
            allowInsecureHttp: input.allowInsecureHttp ?? false,
            ...(secret ? { secret, protected: process.platform === "win32" } : {}),
          }
        : {}),
    };
    this.store.db
      .query("INSERT INTO recording_targets VALUES (?, ?, ?)")
      .run(target.id, owner, JSON.stringify(target));
    return this.target(owner, target.id);
  }
  removeTarget(owner: string, id: string) {
    this.target(owner, id);
    if (
      this.store.db
        .query(
          "SELECT 1 FROM recordings WHERE owner = ? AND json_extract(data, '$.targetId') = ? LIMIT 1",
        )
        .get(owner, id)
    )
      throw new RecordingError(
        "この保存先に記録が残っています。記録を削除してから保存先を削除してください",
        409,
      );
    this.store.db.transaction(() => {
      const preferences = this.get(owner);
      if (preferences.targetId === id) this.save(owner, { ...preferences, targetId: null });
      this.store.db
        .query("DELETE FROM recording_targets WHERE owner = ? AND id = ?")
        .run(owner, id);
    })();
  }
}
let shared: RecordingSettings | undefined;
export const getRecordingSettings = () =>
  (shared ??= new RecordingSettings(getCallRecordingStore()));
