/** One independent allowance per account, never a server-wide total. */
export const BACKUP_STORAGE_LIMIT_BYTES = 10 * 1024 ** 3;

export class BackupStorageLimitError extends Error {
  constructor() {
    super(
      "このアカウントの保存上限（10GB）を超えます。履歴・保存メディア・バックアップの使用量を確認してください。既存データは削除していません",
    );
    this.name = "BackupStorageLimitError";
  }
}
