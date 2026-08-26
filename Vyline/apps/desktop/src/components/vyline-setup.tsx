import { useEffect, useState } from "react";
import type { AccountSettings } from "@vyline/types";
import { api } from "../api/client.js";

const TOTAL_STEPS = 3;

export function VylineSetup({ mid, onComplete }: { mid: string; onComplete: () => void }) {
  const [step, setStep] = useState(0);
  const [settings, setSettings] = useState<AccountSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void api.settings.account(mid).then((result) => {
      if (!result.ok) return;
      setSettings(result.settings);
      setStep(Math.min(result.settings.setup.step, TOTAL_STEPS));
      if (result.settings.setup.completed) onComplete();
    });
  }, [mid, onComplete]);

  if (!settings) return <main className="flex min-h-dvh items-center justify-center bg-[var(--vy-bg)] text-[var(--vy-text)]">セットアップを読み込んでいます…</main>;

  const next = async () => {
    setSaving(true);
    const result = await api.settings.saveSetup(mid, Math.min(step + 1, TOTAL_STEPS), settings);
    setSaving(false);
    if (!result.ok) return;
    setSettings(result.settings);
    setStep(result.settings.setup.step);
    if (result.settings.setup.completed) onComplete();
  };

  return <main className="flex min-h-dvh items-center justify-center bg-[var(--vy-bg)] px-6 text-[var(--vy-text)]"><section className="w-full max-w-xl rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface)] p-8 shadow-xl"><p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--vy-accent)]">Vyline Setup</p><h1 className="mt-3 text-2xl font-semibold">最初の環境を設定しましょう</h1><div className="mt-6 flex gap-2">{Array.from({ length: TOTAL_STEPS }, (_, index) => <span key={index} className={`h-1.5 flex-1 rounded-full ${index <= step ? "bg-[var(--vy-accent)]" : "bg-[var(--vy-border)]"}`} />)}</div><div className="mt-8 space-y-5">{step === 0 && <label className="block text-sm">表示名<input className="mt-2 w-full rounded-lg border border-[var(--vy-border)] bg-transparent p-3" value={settings.displayName} onChange={(event) => setSettings({ ...settings, displayName: event.target.value })} placeholder="この端末での表示名" /></label>}{step === 1 && <div className="space-y-4"><p className="text-sm text-[var(--vy-text-dim)]">通知とサウンド</p><Toggle label="通知を有効にする" checked={settings.notifications.enabled} onChange={(value) => setSettings({ ...settings, notifications: { ...settings.notifications, enabled: value } })} /><Toggle label="通知音を鳴らす" checked={settings.notifications.sounds} onChange={(value) => setSettings({ ...settings, notifications: { ...settings.notifications, sounds: value } })} /></div>}{step === 2 && <div className="space-y-4"><p className="text-sm text-[var(--vy-text-dim)]">プライバシーと診断</p><p className="rounded-lg bg-[var(--vy-bg)] p-4 text-sm">デバッグログは既定で有効ですが、トーク本文・認証情報・秘密鍵は収集しません。</p><Toggle label="診断ログを有効にする" checked={settings.debug.enabled} onChange={(value) => setSettings({ ...settings, debug: { ...settings.debug, enabled: value } })} /></div>}</div><button type="button" className="mt-8 w-full rounded-lg bg-[var(--vy-accent)] px-4 py-3 font-medium text-white disabled:opacity-50" disabled={saving} onClick={() => void next()}>{saving ? "保存中…" : step === TOTAL_STEPS - 1 ? "セットアップを完了" : "次へ"}</button></section></main>;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="flex items-center justify-between gap-4 text-sm"><span>{label}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /></label>;
}
