import { useEffect, useState } from "react";
import type { BackupStorageUsage } from "@vyline/types";
import { api } from "@/api/client";
import { useAuthStore } from "@/stores/authStore";
import { useStore } from "@/lib/store";
import { onAppEvent } from "@/lib/appEvents";

function formatStorageBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(3, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

// 初回表示では保存済みの全アカウント行が同時に mount される。旧バックエンドや
// 初回 SQLite 集計の再構築中でも Pi に重い照会を重ねないよう、容量照会だけを
// 小さな直列キューへ通す。メッセージ同期や通常 API はこのキューの対象外。
let storageRequestTail: Promise<void> = Promise.resolve();

function queuedBackupStorage(accountId: string) {
  const request = storageRequestTail
    .catch(() => undefined)
    .then(() => api.line.backupStorage(accountId));
  storageRequestTail = request.then(
    () => undefined,
    () => undefined,
  );
  return request;
}

function AccountStorageRow({
  accountId,
  label,
  selected,
}: { accountId: string; label: string; selected: boolean }) {
  const [usage, setUsage] = useState<BackupStorageUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const refresh = (event: { accountId: string }) => {
      if (event.accountId === accountId) setRevision((value) => value + 1);
    };
    const offChange = onAppEvent("backup:changed", refresh);
    const offRestore = onAppEvent("backup:restored", refresh);
    return () => {
      offChange();
      offRestore();
    };
  }, [accountId]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void queuedBackupStorage(accountId)
      .then((result) => {
        if (!active) return;
        if (!result.ok || result.storage?.accountId !== accountId)
          throw new Error(result.error ?? "容量を取得できませんでした");
        setUsage(result.storage);
      })
      .catch((error) => {
        if (active) setError(error instanceof Error ? error.message : "容量を取得できませんでした");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [accountId, revision]);
  return (
    <li
      className="space-y-2 border-t border-[var(--vy-border)] py-3 first:border-0"
      aria-label={`${label}の保存容量`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="min-w-0 break-all font-medium">
          {label}
          {selected ? "（選択中）" : ""}
        </span>
        <button
          type="button"
          disabled={loading}
          onClick={() => setRevision((value) => value + 1)}
          className="rounded border border-[var(--vy-border)] px-2 py-1 disabled:opacity-50"
        >
          {loading ? "取得中…" : "更新"}
        </button>
      </div>
      {usage && (
        <>
          <p className="text-sm font-medium tabular-nums">
            {formatStorageBytes(usage.usedBytes)} / {formatStorageBytes(usage.limitBytes)}
            <span className="ml-2 text-xs text-[var(--vy-text-dim)]">
              残り {formatStorageBytes(usage.remainingBytes)}
            </span>
          </p>
          <progress
            aria-label={`${label}の使用量`}
            value={Math.min(usage.usedBytes, usage.limitBytes)}
            max={usage.limitBytes}
            className="h-2 w-full overflow-hidden rounded-full bg-[var(--vy-surface-2)] [&::-webkit-progress-bar]:bg-[var(--vy-surface-2)] [&::-webkit-progress-value]:bg-[var(--vy-accent)] [&::-moz-progress-bar]:bg-[var(--vy-accent)]"
          />
          <p className="text-xs leading-relaxed text-[var(--vy-text-dim)]">
            履歴 {formatStorageBytes(usage.historyBytes)} · メディア{" "}
            {formatStorageBytes(usage.mediaBytes)} · バックアップ{" "}
            {formatStorageBytes(usage.backupBytes)}
          </p>
          {usage.usedBytes >= usage.limitBytes && (
            <p className="text-xs text-red-400">
              保存上限に達しています。既存データは自動削除しません。
            </p>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-400">
          {error}
        </p>
      )}
    </li>
  );
}

export function AccountBackupStorage({ accountId }: { accountId: string | null }) {
  const accounts = useAuthStore((state) => state.accounts);
  const saved = useAuthStore((state) => state.saved);
  const sessions = useAuthStore((state) => state.sessions);
  const streamerMode = useStore((state) => state.settings.streamerMode);
  const ids = [...new Set([...(accountId ? [accountId] : []), ...accounts, ...saved])];
  return (
    <section className="my-4 rounded-xl border border-[var(--vy-border)] bg-[var(--vy-surface)] p-4">
      <h3 className="text-sm font-semibold">アカウント別の保存容量</h3>
      <p className="mt-1 text-xs leading-relaxed text-[var(--vy-text-dim)]">
        各アカウントに10GBずつ。履歴・保存メディア・バックアップを集計します。他アカウントや共有キャッシュは含みません。
      </p>
      {ids.length ? (
        <ul className="mt-2">
          {ids.map((id, index) => (
            <AccountStorageRow
              key={id}
              accountId={id}
              label={
                streamerMode
                  ? `アカウント ${index + 1}`
                  : sessions.find((session) => session.accountId === id)?.displayName || id
              }
              selected={id === accountId}
            />
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs text-[var(--vy-text-dim)]">
          ログインすると使用量を確認できます。
        </p>
      )}
    </section>
  );
}
