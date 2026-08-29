import { useEffect, useState } from "react";
import { api } from "@/api/client";
import { IconBlock, IconCheck, IconHardDrive, IconShield } from "@/components/icons";
import { markRestoredChatMids } from "@/utils/dismissedChats";

type Session = NonNullable<
  Awaited<ReturnType<typeof api.line.getAndroidBackupSession>>["session"]
>;

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function AndroidBackupPanel({ accountId }: { accountId: string | null }) {
  const [file, setFile] = useState<File | null>(null);
  const [includeMedia, setIncludeMedia] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setFile(null);
    setSession(null);
    setMessage(null);
  }, [accountId]);

  useEffect(() => {
    if (
      !session?.id ||
      !accountId ||
      (session.status !== "pending" && session.status !== "running")
    ) {
      return;
    }
    const timer = window.setInterval(async () => {
      try {
        const response = await api.line.getAndroidBackupSession(accountId, session.id);
        if (response.session) setSession(response.session);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "復元状態の取得に失敗しました");
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [accountId, session?.id, session?.status]);

  useEffect(() => {
    if (session?.status !== "completed" || !accountId) return;
    const chatMids = session.result?.restoredChatMids ?? [];
    markRestoredChatMids(accountId, chatMids);
    window.dispatchEvent(
      new CustomEvent("vyline:android-backup-restored", {
        detail: { accountId, chatMids },
      }),
    );
  }, [accountId, session?.status]);

  const start = async () => {
    if (!accountId || !file || loading) return;
    setLoading(true);
    setMessage(null);
    setSession(null);
    try {
      const response = await api.line.startAndroidBackupRestore(accountId, file, includeMedia);
      if (!response.ok || !response.sessionId) {
        throw new Error(response.error ?? "Android DBの復元を開始できませんでした");
      }
      setSession({
        id: response.sessionId,
        accountId,
        sourceName: file.name || "naver_line",
        includeMedia,
        status: "pending",
        progress: {
          stage: "starting",
          current: 0,
          total: 1,
          message: "Android DBの解析を開始しています",
        },
        result: null,
        error: null,
        startedAt: Date.now(),
        completedAt: null,
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Android DBの復元を開始できませんでした");
    } finally {
      setLoading(false);
    }
  };

  const busy =
    loading || session?.status === "pending" || session?.status === "running";

  return (
    <section className="mt-6 rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface)] p-4">
      <div className="flex items-start gap-3">
        <IconHardDrive size={20} className="mt-0.5 shrink-0 text-[var(--vy-accent)]" />
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">Android LINE DB から復元</h3>
          <p className="mt-1 text-xs leading-relaxed text-[var(--vy-text-dim)]">
            Android から取得した <span className="font-mono">naver_line</span> SQLite DB、または
            LEINs 一括バックアップ ZIP を読み込み、トーク履歴を現在の Vyline
            アカウントへ統合します。既存履歴と元ファイルは変更しません。
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-3 rounded-xl border border-[var(--vy-border)] bg-[var(--vy-surface-2)] p-3">
        <label className="block cursor-pointer rounded-lg border border-dashed border-[var(--vy-border)] bg-[var(--vy-surface)] p-3 transition hover:border-[var(--vy-accent)]">
          <span className="block text-xs font-medium">DB / バックアップZIPを選択</span>
          <span className="mt-1 block text-[0.65rem] text-[var(--vy-text-dim)]">
            拡張子なしの naver_line、.db、SQLite、.zip に対応
          </span>
          <input
            type="file"
            className="mt-2 block w-full text-xs text-[var(--vy-text-dim)] file:mr-3 file:rounded-md file:border-0 file:bg-[var(--vy-accent)] file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-[var(--vy-accent-contrast)]"
            disabled={busy || !accountId}
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setSession(null);
              setMessage(null);
            }}
          />
        </label>

        {file && (
          <div className="flex items-center justify-between gap-3 rounded-lg bg-[var(--vy-surface)] px-3 py-2 text-xs">
            <span className="min-w-0 truncate font-mono">{file.name || "naver_line"}</span>
            <span className="shrink-0 text-[var(--vy-text-dim)]">{formatBytes(file.size)}</span>
          </div>
        )}

        <label className="flex items-start gap-2 text-xs text-[var(--vy-text-dim)]">
          <input
            type="checkbox"
            checked={includeMedia}
            disabled={busy}
            onChange={(event) => setIncludeMedia(event.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[var(--vy-accent)]"
          />
          <span>
            ZIP 内の保存済み画像・動画・音声・ファイルも復元する
            <span className="mt-0.5 block text-[0.65rem] opacity-80">
              生のDBだけを選んだ場合は無視されます。ZIPが大きい場合は容量を多く使用します。
            </span>
          </span>
        </label>

        <div className="flex items-start gap-2 rounded-lg border border-[var(--vy-border)] bg-[var(--vy-surface)] px-3 py-2 text-[0.65rem] leading-relaxed text-[var(--vy-text-dim)]">
          <IconShield size={14} className="mt-0.5 shrink-0" />
          <span>
            選択中の Vyline アカウントと、DBを取得したLINEアカウントが同じことを確認してください。
            メッセージIDが一致する既存履歴は重複追加しません。
          </span>
        </div>

        <button
          type="button"
          onClick={() => void start()}
          disabled={!accountId || !file || busy}
          className="w-full rounded-lg px-3 py-2 text-xs font-semibold text-[var(--vy-accent-contrast)] disabled:opacity-50"
          style={{ background: "var(--vy-accent)" }}
        >
          {loading ? "アップロード中…" : busy ? "復元中…" : "Android DBから復元"}
        </button>
      </div>

      {session?.progress && (
        <div className="mt-3 space-y-1.5" role="status" aria-live="polite">
          <div className="flex items-center justify-between gap-3 text-xs text-[var(--vy-text-dim)]">
            <span className="min-w-0 truncate">
              {session.progress.message}
              {session.progress.file ? ` · ${session.progress.file}` : ""}
            </span>
            <span className="shrink-0 font-mono">
              {session.progress.total > 0
                ? `${Math.min(100, Math.round((session.progress.current / session.progress.total) * 100))}%`
                : "0%"}
            </span>
          </div>
          <div
            className="h-1.5 overflow-hidden rounded-full bg-[var(--vy-surface-2)]"
            role="progressbar"
            aria-label="Android DB復元の進捗"
            aria-valuemin={0}
            aria-valuemax={Math.max(1, session.progress.total)}
            aria-valuenow={Math.min(session.progress.current, Math.max(1, session.progress.total))}
          >
            <div
              className="h-full rounded-full bg-[var(--vy-accent)] transition-[width] duration-300"
              style={{
                width: `${session.progress.total > 0 ? Math.min(100, (session.progress.current / session.progress.total) * 100) : 0}%`,
              }}
            />
          </div>
        </div>
      )}

      {session?.status === "completed" && session.result && (
        <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs">
          <p className="flex items-center gap-2 text-emerald-400" role="status">
            <IconCheck size={14} />
            復元完了：{session.result.parsed.chats} チャット /{" "}
            {session.result.parsed.totalMessages.toLocaleString()} メッセージ
          </p>
          <p className="mt-1 text-[0.65rem] leading-relaxed text-[var(--vy-text-dim)]">
            DB v{session.result.databaseVersion} · 新規メッセージ {session.result.merged.importedMessages.toLocaleString()}
            件 · 重複 {session.result.merged.skippedMessages.toLocaleString()} 件 · リアクション {session.result.parsed.reactions.toLocaleString()} 件
            {session.result.media.restored > 0
              ? ` · メディア ${session.result.media.restored.toLocaleString()} 件`
              : ""}
            {session.result.parsed.unsupportedReactions > 0
              ? ` · 表示未対応カスタムリアクション ${session.result.parsed.unsupportedReactions.toLocaleString()} 件（データ保持）`
              : ""}
          </p>
        </div>
      )}

      {session?.status === "failed" && (
        <p className="mt-3 flex items-center gap-2 text-xs text-red-400" role="alert">
          <IconBlock size={14} />
          {session.error ?? "Android DBの復元に失敗しました"}
        </p>
      )}
      {message && (
        <p className="mt-3 text-xs text-red-400" role="alert">
          {message}
        </p>
      )}
    </section>
  );
}
