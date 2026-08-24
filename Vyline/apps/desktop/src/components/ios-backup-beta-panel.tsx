import { useEffect, useState } from "react";
import { api } from "@/api/client";
import { IconBlock, IconCheck, IconHardDrive, IconShield, IconSpark } from "@/components/icons";

type Device = NonNullable<Awaited<ReturnType<typeof api.line.listIosBackups>>["devices"]>[number];
type Session = NonNullable<Awaited<ReturnType<typeof api.line.getIosBackupSession>>["session"]>;

export function IosBackupBetaPanel({ accountId }: { accountId: string | null }) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [selected, setSelected] = useState<Device | null>(null);
  const [password, setPassword] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!accountId) return;
    setLoading(true);
    setMessage(null);
    try {
      const response = await api.line.listIosBackups(accountId);
      if (!response.ok) throw new Error(response.error ?? "バックアップを検索できませんでした");
      const found = response.devices ?? [];
      setDevices(found);
      setSelected((current) =>
        current && found.some((item) => item.udid === current.udid) ? current : (found[0] ?? null),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "バックアップの検索に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [accountId]);

  useEffect(() => {
    if (
      !session ||
      !session.id ||
      !accountId ||
      (session.status !== "pending" && session.status !== "running")
    )
      return;
    const timer = window.setInterval(async () => {
      const response = await api.line.getIosBackupSession(accountId, session.id);
      if (response.session) setSession(response.session);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [accountId, session]);

  useEffect(() => {
    if (session?.status !== "completed" || !accountId) return;
    window.dispatchEvent(
      new CustomEvent("vyline:ios-backup-restored", {
        detail: { accountId, chatMids: session.result?.restoredChatMids ?? [] },
      }),
    );
  }, [accountId, session?.status]);

  const start = async () => {
    if (!accountId || !selected || !password) return;
    setLoading(true);
    setMessage(null);
    setSession({
      id: "",
      status: "pending",
      progress: {
        stage: "starting",
        current: 0,
        total: 1,
        message: "復元処理を開始しています",
      },
      result: null,
      error: null,
      startedAt: Date.now(),
      completedAt: null,
    });
    try {
      const response = await api.line.startIosBackupRestore(accountId, selected.udid, password);
      if (!response.ok || !response.sessionId)
        throw new Error(response.error ?? "復元を開始できませんでした");
      setSession({
        id: response.sessionId,
        status: "pending",
        progress: {
          stage: "starting",
          current: 0,
          total: 1,
          message: "バックアップを準備しています",
        },
        result: null,
        error: null,
        startedAt: Date.now(),
        completedAt: null,
      });
      setPassword("");
    } catch (error) {
      setSession(null);
      setMessage(error instanceof Error ? error.message : "復元を開始できませんでした");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="mt-6 rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4">
      <div className="flex items-start gap-3">
        <IconHardDrive size={20} className="mt-0.5 shrink-0 text-[var(--vy-accent)]" />
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">iTunes / Apple Devices の復元</h3>
          <p className="mt-1 text-xs leading-relaxed text-[var(--vy-text-dim)]">
            暗号化された iPhone ローカルバックアップを復号し、トーク・チャット情報と
            復元できるメディアを Vyline
            のアカウントDBへ自動で追加します。既存データは上書きせず、元のバックアップも変更しません。
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading || !accountId}
          aria-label="再検索"
          className="rounded-lg p-2 text-[var(--vy-text-dim)] hover:bg-[var(--vy-surface-2)] disabled:opacity-50"
        >
          <IconSpark size={16} className={loading ? "animate-spin" : undefined} />
        </button>
      </div>

      <div className="mt-4 rounded-xl border border-[var(--vy-border)] bg-[var(--vy-surface)] p-3">
        {devices.length === 0 ? (
          <p className="text-xs text-[var(--vy-text-dim)]">
            バックアップが見つかりません。iTunes / Apple Devices
            で「ローカルバックアップを暗号化」を有効にして作成してください。
          </p>
        ) : (
          <div className="space-y-3">
            {devices.map((device) => (
              <button
                key={device.udid}
                type="button"
                onClick={() => setSelected(device)}
                className={`w-full rounded-lg border p-3 text-left ${selected?.udid === device.udid ? "border-[var(--vy-accent)]" : "border-[var(--vy-border)]"}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                    <IconHardDrive size={15} /> <span className="truncate">{device.name}</span>
                  </span>
                  {selected?.udid === device.udid && (
                    <IconCheck size={16} className="text-[var(--vy-accent)]" />
                  )}
                </div>
                <span className="mt-1 block truncate font-mono text-[0.65rem] text-[var(--vy-text-dim)]">
                  {device.udid}
                </span>
                {session?.status === "completed" && session.result?.deviceId === device.udid && (
                  <span className="mt-1 block text-xs text-[var(--vy-text-dim)]">
                    {new Intl.DateTimeFormat("ja-JP", {
                      year: "numeric",
                      month: "2-digit",
                      day: "2-digit",
                    }).format(new Date(session.result.restoredAt))}
                    にデータを復元済み
                  </span>
                )}
              </button>
            ))}
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <IconShield
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--vy-text-dim)]"
                />
                <input
                  aria-label="バックアップの暗号化パスワード"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="暗号化パスワード"
                  className="w-full rounded-lg border border-[var(--vy-border)] bg-[var(--vy-surface-2)] py-2 pl-9 pr-3 text-sm"
                />
              </div>
              <button
                type="button"
                onClick={() => void start()}
                disabled={loading || !selected || !password}
                className="rounded-lg px-3 py-2 text-xs font-semibold text-[var(--vy-accent-contrast)] disabled:opacity-50"
                style={{ background: "var(--vy-accent)" }}
              >
                復元開始
              </button>
            </div>
          </div>
        )}
      </div>

      {session?.progress && (
        <div className="mt-3 space-y-1.5" role="status" aria-live="polite">
          <div className="flex items-center justify-between gap-3 text-xs text-[var(--vy-text-dim)]">
            <span>{session.progress.message}</span>
            <span className="shrink-0 font-mono">
              {session.progress.current}/{session.progress.total}
            </span>
          </div>
          <div
            className="h-1.5 overflow-hidden rounded-full bg-[var(--vy-surface-2)]"
            role="progressbar"
            aria-label="iOSバックアップ復元の進捗"
            aria-valuemin={0}
            aria-valuemax={session.progress.total}
            aria-valuenow={session.progress.current}
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
        <p className="mt-3 flex items-center gap-2 text-xs text-emerald-400" role="status">
          <IconCheck size={14} />
          復元完了：{session.result.parsed.chats} チャット /{" "}
          {session.result.parsed.totalMessages.toLocaleString()} メッセージ
          {" · "}メディア {session.result.media.restored.toLocaleString()} 件
        </p>
      )}
      {session?.status === "failed" && (
        <p className="mt-3 flex items-center gap-2 text-xs text-red-400" role="alert">
          <IconBlock size={14} />
          {session.error ?? "復元に失敗しました"}
        </p>
      )}
      {message && (
        <p className="mt-3 text-xs text-red-400" role="alert">
          {message}
        </p>
      )}
      <p className="mt-3 text-[0.65rem] text-[var(--vy-text-dim)]">
        Beta：復元処理は既存のiOSバックアップAPIを使用します。元のバックアップは変更しません。
      </p>
    </section>
  );
}
