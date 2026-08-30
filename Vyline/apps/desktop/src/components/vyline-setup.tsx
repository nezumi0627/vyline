import { useCallback, useEffect, useState } from "react";
import type { AccountSettings } from "@vyline/types";
import { api } from "../api/client.js";
import { Button, SettingsRow, Toggle } from "./vy-ui.js";

const TOTAL_STEPS = 5;
const MAX_HANDOFF_FILE_BYTES = 5 * 1024 * 1024;
type Backup = NonNullable<Awaited<ReturnType<typeof api.line.backupList>>["data"]>[number];

export function VylineSetup({
  mid,
  accountId,
  profileName,
  onComplete,
}: { mid: string; accountId: string | null; profileName: string; onComplete: () => void }) {
  const [step, setStep] = useState(0);
  const [settings, setSettings] = useState<AccountSettings | null>(null);
  const [backups, setBackups] = useState<Backup[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.settings.account(mid);
      if (!result.ok) throw new Error("セットアップ設定を読み込めませんでした");
      setSettings(result.settings);
      if (result.settings.setup.completed) return onComplete();
      setStep(Math.min(result.settings.setup.step, TOTAL_STEPS - 1));
      if (accountId) {
        const listed = await api.line.backupList(accountId);
        if (listed.ok) setBackups(listed.data ?? []);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "セットアップ設定を読み込めませんでした");
    } finally {
      setLoading(false);
    }
  }, [accountId, mid, onComplete]);
  useEffect(() => {
    void load();
  }, [load]);

  const save = async (nextStep: number, next = settings) => {
    if (!next) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.settings.saveSetup(mid, nextStep, next);
      if (!result.ok) throw new Error("設定を保存できませんでした");
      setSettings(result.settings);
      result.settings.setup.completed ? onComplete() : setStep(result.settings.setup.step);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "設定を保存できませんでした");
    } finally {
      setBusy(false);
    }
  };

  const restore = async (backup: Backup) => {
    if (!accountId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.line.backupRestore(accountId, {
        backupId: backup.id,
        includeMedia: backup.includeMedia,
      });
      if (!result.ok) throw new Error(result.error ?? "バックアップを復元できませんでした");
      setMessage(`VylineBackupを復元しました（${result.restoredMessages ?? 0}件のメッセージ）`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "バックアップを復元できませんでした");
    } finally {
      setBusy(false);
    }
  };

  const chooseHandoff = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".zip,application/zip";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > MAX_HANDOFF_FILE_BYTES) return setError("引継ぎZIPは5MB以下にしてください");
      try {
        const archiveBase64 = btoa(
          String.fromCharCode(...new Uint8Array(await file.arrayBuffer())),
        );
        const preview = await api.handoff.inspect(mid, archiveBase64);
        if (!preview.ok || !preview.manifest)
          throw new Error(preview.error ?? "引継ぎZIPを確認できませんでした");
        if (!preview.matchesCurrentAccount)
          throw new Error("この引継ぎZIPは別のLINEアカウント向けです");
        if (
          !window.confirm(
            `${preview.manifest.source.platform}版・${new Date(preview.manifest.createdAt).toLocaleString()}の設定を統合します。\n対象: ${preview.files?.join(", ") ?? "設定"}`,
          )
        )
          return;
        const result = await api.handoff.import(mid, archiveBase64, "merge");
        if (!result.ok) throw new Error("引継ぎZIPを適用できませんでした");
        await load();
        setMessage("引継ぎ設定を統合しました");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "引継ぎZIPを適用できませんでした");
      }
    };
    input.click();
  };

  if (!settings)
    return (
      <main className="flex min-h-dvh items-center justify-center bg-[var(--vy-bg)] text-[var(--vy-text)]">
        <section className="w-full max-w-md space-y-4 rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface)] p-8 text-center shadow-xl">
          <h1 className="text-lg font-semibold">Vyline Setup を準備しています</h1>
          <p className="text-sm text-[var(--vy-text-dim)]">
            {loading ? "アカウント設定を読み込んでいます…" : error}
          </p>
          {!loading && (
            <Button variant="primary" onClick={() => void load()}>
              再試行
            </Button>
          )}
        </section>
      </main>
    );

  const displayName = settings.displayName || profileName || "Vyline";
  const next = () =>
    void save(
      step + 1,
      step === 0 && !settings.displayName ? { ...settings, displayName } : settings,
    );
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[var(--vy-bg)] px-6 py-8 text-[var(--vy-text)]">
      <section className="w-full max-w-2xl rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface)] p-6 shadow-xl sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--vy-accent)]">
          Vyline Setup · {step + 1}/{TOTAL_STEPS}
        </p>
        <div className="mt-5 flex gap-2">
          {Array.from({ length: TOTAL_STEPS }, (_, index) => (
            <span
              key={index}
              className={`h-1.5 flex-1 rounded-full ${index <= step ? "bg-[var(--vy-accent)]" : "bg-[var(--vy-border)]"}`}
            />
          ))}
        </div>
        <div className="mt-8 space-y-4">
          {step === 0 && (
            <>
              <h1 className="text-2xl font-semibold">おかえりなさい、{displayName} さん</h1>
              <p className="text-sm text-[var(--vy-text-dim)]">
                LINEへのログインを確認しました。以前のVylineを引き継ぐか、新しい環境を整えて始めましょう。
              </p>
            </>
          )}
          {step === 1 && (
            <>
              <h1 className="text-2xl font-semibold">以前のVylineを復元</h1>
              <p className="text-sm text-[var(--vy-text-dim)]">
                端末内の履歴バックアップか、設定引継ぎZIPを選べます。認証情報は復元されません。
              </p>
              {backups.length === 0 ? (
                <p className="rounded-lg bg-[var(--vy-bg)] p-4 text-sm">
                  この端末に復元できるVylineBackupはありません。
                </p>
              ) : (
                backups.slice(0, 3).map((backup) => (
                  <div
                    key={backup.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-[var(--vy-border)] p-3"
                  >
                    <span className="text-xs">
                      {new Date(backup.createdAt).toLocaleString()} ·{" "}
                      {backup.messageCount.toLocaleString()}件
                    </span>
                    <Button size="sm" disabled={busy} onClick={() => void restore(backup)}>
                      復元
                    </Button>
                  </div>
                ))
              )}
              <Button onClick={chooseHandoff}>設定引継ぎZIPを選択</Button>
            </>
          )}
          {step === 2 && (
            <>
              <h1 className="text-2xl font-semibold">使い心地を選ぶ</h1>
              <div className="divide-y divide-[var(--vy-border)] rounded-xl border border-[var(--vy-border)] px-4">
                <SettingsRow title="メディアを自動ダウンロード">
                  <Toggle
                    label="メディアを自動ダウンロード"
                    checked={settings.storage.autoDownload}
                    onChange={(value) =>
                      setSettings({
                        ...settings,
                        storage: { ...settings.storage, autoDownload: value },
                      })
                    }
                  />
                </SettingsRow>
                <SettingsRow title="動きを減らす">
                  <Toggle
                    label="動きを減らす"
                    checked={settings.performance.reducedMotion}
                    onChange={(value) =>
                      setSettings({
                        ...settings,
                        performance: { ...settings.performance, reducedMotion: value },
                      })
                    }
                  />
                </SettingsRow>
                <SettingsRow title="コンパクト表示">
                  <Toggle
                    label="コンパクト表示"
                    checked={settings.layout.compact}
                    onChange={(value) =>
                      setSettings({ ...settings, layout: { ...settings.layout, compact: value } })
                    }
                  />
                </SettingsRow>
              </div>
            </>
          )}
          {step === 3 && (
            <>
              <h1 className="text-2xl font-semibold">通知とプライバシー</h1>
              <div className="divide-y divide-[var(--vy-border)] rounded-xl border border-[var(--vy-border)] px-4">
                <SettingsRow title="通知を有効にする">
                  <Toggle
                    label="通知を有効にする"
                    checked={settings.notifications.enabled}
                    onChange={(value) =>
                      setSettings({
                        ...settings,
                        notifications: { ...settings.notifications, enabled: value },
                      })
                    }
                  />
                </SettingsRow>
                <SettingsRow title="通知音を鳴らす">
                  <Toggle
                    label="通知音を鳴らす"
                    checked={settings.notifications.sounds}
                    onChange={(value) =>
                      setSettings({
                        ...settings,
                        notifications: { ...settings.notifications, sounds: value },
                      })
                    }
                  />
                </SettingsRow>
                <SettingsRow title="既読を送る">
                  <Toggle
                    label="既読を送る"
                    checked={settings.privacy.showReadReceipts}
                    onChange={(value) =>
                      setSettings({
                        ...settings,
                        privacy: { ...settings.privacy, showReadReceipts: value },
                      })
                    }
                  />
                </SettingsRow>
                <SettingsRow title="サニタイズ済み診断ログを収集">
                  <Toggle
                    label="サニタイズ済み診断ログを収集"
                    checked={settings.debug.enabled}
                    onChange={(value) =>
                      setSettings({ ...settings, debug: { ...settings.debug, enabled: value } })
                    }
                  />
                </SettingsRow>
              </div>
            </>
          )}
          {step === 4 && (
            <>
              <h1 className="text-2xl font-semibold">準備完了です</h1>
              <p className="text-sm text-[var(--vy-text-dim)]">
                {displayName}{" "}
                さんのVylineを開始します。引継ぎ・VylineBackup・Desktopデータ復元は、あとから「設定
                ＞ 詳細・復元」でも利用できます。
              </p>
            </>
          )}
        </div>
        {message && <p className="mt-5 text-sm text-[var(--vy-accent)]">{message}</p>}
        {error && <p className="mt-5 text-sm text-red-300">{error}</p>}
        <div className="mt-8 flex justify-between gap-3">
          <Button
            variant="secondary"
            size="lg"
            disabled={step === 0 || busy}
            onClick={() => void save(step - 1)}
          >
            戻る
          </Button>
          <Button variant="primary" size="lg" disabled={busy} loading={busy} onClick={next}>
            {busy ? "処理中…" : step === TOTAL_STEPS - 1 ? "Vylineをはじめる" : "次へ"}
          </Button>
        </div>
      </section>
    </main>
  );
}
