import { useEffect, useState } from "react";
import type { AccountSettings, SavedThemeSetting } from "@vyline/types";
import { useStore, THEME_PRESETS, serializeTheme, type VyTheme } from "@/lib/store";
import { api } from "@/api/client";
import { cn } from "@/lib/utils";
import { IconCheck, IconCopyCode, IconDice } from "@/components/icons";

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  // color input requires hex; fall back to a swatch for rgba tokens
  const isHex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value);
  return (
    <label className="flex items-center justify-between gap-3 py-2">
      <span className="text-sm text-[var(--vy-text)]">{label}</span>
      <span className="flex items-center gap-2">
        <span
          className="h-8 w-8 rounded-lg border border-[var(--vy-border)]"
          style={{ background: value }}
          aria-hidden
        />
        {isHex ? (
          <input
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-label={label}
            className="h-8 w-10 cursor-pointer rounded border-0 bg-transparent p-0"
          />
        ) : (
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-label={label}
            className="w-28 rounded-lg border border-[var(--vy-border)] bg-[var(--vy-surface-2)] px-2 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)]"
          />
        )}
      </span>
    </label>
  );
}

/* Generate a random but coherent dark/light theme */
function randomTheme(base: VyTheme): VyTheme {
  const h = Math.floor(Math.random() * 360);
  const dark = Math.random() > 0.35;
  const hex = (hh: number, s: number, l: number) => {
    const a = (s * Math.min(l, 100 - l)) / 100;
    const f = (n: number) => {
      const k = (n + hh / 30) % 12;
      const c = l / 100 - (a / 100) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
      return Math.round(255 * c)
        .toString(16)
        .padStart(2, "0");
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  };
  return {
    ...base,
    id: "custom",
    name: "ランダム",
    accent: hex(h, 70, dark ? 62 : 48),
    accentContrast: dark ? "#0b0b0d" : "#ffffff",
    bg: hex(h, dark ? 22 : 20, dark ? 8 : 97),
    surface: hex(h, dark ? 20 : 16, dark ? 12 : 100),
    surface2: hex(h, dark ? 18 : 14, dark ? 17 : 94),
    sidebar: hex(h, dark ? 20 : 16, dark ? 12 : 99),
    text: dark ? "#f3f2f6" : "#1c1a22",
    textDim: hex(h, 12, dark ? 60 : 45),
    border: dark ? "rgba(255,255,255,0.09)" : "rgba(0,0,0,0.08)",
    msgIn: hex(h, dark ? 16 : 14, dark ? 18 : 100),
    msgOut: hex(h, 60, dark ? 42 : 55),
    msgInText: dark ? "#f3f2f6" : "#1c1a22",
    msgOutText: "#ffffff",
    chatBg: hex(h, dark ? 20 : 18, dark ? 7 : 95),
    radius: Number((0.6 + Math.random() * 1.1).toFixed(2)),
    pattern: (Math.random() > 0.4 ? 1 : 0) as 0 | 1,
  };
}

function parseSavedTheme(entry: SavedThemeSetting): VyTheme | null {
  try {
    const parsed = JSON.parse(entry.theme) as VyTheme;
    if (!parsed.accent || !parsed.bg || !parsed.msgIn || !parsed.msgOut) return null;
    return { ...parsed, id: "custom", name: entry.name };
  } catch {
    return null;
  }
}

function sameThemeVisuals(left: VyTheme, right: VyTheme): boolean {
  return (
    left.accent === right.accent &&
    left.bg === right.bg &&
    left.chatBg === right.chatBg &&
    left.msgIn === right.msgIn &&
    left.msgOut === right.msgOut
  );
}

export function VyThemePanel() {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const updateThemeField = useStore((s) => s.updateThemeField);
  const mid = useStore((s) => s.self.mid);

  const [expanded, setExpanded] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [copied, setCopied] = useState(false);
  const [importError, setImportError] = useState(false);
  const [accountSettings, setAccountSettings] = useState<AccountSettings | null>(null);
  const [savedName, setSavedName] = useState("");
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const savedThemes = accountSettings?.theme.savedThemes ?? [];

  useEffect(() => {
    if (!mid) {
      setAccountSettings(null);
      return;
    }
    let cancelled = false;
    setSyncLoading(true);
    setSyncMessage(null);
    void api.settings
      .account(mid)
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) throw new Error("保存テーマを読み込めませんでした");
        setAccountSettings(result.settings);
      })
      .catch((error) => {
        if (!cancelled)
          setSyncMessage(error instanceof Error ? error.message : "保存テーマを読み込めませんでした");
      })
      .finally(() => {
        if (!cancelled) setSyncLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mid]);

  async function persistThemeSettings(nextTheme: AccountSettings["theme"]): Promise<boolean> {
    if (!mid || !accountSettings) return false;
    setSyncBusy(true);
    setSyncMessage(null);
    try {
      const result = await api.settings.saveAccount(mid, { theme: nextTheme });
      if (!result.ok) throw new Error("テーマを保存できませんでした");
      setAccountSettings(result.settings);
      return true;
    } catch (error) {
      setSyncMessage(error instanceof Error ? error.message : "テーマを保存できませんでした");
      return false;
    } finally {
      setSyncBusy(false);
    }
  }

  async function saveCurrentTheme() {
    if (!mid || !accountSettings) {
      setSyncMessage("LINEアカウント情報の読み込み後に保存できます");
      return;
    }
    const name = (savedName.trim() || theme.name || "マイテーマ").slice(0, 64);
    const existing = savedThemes.find((entry) => entry.name === name);
    const id =
      existing?.id ??
      (typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `theme_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`);
    const entry: SavedThemeSetting = {
      id,
      name,
      theme: serializeTheme({ ...theme, id: "custom", name }),
      updatedAt: new Date().toISOString(),
    };
    const nextSaved = [
      entry,
      ...savedThemes.filter((item) => item.id !== id && item.name !== name),
    ].slice(0, 24);
    const ok = await persistThemeSettings({
      ...accountSettings.theme,
      savedThemes: nextSaved,
      activeSavedThemeId: id,
    });
    if (ok) {
      setSavedName("");
      setSyncMessage(`「${name}」をアカウントに保存しました`);
    }
  }

  async function applySavedTheme(entry: SavedThemeSetting) {
    const parsed = parseSavedTheme(entry);
    if (!parsed) {
      setSyncMessage("保存テーマのデータが壊れています");
      return;
    }
    setTheme(parsed);
    if (accountSettings) {
      await persistThemeSettings({
        ...accountSettings.theme,
        savedThemes,
        activeSavedThemeId: entry.id,
      });
    }
  }

  async function deleteSavedTheme(entry: SavedThemeSetting) {
    if (!accountSettings) return;
    const nextSaved = savedThemes.filter((item) => item.id !== entry.id);
    const { activeSavedThemeId: _active, ...baseThemeSettings } = accountSettings.theme;
    const ok = await persistThemeSettings({
      ...baseThemeSettings,
      savedThemes: nextSaved,
      ...(accountSettings.theme.activeSavedThemeId &&
      accountSettings.theme.activeSavedThemeId !== entry.id
        ? { activeSavedThemeId: accountSettings.theme.activeSavedThemeId }
        : {}),
    });
    if (ok) setSyncMessage(`「${entry.name}」を削除しました`);
  }

  function copyCode() {
    const code = serializeTheme(theme);
    navigator.clipboard?.writeText(code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function applyImport() {
    try {
      const parsed = JSON.parse(importText) as VyTheme;
      if (!parsed.accent || !parsed.bg) throw new Error("invalid");
      setTheme({ ...theme, ...parsed, id: "custom" });
      setImportError(false);
      setImportText("");
      setCodeOpen(false);
    } catch {
      setImportError(true);
    }
  }

  return (
    <div className="space-y-6">
      {/* presets */}
      <div>
        <p className="mb-3 text-xs font-medium text-[var(--vy-text-dim)]">プリセット</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {THEME_PRESETS.map((preset) => {
            const active =
              theme.id === preset.id ||
              (theme.accent === preset.accent &&
                theme.bg === preset.bg &&
                theme.msgOut === preset.msgOut);
            return (
              <PresetCard
                key={preset.id}
                preset={preset}
                active={active}
                onClick={() => setTheme({ ...preset })}
              />
            );
          })}
        </div>
      </div>

      {/* server-synced saved themes */}
      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-[var(--vy-text-dim)]">保存済みテーマ</p>
            <p className="mt-1 text-[0.7rem] text-[var(--vy-text-dim)]">
              LINEアカウントに保存されるため、別ブラウザからも選べます
            </p>
          </div>
          {syncLoading && (
            <span className="text-[0.7rem] text-[var(--vy-text-dim)]">同期中…</span>
          )}
        </div>
        {savedThemes.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {savedThemes.map((entry) => {
              const saved = parseSavedTheme(entry);
              if (!saved) return null;
              return (
                <div key={entry.id} className="relative">
                  <PresetCard
                    preset={saved}
                    active={sameThemeVisuals(theme, saved)}
                    onClick={() => void applySavedTheme(entry)}
                  />
                  <button
                    type="button"
                    onClick={() => void deleteSavedTheme(entry)}
                    disabled={syncBusy}
                    className="absolute bottom-2 right-2 rounded-md bg-black/45 px-1.5 py-0.5 text-[0.6rem] text-white backdrop-blur hover:bg-black/65 disabled:opacity-50"
                    aria-label={`${entry.name}を削除`}
                  >
                    削除
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-[var(--vy-border)] px-3 py-3 text-xs text-[var(--vy-text-dim)]">
            保存済みテーマはありません
          </p>
        )}
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            value={savedName}
            onChange={(e) => setSavedName(e.target.value)}
            maxLength={64}
            placeholder={theme.name || "テーマ名"}
            aria-label="保存するテーマ名"
            className="min-w-0 flex-1 rounded-xl border border-[var(--vy-border)] bg-[var(--vy-surface-2)] px-3 py-2 text-sm outline-none placeholder:text-[var(--vy-text-dim)] focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)]"
          />
          <button
            type="button"
            onClick={() => void saveCurrentTheme()}
            disabled={!mid || !accountSettings || syncLoading || syncBusy}
            className="rounded-xl bg-[var(--vy-accent)] px-4 py-2 text-sm font-semibold text-[var(--vy-accent-contrast)] disabled:opacity-45"
          >
            現在のテーマを保存
          </button>
        </div>
        {syncMessage && (
          <p className="mt-2 text-xs text-[var(--vy-text-dim)]">{syncMessage}</p>
        )}
      </div>

      {/* actions */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setTheme(randomTheme(theme))}
          className="flex items-center gap-2 rounded-xl border border-[var(--vy-border)] bg-[var(--vy-surface-2)] px-3 py-2 text-sm font-medium transition-colors hover:bg-[var(--vy-surface)]"
        >
          <IconDice size={16} />
          ランダム生成
        </button>
        <button
          type="button"
          onClick={() => setCodeOpen((v) => !v)}
          className={cn(
            "flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition-colors",
            codeOpen
              ? "border-[var(--vy-accent)] text-[var(--vy-accent)]"
              : "border-[var(--vy-border)] bg-[var(--vy-surface-2)] hover:bg-[var(--vy-surface)]",
          )}
        >
          <IconCopyCode size={16} />
          コード
        </button>
      </div>

      {codeOpen && (
        <div className="vy-scale-in space-y-3 rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface)] p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">現在のテーマを書き出し</span>
            <button
              type="button"
              onClick={copyCode}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-[var(--vy-accent-contrast)]"
              style={{ background: "var(--vy-accent)" }}
            >
              <IconCheck
                size={13}
                className={cn(copied ? "opacity-100" : "opacity-0", "transition-opacity")}
              />
              {copied ? "コピー済み" : "コピー"}
            </button>
          </div>
          <textarea
            readOnly
            value={serializeTheme(theme)}
            aria-label="テーマコード"
            className="vy-scroll h-20 w-full resize-none rounded-lg border border-[var(--vy-border)] bg-[var(--vy-surface-2)] p-2 font-mono text-[0.7rem] outline-none"
          />
          <div className="h-px bg-[var(--vy-border)]" />
          <span className="text-sm font-medium">コードから読み込み</span>
          <textarea
            value={importText}
            onChange={(e) => {
              setImportText(e.target.value);
              setImportError(false);
            }}
            placeholder="ここにテーマコードを貼り付け"
            aria-label="テーマコードを貼り付け"
            className="vy-scroll h-16 w-full resize-none rounded-lg border border-[var(--vy-border)] bg-[var(--vy-surface-2)] p-2 font-mono text-[0.7rem] outline-none placeholder:text-[var(--vy-text-dim)] focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)]"
          />
          {importError && (
            <p className="text-xs text-[var(--vy-danger)]">コードを読み込めませんでした</p>
          )}
          <button
            type="button"
            onClick={applyImport}
            disabled={!importText.trim()}
            className="w-full rounded-lg border border-[var(--vy-border)] bg-[var(--vy-surface-2)] py-2 text-sm font-medium transition-colors hover:bg-[var(--vy-surface)] disabled:opacity-40"
          >
            適用
          </button>
        </div>
      )}

      {/* custom */}
      <div>
        <p className="mb-1 text-xs font-medium text-[var(--vy-text-dim)]">カスタム</p>
        <p className="mb-3 text-xs text-[var(--vy-text-dim)]">
          値を変更すると自動で「カスタム」プリセットになります
        </p>
        <div className="rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface)] px-4 divide-y divide-[var(--vy-border)]">
          <ColorField
            label="アクセント"
            value={theme.accent}
            onChange={(v) => updateThemeField("accent", v)}
          />
          <ColorField
            label="アクセント文字色"
            value={theme.accentContrast}
            onChange={(v) => updateThemeField("accentContrast", v)}
          />
          <ColorField label="背景" value={theme.bg} onChange={(v) => updateThemeField("bg", v)} />
          <ColorField
            label="トーク背景"
            value={theme.chatBg}
            onChange={(v) => updateThemeField("chatBg", v)}
          />
          <ColorField
            label="吹き出し（相手）"
            value={theme.msgIn}
            onChange={(v) => updateThemeField("msgIn", v)}
          />
          <ColorField
            label="吹き出し（自分）"
            value={theme.msgOut}
            onChange={(v) => updateThemeField("msgOut", v)}
          />

          {expanded && (
            <>
              <ColorField
                label="サーフェス"
                value={theme.surface}
                onChange={(v) => updateThemeField("surface", v)}
              />
              <ColorField
                label="サーフェス2"
                value={theme.surface2}
                onChange={(v) => updateThemeField("surface2", v)}
              />
              <ColorField
                label="サイドバー"
                value={theme.sidebar}
                onChange={(v) => updateThemeField("sidebar", v)}
              />
              <ColorField
                label="テキスト"
                value={theme.text}
                onChange={(v) => updateThemeField("text", v)}
              />
              <ColorField
                label="テキスト（薄）"
                value={theme.textDim}
                onChange={(v) => updateThemeField("textDim", v)}
              />
              <ColorField
                label="吹き出し文字（相手）"
                value={theme.msgInText}
                onChange={(v) => updateThemeField("msgInText", v)}
              />
              <ColorField
                label="吹き出し文字（自分）"
                value={theme.msgOutText}
                onChange={(v) => updateThemeField("msgOutText", v)}
              />
            </>
          )}

          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="w-full py-2.5 text-center text-xs font-medium text-[var(--vy-accent)]"
          >
            {expanded ? "詳細カラーを隠す" : "詳細カラーを表示"}
          </button>

          <div className="py-3">
            <div className="flex items-center justify-between">
              <span className="text-sm">角丸</span>
              <span className="text-xs text-[var(--vy-text-dim)]">
                {theme.radius.toFixed(2)}rem
              </span>
            </div>
            <input
              type="range"
              min={0.2}
              max={1.8}
              step={0.05}
              value={theme.radius}
              onChange={(e) => updateThemeField("radius", Number(e.target.value))}
              aria-label="角丸"
              className="mt-2 w-full accent-[var(--vy-accent)]"
            />
          </div>

          <div className="flex items-center justify-between py-3">
            <span className="text-sm">トーク背景パターン</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => updateThemeField("pattern", 1)}
                className={cn(
                  "rounded-lg px-3 py-1 text-xs transition-colors",
                  theme.pattern === 1
                    ? "text-[var(--vy-accent-contrast)]"
                    : "bg-[var(--vy-surface-2)] text-[var(--vy-text-dim)]",
                )}
                style={theme.pattern === 1 ? { background: "var(--vy-accent)" } : undefined}
              >
                ドット
              </button>
              <button
                type="button"
                onClick={() => updateThemeField("pattern", 0)}
                className={cn(
                  "rounded-lg px-3 py-1 text-xs transition-colors",
                  theme.pattern === 0
                    ? "text-[var(--vy-accent-contrast)]"
                    : "bg-[var(--vy-surface-2)] text-[var(--vy-text-dim)]",
                )}
                style={theme.pattern === 0 ? { background: "var(--vy-accent)" } : undefined}
              >
                なし
              </button>
            </div>
          </div>

          <div className="py-3">
            <label className="flex items-center justify-between">
              <span className="text-sm">背景画像 URL</span>
            </label>
            <input
              value={theme.chatImage ?? ""}
              onChange={(e) => updateThemeField("chatImage", e.target.value)}
              placeholder="https://…（任意）"
              aria-label="背景画像 URL"
              className="mt-2 w-full rounded-lg border border-[var(--vy-border)] bg-[var(--vy-surface-2)] px-3 py-2 text-sm outline-none placeholder:text-[var(--vy-text-dim)] focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)]"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function PresetCard({
  preset,
  active,
  onClick,
}: {
  preset: VyTheme;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "relative flex flex-col gap-2 overflow-hidden rounded-xl border p-3 text-left transition-all hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)] focus-visible:outline-none",
        active ? "border-[var(--vy-accent)]" : "border-[var(--vy-border)]",
      )}
      style={{ background: preset.surface }}
    >
      <div
        className="flex h-12 items-end gap-1 rounded-lg p-1.5"
        style={{ background: preset.chatBg }}
      >
        <span className="h-4 w-8 rounded-md" style={{ background: preset.msgIn }} />
        <span className="ml-auto h-5 w-10 rounded-md" style={{ background: preset.msgOut }} />
      </div>
      <div className="flex items-center gap-2">
        <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: preset.accent }} />
        <span className="truncate text-xs font-medium" style={{ color: preset.text }}>
          {preset.name}
        </span>
      </div>
      {active && (
        <span
          className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full text-[var(--vy-accent-contrast)]"
          style={{ background: preset.accent }}
        >
          <IconCheck size={13} />
        </span>
      )}
    </button>
  );
}
