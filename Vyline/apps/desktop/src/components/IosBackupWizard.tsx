import { useState, useCallback, useEffect } from "react";
import { api } from "@/api/client";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import {
  IconArrowLeft,
  IconCheck,
  IconX,
  IconAlertCircle,
  IconInfoCircle,
  IconRefreshCw,
  IconSmartphone,
  IconUsb,
  IconLock,
  IconFileText,
} from "@/components/icons";

interface IosBackupDevice {
  udid: string;
  name: string;
  iOSVersion: string;
  deviceType: string;
  encrypted: boolean;
  passcodeSet: boolean;
}

interface IosBackupSession {
  id: string;
  status: "pending" | "running" | "completed" | "failed";
  progress: {
    stage: string;
    current: number;
    total: number;
    message: string;
    file?: string;
  } | null;
  result: {
    extracted: {
      lineFiles: number;
      databases: number;
    };
    parsed: {
      chats: number;
      totalMessages: number;
    };
  } | null;
  error: string | null;
  startedAt: number;
  completedAt: number | null;
}

type WizardStep = "welcome" | "device" | "password" | "restoring" | "complete" | "error";

interface IosBackupWizardProps {
  onClose: () => void;
  onSuccess?: () => void;
}

export function IosBackupWizard({ onClose, onSuccess }: IosBackupWizardProps) {
  const accountId = useStore((s) => s.accountId);
  const [step, setStep] = useState<WizardStep>("welcome");
  const [devices, setDevices] = useState<IosBackupDevice[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<IosBackupDevice | null>(null);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [session, setSession] = useState<IosBackupSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pollInterval, setPollInterval] = useState<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    loadDevices();
    return () => {
      if (pollInterval) clearInterval(pollInterval);
    };
  }, []);

  const loadDevices = async () => {
    try {
      setLoading(true);
      const res = await api.line.listIosBackups();
      if (res.ok && res.devices) {
        setDevices(res.devices);
        if (res.devices.length === 1) {
          setSelectedDevice(res.devices[0]);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "デバイス一覧の取得に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  const startRestore = async () => {
    if (!selectedDevice || !password || !accountId) return;
    setError(null);
    setStep("restoring");

    try {
      const res = await api.line.startIosBackupRestore(accountId, {
        udid: selectedDevice.udid,
        password,
      });
      if (res.ok && res.sessionId) {
        pollSession(res.sessionId);
      } else {
        throw new Error(res.error || "復元セッションの開始に失敗しました");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "復元の開始に失敗しました");
      setStep("error");
    }
  };

  const pollSession = (sessionId: string) => {
    const interval = setInterval(async () => {
      try {
        const res = await api.line.getIosBackupSession(accountId!, sessionId);
        if (res.ok && res.session) {
          setSession(res.session);
          if (res.session.status === "completed") {
            clearInterval(interval);
            setStep("complete");
            onSuccess?.();
          } else if (res.session.status === "failed") {
            clearInterval(interval);
            setError(res.session.error || "復元に失敗しました");
            setStep("error");
          }
        }
      } catch {
        // Ignore polling errors
      }
    }, 2000);
    setPollInterval(interval);
  };

  const goBack = () => {
    switch (step) {
      case "device":
        setStep("welcome");
        break;
      case "password":
        setStep("device");
        break;
      case "restoring":
        setStep("password");
        break;
      case "complete":
      case "error":
        setStep("welcome");
        setSession(null);
        setError(null);
        break;
    }
  };

  const canProceed = () => {
    switch (step) {
      case "device":
        return !!selectedDevice;
      case "password":
        return password.length > 0;
      default:
        return false;
    }
  };

  const renderProgress = () => {
    if (!session?.progress) return null;
    const p = session.progress;
    const percent = p.total > 0 ? Math.round((p.current / p.total) * 100) : 0;
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-[var(--vy-text-dim)]">{p.message}</span>
          <span className="font-mono">{percent}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-[var(--vy-surface-2)]">
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{ background: "var(--vy-accent)", width: `${percent}%` }}
          />
        </div>
        {p.file && (
          <p className="text-[0.65rem] text-[var(--vy-text-dim)] truncate">File: {p.file}</p>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-dvh flex-col bg-[var(--vy-bg)]">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-[var(--vy-border)] bg-[var(--vy-surface)] px-4 py-3">
        {step !== "welcome" && (
          <button
            type="button"
            onClick={goBack}
            disabled={step === "restoring"}
            aria-label="戻る"
            className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--vy-text-dim)] transition-colors hover:bg-[var(--vy-surface-2)] hover:text-[var(--vy-text)] disabled:opacity-50 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)] focus-visible:outline-none"
          >
            <IconArrowLeft size={20} />
          </button>
        )}
        <h1 className="text-lg font-semibold">iOSバックアップから復元</h1>
      </header>

      <div className="flex-1 flex items-center justify-center p-4 overflow-y-auto">
        <div className="w-full max-w-md vy-fade-in">
          {step === "welcome" && <WelcomeStep onNext={() => setStep("device")} />}
          {step === "device" && <DeviceStep devices={devices} selected={selectedDevice} onSelect={setSelectedDevice} loading={loading} onNext={canProceed() ? () => setStep("password") : undefined} />}
          {step === "password" && <PasswordStep password={password} onChange={setPassword} showPassword={showPassword} onToggleShow={setShowPassword} onNext={canProceed() ? startRestore : undefined} />}
          {step === "restoring" && <RestoringStep session={session} progress={renderProgress()} />}
          {step === "complete" && <CompleteStep result={session?.result} onClose={onClose} />}
          {step === "error" && <ErrorStep error={error} onRetry={() => setStep("password")} onClose={onClose} />}
        </div>
      </div>
    </div>
  );
}

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="text-center space-y-6">
      <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-[color-mix(in_oklab,var(--vy-accent)_18%,var(--vy-surface-2))]">
        <IconSmartphone size={32} className="text-[var(--vy-accent)]" />
      </div>
      <div>
        <h2 className="text-2xl font-bold">iPhoneのトーク履歴を復元</h2>
        <p className="mt-2 text-[var(--vy-text-dim)]">
          iTunes または Apple Devices で作成した<br />
          暗号化バックアップから履歴を取り込みます
        </p>
      </div>
      <div className="rounded-xl border border-[var(--vy-border)] bg-[var(--vy-surface)] p-4 text-left space-y-3">
        <h3 className="font-medium">必要なもの</h3>
        <ul className="space-y-2 text-sm text-[var(--vy-text-dim)]">
          <li className="flex items-center gap-2"><IconCheck size={14} className="text-[var(--vy-accent)]" /> iPhone（プライマリデバイス）</li>
          <li className="flex items-center gap-2"><IconCheck size={14} className="text-[var(--vy-accent)]" /> USB ケーブル</li>
          <li className="flex items-center gap-2"><IconCheck size={14} className="text-[var(--vy-accent)]" /> iTunes または Apple Devices アプリ</li>
          <li className="flex items-center gap-2"><IconCheck size={14} className="text-[var(--vy-accent)]" /> バックアップ時の暗号化パスワード</li>
        </ul>
        <div className="mt-3 rounded-lg border border-[var(--vy-border)] bg-[var(--vy-surface-2)] p-3">
          <p className="flex items-center gap-2 text-sm text-[var(--vy-text-dim)]">
            <IconAlertCircle size={14} className="text-[var(--vy-warning)]" />
            <strong>重要:</strong> サブデバイス（iPad・セカンダリiPhone・PC版LINE）ではバックアップ作成<strong>できません</strong>
          </p>
        </div>
        <div className="mt-3 rounded-lg border border-[var(--vy-border)] bg-[var(--vy-surface-2)] p-3">
          <p className="flex items-center gap-2 text-sm text-[var(--vy-text-dim)]">
            <IconInfoCircle size={14} className="text-[var(--vy-accent)]" />
            メディア（画像・動画・音声・ファイル・スタンプ）の復元は <strong>Coming Soon</strong>
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={onNext}
        className="w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-[var(--vy-accent-contrast)]"
        style={{ background: "var(--vy-accent)" }}
      >
        始める
      </button>
    </div>
  );
}

function DeviceStep({
  devices,
  selected,
  onSelect,
  loading,
  onNext,
}: {
  devices: IosBackupDevice[];
  selected: IosBackupDevice | null;
  onSelect: (d: IosBackupDevice) => void;
  loading: boolean;
  onNext?: () => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">バックアップを選択</h2>
        <p className="mt-1 text-sm text-[var(--vy-text-dim)]">
          iTunes/Apple Devicesで作成した暗号化バックアップから選んでください
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <IconRefreshCw size={24} className="animate-spin text-[var(--vy-accent)]" />
          <span className="ml-2 text-[var(--vy-text-dim)]">検索中…</span>
        </div>
      ) : devices.length === 0 ? (
        <div className="rounded-xl border border-[var(--vy-border)] bg-[var(--vy-surface)] p-6 text-center">
          <IconX size={32} className="mx-auto mb-3 text-[var(--vy-text-dim)]" />
          <p className="text-[var(--vy-text-dim)]">バックアップが見つかりません</p>
          <p className="mt-2 text-sm text-[var(--vy-text-dim)]">
            iTunes または Apple Devices で暗号化バックアップを作成してください
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {devices.map((d) => (
            <button
              key={d.udid}
              type="button"
              onClick={() => onSelect(d)}
              className={cn(
                "w-full text-left rounded-xl border p-4 transition-all",
                selected?.udid === d.udid
                  ? "border-[var(--vy-accent)] bg-[color-mix(in_oklab,var(--vy-accent)_8%,var(--vy-surface))]"
                  : "border-[var(--vy-border)] bg-[var(--vy-surface)] hover:border-[var(--vy-accent)]",
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_oklab,var(--vy-accent)_18%,var(--vy-surface-2))]">
                    <IconSmartphone size={20} className="text-[var(--vy-accent)]" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium truncate">{d.name}</p>
                    <p className="text-xs text-[var(--vy-text-dim)]">
                      {d.deviceType} · iOS {d.iOSVersion}
                    </p>
                    <p className="text-[0.65rem] text-[var(--vy-text-dim)] font-mono mt-1">
                      {d.udid}
                    </p>
                  </div>
                </div>
                {selected?.udid === d.udid && (
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[var(--vy-accent-contrast)]" style={{ background: "var(--vy-accent)" }}>
                    <IconCheck size={14} />
                  </div>
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.6rem] font-medium", d.encrypted ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400")}>
                  {d.encrypted ? <IconLock size={10} /> : <IconX size={10} />}
                  {d.encrypted ? "暗号化済み" : "暗号化なし（使用不可）"}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.6rem] font-medium bg-[var(--vy-surface-2)] text-[var(--vy-text-dim)]">
                  {d.passcodeSet ? <IconLock size={10} /> : <IconX size={10} />}
                  パスコード設定済み
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onNext}
          disabled={!selected || !selected.encrypted || !onNext}
          className="rounded-xl px-4 py-2.5 text-sm font-semibold text-[var(--vy-accent-contrast)] disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ background: "var(--vy-accent)" }}
        >
          次へ
        </button>
      </div>
    </div>
  );
}

function PasswordStep({
  password,
  onChange,
  showPassword,
  onToggleShow,
  onNext,
}: {
  password: string;
  onChange: (v: string) => void;
  showPassword: boolean;
  onToggleShow: (v: boolean) => void;
  onNext?: () => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">暗号化パスワードを入力</h2>
        <p className="mt-1 text-sm text-[var(--vy-text-dim)]">
          iTunes/Apple Devices でバックアップ作成時に設定したパスワードです
        </p>
      </div>

      <div className="rounded-xl border border-[var(--vy-border)] bg-[var(--vy-surface)] p-4 space-y-4">
        <div>
          <label className="block text-sm font-medium mb-2">パスワード</label>
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => onChange(e.target.value)}
              placeholder="暗号化パスワード"
              className="w-full rounded-lg border border-[var(--vy-border)] bg-[var(--vy-surface-2)] px-4 py-2.5 pr-12 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)]"
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => onToggleShow(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--vy-text-dim)] hover:text-[var(--vy-text)]"
            >
              {showPassword ? <IconX size={18} /> : <IconLock size={18} />}
            </button>
          </div>
        </div>
        <p className="text-xs text-[var(--vy-text-dim)]">
          パスワードを忘れた場合は復元できません。iTunes/Apple Devicesで設定したものと同じです。
        </p>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onNext}
          disabled={!password || !onNext}
          className="rounded-xl px-4 py-2.5 text-sm font-semibold text-[var(--vy-accent-contrast)] disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ background: "var(--vy-accent)" }}
        >
          復元開始
        </button>
      </div>
    </div>
  );
}

function RestoringStep({
  session,
  progress,
}: {
  session: IosBackupSession | null;
  progress: React.ReactNode;
}) {
  const stages = [
    { key: "unlocking", label: "バックアップを解除" },
    { key: "listing", label: "LINEファイルを検索" },
    { key: "extracting", label: "ファイルを抽出" },
    { key: "messages", label: "メッセージを解析" },
    { key: "writing", label: "出力ファイル書き込み" },
    { key: "complete", label: "完了" },
  ];

  const currentStageIndex = session?.progress
    ? stages.findIndex((s) => s.key === session.progress?.stage)
    : -1;

  return (
    <div className="space-y-6 text-center">
      <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--vy-accent)_18%,var(--vy-surface-2))]">
        <IconRefreshCw size={32} className="animate-spin text-[var(--vy-accent)]" />
      </div>
      <div>
        <h2 className="text-2xl font-bold">復元中…</h2>
        <p className="mt-2 text-[var(--vy-text-dim)]">しばらくお待ちください</p>
      </div>
      {progress}
      <div className="flex justify-center gap-2">
        {stages.map((s, i) => (
          <div key={s.key} className="flex flex-col items-center gap-1">
            <div
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full text-[0.65rem] font-medium transition-colors",
                i < currentStageIndex
                  ? "bg-[var(--vy-accent)] text-[var(--vy-accent-contrast)]"
                  : i === currentStageIndex
                  ? "border-2 border-[var(--vy-accent)] text-[var(--vy-accent)]"
                  : "bg-[var(--vy-surface-2)] text-[var(--vy-text-dim)]",
              )}
            >
              {i < currentStageIndex ? <IconCheck size={14} /> : i + 1}
            </div>
            <span className={cn("text-[0.6rem] whitespace-nowrap", i <= currentStageIndex ? "text-[var(--vy-text)]" : "text-[var(--vy-text-dim)]")}>
              {s.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CompleteStep({
  result,
  onClose,
}: {
  result: IosBackupSession["result"] | null;
  onClose: () => void;
}) {
  return (
    <div className="space-y-6 text-center">
      <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-green-500/20">
        <IconCheck size={32} className="text-green-500" />
      </div>
      <div>
        <h2 className="text-2xl font-bold">復元が完了しました</h2>
        <p className="mt-2 text-[var(--vy-text-dim)]">トーク履歴が Vyline に取り込まれました</p>
      </div>
      {result && (
        <div className="rounded-xl border border-[var(--vy-border)] bg-[var(--vy-surface)] p-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-[var(--vy-text-dim)]">LINE ファイル</span>
            <span className="font-mono">{result.extracted?.lineFiles ?? 0}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-[var(--vy-text-dim)]">データベース</span>
            <span className="font-mono">{result.extracted?.databases ?? 0}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-[var(--vy-text-dim)]">チャット数</span>
            <span className="font-mono">{result.parsed?.chats ?? 0}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-[var(--vy-text-dim)]">メッセージ総数</span>
            <span className="font-mono">{(result.parsed?.totalMessages ?? 0).toLocaleString()}</span>
          </div>
        </div>
      )}
      <div className="pt-2">
        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-[var(--vy-accent-contrast)]"
          style={{ background: "var(--vy-accent)" }}
        >
          完了
        </button>
      </div>
    </div>
  );
}

function ErrorStep({
  error,
  onRetry,
  onClose,
}: {
  error: string | null;
  onRetry: () => void;
  onClose: () => void;
}) {
  return (
    <div className="space-y-6 text-center">
      <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-red-500/20">
        <IconAlertCircle size={32} className="text-red-500" />
      </div>
      <div>
        <h2 className="text-2xl font-bold">復元に失敗しました</h2>
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      </div>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onRetry}
          className="flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold text-[var(--vy-accent-contrast)]"
          style={{ background: "var(--vy-accent)" }}
        >
          再試行
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex-1 rounded-xl border border-[var(--vy-border)] px-4 py-2.5 text-sm font-medium text-[var(--vy-text-dim)] hover:bg-[var(--vy-surface-2)]"
        >
          閉じる
        </button>
      </div>
    </div>
  );
}