import { useCallback, useEffect, useMemo, useState } from "react";
import type { CallRecording } from "@vyline/types";
import {
  recordingClient,
  recordingFileUrl,
  type RecordingSettingsResponse,
} from "@/api/recordings";
import { useStore } from "@/lib/store";
import { requestControllerConfirm } from "@/ui/controller-dialog";
import { startSerialPoll } from "@/lib/serialPoll";
import { RecordingSettings } from "./recording-settings";

export function CallRecordingLibrary() {
  const owner = useStore((state) => state.accountId);
  return owner ? <Library key={owner} owner={owner} /> : <p>アカウントにログインしてください。</p>;
}
function Library({ owner }: { owner: string }) {
  const client = useMemo(() => recordingClient(owner), [owner]);
  const [settings, setSettings] = useState<RecordingSettingsResponse | null>(null);
  const [items, setItems] = useState<CallRecording[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const loadSettings = useCallback(async () => {
    setSettings(await client.settings());
  }, [client]);
  const load = useCallback(
    async (after?: string) => {
      const result = await client.list(after);
      setItems((previous) =>
        after
          ? [
              ...previous,
              ...result.items.filter((item) => !previous.some((old) => old.id === item.id)),
            ]
          : result.items,
      );
      setCursor(result.nextCursor);
    },
    [client],
  );
  useEffect(() => {
    let cancelled = false;
    void Promise.all([client.settings(), client.list()])
      .then(([config, list]) => {
        if (cancelled) return;
        setSettings(config);
        setItems(list.items);
        setCursor(list.nextCursor);
      })
      .catch((failure: Error) => {
        if (!cancelled) setError(failure.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client]);
  const pending = items.some((item) => item.state === "recording" || item.transfer === "pending");
  useEffect(() => {
    if (!pending) return;
    let cancelled = false;
    const stop = startSerialPoll(
      async () => {
        const result = await client.list();
        if (!cancelled)
          setItems((previous) => [
            ...result.items,
            ...previous.filter((item) => !result.items.some((fresh) => fresh.id === item.id)),
          ]);
        return !cancelled;
      },
      {
        intervalMs: 10_000,
        runImmediately: false,
        pauseWhenHidden: true,
        onError: (failure) => {
          if (!cancelled)
            setError(failure instanceof Error ? failure.message : "一覧を更新できませんでした");
        },
      },
    );
    return () => {
      cancelled = true;
      stop();
    };
  }, [client, pending]);
  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "記録を処理できませんでした");
    } finally {
      setBusy(false);
    }
  }
  const button =
    "inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--vy-border)] px-3 text-sm disabled:opacity-40";
  return (
    <section aria-label="保存した通話記録" className="space-y-5">
      <header className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">通話記録</h2>
        <button
          type="button"
          className={button}
          disabled={busy || loading}
          onClick={() =>
            void run(async () => {
              await Promise.all([load(), loadSettings()]);
            })
          }
        >
          一覧を更新
        </button>
      </header>
      <p className="text-sm text-[var(--vy-text-dim)]">
        このアカウントで記録した通話です。録音・録画は通話画面から開始できます。
      </p>
      {settings && <RecordingSettings initial={settings} client={client} reload={loadSettings} />}
      {error && (
        <p role="alert" className="break-words text-sm text-[var(--vy-danger)]">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status">記録を読み込んでいます…</p>
      ) : !items.length ? (
        <p role="status" className="py-6 text-sm text-[var(--vy-text-dim)]">
          まだ通話記録はありません。
        </p>
      ) : (
        <ul className="divide-y divide-[var(--vy-border)]">
          {items.map((item) => (
            <li key={item.id} data-native-kind="section" className="space-y-3 py-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="break-words text-sm font-semibold">{item.title || "通話記録"}</h3>
                  <p className="mt-1 text-xs text-[var(--vy-text-dim)]">
                    {new Date(item.createdAt).toLocaleString("ja-JP")} ·{" "}
                    {item.kind === "video" ? "録画" : "録音"}
                  </p>
                </div>
                <span className="shrink-0 text-xs">
                  {item.state === "recording"
                    ? "記録中"
                    : item.state === "interrupted"
                      ? "中断"
                      : "保存済み"}
                </span>
              </div>
              <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--vy-text-dim)]">
                <span>
                  {Math.floor(item.durationMs / 60_000)}分{Math.floor(item.durationMs / 1000) % 60}
                  秒 · {(item.bytes / 1024 ** 2).toFixed(1)} MiB
                </span>
                {" · "}
                <span>
                  {item.expiresAt === null
                      ? "無期限"
                    : `保存期限 ${new Date(item.expiresAt).toLocaleDateString("ja-JP")}`}
                </span>
                {" · "}
                <span>
                  {settings?.targets.find((target) => target.id === item.targetId)?.name ??
                    "標準ストレージ"}
                </span>
              </p>
              {item.transfer && (
                <p className="text-xs text-[var(--vy-text-dim)]">
                  {item.transfer === "complete"
                    ? "WebDAV転送済み"
                    : item.transfer === "pending"
                      ? "WebDAVへ転送待ち・転送中（サーバー内にも保持）"
                      : "WebDAVへの転送に失敗しました。サーバー内の記録は保持されています。"}
                </p>
              )}
              {item.state === "interrupted" && (
                <p className="text-xs text-[var(--vy-text-dim)]">
                  保存できた部分のみ残っています。終了処理が完了していない場合は再生できないことがあります。
                </p>
              )}
              {item.state !== "recording" && item.bytes > 0 && (
                <details>
                  <summary className="cursor-pointer py-3 text-sm">再生</summary>
                  {item.kind === "video" ? (
                    <video
                      className="max-h-96 w-full rounded-lg bg-black"
                      controls
                      playsInline
                      preload="none"
                      src={recordingFileUrl(owner, item.id)}
                      aria-label={`${item.title}の録画`}
                    />
                  ) : (
                    <audio
                      className="w-full"
                      controls
                      preload="none"
                      src={recordingFileUrl(owner, item.id)}
                      aria-label={`${item.title}の録音`}
                    />
                  )}
                </details>
              )}
              <div className="flex flex-wrap gap-2">
                {item.state !== "recording" && item.bytes > 0 && (
                  <a className={button} href={recordingFileUrl(owner, item.id, true)} download>
                    ダウンロード
                  </a>
                )}
                {item.transfer === "error" && (
                  <button
                    type="button"
                    className={button}
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await client.retry(item.id);
                        await load();
                      })
                    }
                  >
                    WebDAVへ再送
                  </button>
                )}
                <button
                  type="button"
                  className={`${button} text-[var(--vy-danger)]`}
                  disabled={busy || item.state === "recording"}
                  onClick={() => {
                    const recordingId = item.id;
                    const recordingTitle = item.title || "通話記録";
                    void (async () => {
                      const confirmed = await requestControllerConfirm(
                        `「${recordingTitle}」を完全に削除しますか？ WebDAV上のコピーも削除され、元に戻せません。`,
                        { title: "記録の削除", acceptLabel: "削除する", cancelFirst: true },
                      );
                      if (!confirmed) return;
                      await run(async () => {
                        await client.remove(recordingId);
                        setItems((previous) => previous.filter((row) => row.id !== recordingId));
                      });
                    })();
                  }}
                >
                  記録を削除
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {cursor && (
        <button
          type="button"
          className={button}
          disabled={busy}
          onClick={() => void run(() => load(cursor))}
        >
          以前の記録を読み込む
        </button>
      )}
    </section>
  );
}
