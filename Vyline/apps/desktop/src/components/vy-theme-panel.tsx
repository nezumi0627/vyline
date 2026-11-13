import { tr as uiText } from "@/i18n";
import { useRef, useState } from "react";
import { Button, TextField } from "@/components/vy-ui";
import { useStore, THEME_PRESETS, serializeTheme, type VyTheme } from "@/lib/store";
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

async function encodeBackgroundImage(file: File): Promise<string> {
  if (!/^image\/(?:png|jpeg|webp|avif)$/i.test(file.type)) {
    throw new Error(uiText("PNG、JPEG、WebP、AVIF画像を選択してください"));
  }
  if (file.size > 12 * 1024 * 1024) {
    throw new Error(uiText("画像ファイルは12MB以下にしてください"));
  }
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error(uiText("画像を読み込めませんでした"));
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (value) =>
          value ? resolve(value) : reject(new Error(uiText("画像を変換できませんでした"))),
        "image/webp",
        0.82,
      );
    });
    if (blob.size > 2 * 1024 * 1024) {
      throw new Error(uiText("変換後の画像が大きすぎます。小さい画像を選択してください"));
    }
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () =>
        typeof reader.result === "string"
          ? resolve(reader.result)
          : reject(new Error(uiText("画像を読み込めませんでした")));
      reader.onerror = () => reject(new Error(uiText("画像を読み込めませんでした")));
      reader.readAsDataURL(blob);
    });
  } finally {
    bitmap.close();
  }
}

export function VyThemePanel() {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const updateThemeField = useStore((s) => s.updateThemeField);
  const betaThemeEffects = useStore((s) => s.settings.betaThemeEffects);
  const fileInput = useRef<HTMLInputElement>(null);

  const [expanded, setExpanded] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [copied, setCopied] = useState(false);
  const [importError, setImportError] = useState(false);
  const [backgroundError, setBackgroundError] = useState("");
  const [backgroundBusy, setBackgroundBusy] = useState(false);

  async function chooseBackground(file?: File) {
    if (!file) return;
    setBackgroundBusy(true);
    setBackgroundError("");
    try {
      updateThemeField("chatImage", await encodeBackgroundImage(file));
    } catch (error) {
      setBackgroundError(
        error instanceof Error ? error.message : uiText("画像を設定できませんでした"),
      );
    } finally {
      setBackgroundBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function copyCode() {
    const code = serializeTheme(theme);
    navigator.clipboard?.writeText(code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function applyImport() {
    try {
      const parsed = JSON.parse(importText) as VyTheme & Record<string, unknown>;
      if (!parsed.accent || !parsed.bg) throw new Error("invalid");
      const importedTheme = Object.fromEntries(
        Object.entries(parsed).filter(
          ([key]) => !["acrylic", "acrylicOpacity", "acrylicBlur"].includes(key),
        ),
      ) as unknown as VyTheme;
      if (
        typeof importedTheme.chatBackgroundBlur !== "number" &&
        typeof parsed.acrylicBlur === "number" &&
        Number.isFinite(parsed.acrylicBlur)
      ) {
        importedTheme.chatBackgroundBlur = Math.max(0, Math.min(24, parsed.acrylicBlur));
      }
      setTheme({ ...theme, ...importedTheme, id: "custom" });
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
        <p className="mb-3 text-xs font-medium text-[var(--vy-text-dim)]">{uiText("プリセット")}</p>
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

      {/* actions */}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => setTheme(randomTheme(theme))}>
          <IconDice size={16} />
          {uiText("ランダム生成")}{" "}
        </Button>
        <Button
          size="sm"
          variant={codeOpen ? "primary" : "secondary"}
          onClick={() => setCodeOpen((v) => !v)}
          aria-pressed={codeOpen}
        >
          <IconCopyCode size={16} />
          {uiText("コード")}{" "}
        </Button>
      </div>

      <section className="rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface)] p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">{uiText("トーク背景画像")}</h3>
            <p className="mt-1 max-w-lg text-xs leading-relaxed text-[var(--vy-text-dim)]">
              {uiText(
                "画像は端末内に保存され、背景だけをぼかします。メッセージは鮮明に表示します。",
              )}
            </p>
          </div>
          <div className="relative h-16 w-28 shrink-0 overflow-hidden rounded-lg border border-[var(--vy-border)] bg-[var(--vy-chat-bg)] sm:h-20 sm:w-36">
            {betaThemeEffects && theme.chatImage ? (
              <div
                aria-hidden="true"
                className="absolute -inset-3"
                style={{
                  backgroundImage: `url(${theme.chatImage})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                  filter: `blur(${Math.max(0, Math.min(24, theme.chatBackgroundBlur ?? 6))}px)`,
                  transform: "scale(1.08)",
                }}
              />
            ) : (
              <div
                aria-hidden="true"
                className="absolute inset-0"
                style={{
                  backgroundImage: `radial-gradient(circle at 1px 1px, color-mix(in oklab, ${theme.text} 12%, transparent) 1px, transparent 0)`,
                  backgroundSize: "14px 14px",
                }}
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <TextField
            value={theme.chatImage ?? ""}
            onChange={(event) => updateThemeField("chatImage", event.target.value)}
            placeholder={uiText("背景画像 URL")}
            aria-label={uiText("背景画像 URL")}
            disabled={!betaThemeEffects}
          />
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/avif"
              className="sr-only"
              aria-label={uiText("端末から背景画像を選択")}
              onChange={(event) => void chooseBackground(event.currentTarget.files?.[0])}
            />
            <Button
              size="sm"
              disabled={!betaThemeEffects || backgroundBusy}
              onClick={() => fileInput.current?.click()}
            >
              {backgroundBusy ? uiText("画像を処理中…") : uiText("画像を選ぶ")}
            </Button>
            {theme.chatImage && (
              <Button
                size="sm"
                variant="secondary"
                disabled={backgroundBusy}
                onClick={() => updateThemeField("chatImage", "")}
              >
                {uiText("画像を削除")}
              </Button>
            )}
          </div>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-[var(--vy-text-dim)]">
          {betaThemeEffects
            ? uiText("画像は最大1920px・WebPに変換して端末内へ保存します（最大2MB）。")
            : uiText("背景画像とぼかしは、ベータ機能から同意して有効化できます。")}
        </p>
        {backgroundError && (
          <p className="mt-2 text-xs text-[var(--vy-danger)]" role="alert">
            {backgroundError}
          </p>
        )}
        <label className="mt-4 block text-xs">
          <span className="flex justify-between gap-3">
            <span>{uiText("背景のぼかし")}</span>
            <span className="text-[var(--vy-text-dim)]">{theme.chatBackgroundBlur ?? 6}px</span>
          </span>
          <input
            type="range"
            min="0"
            max="24"
            step="1"
            value={theme.chatBackgroundBlur ?? 6}
            disabled={!betaThemeEffects || !theme.chatImage}
            onChange={(event) =>
              updateThemeField("chatBackgroundBlur", Number(event.currentTarget.value))
            }
            className="mt-2 w-full accent-[var(--vy-accent)] disabled:opacity-50"
            aria-label={uiText("背景のぼかし")}
          />
        </label>
      </section>

      {codeOpen && (
        <div className="vy-scale-in space-y-3 rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface)] p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{uiText("現在のテーマを書き出し")}</span>
            <Button variant="primary" size="sm" onClick={copyCode}>
              <IconCheck
                size={13}
                className={cn(copied ? "opacity-100" : "opacity-0", "transition-opacity")}
              />
              {copied ? "コピー済み" : "コピー"}
            </Button>
          </div>
          <textarea
            readOnly
            value={serializeTheme(theme)}
            aria-label={uiText("テーマコード")}
            className="vy-scroll h-20 w-full resize-none rounded-lg border border-[var(--vy-border)] bg-[var(--vy-surface-2)] p-2 font-mono text-[0.7rem] outline-none"
          />
          <div className="h-px bg-[var(--vy-border)]" />
          <span className="text-sm font-medium">{uiText("コードから読み込み")}</span>
          <textarea
            value={importText}
            onChange={(e) => {
              setImportText(e.target.value);
              setImportError(false);
            }}
            placeholder={uiText("ここにテーマコードを貼り付け")}
            aria-label={uiText("テーマコードを貼り付け")}
            aria-invalid={importError || undefined}
            aria-describedby={importError ? "theme-import-error" : undefined}
            className="vy-scroll h-16 w-full resize-none rounded-lg border border-[var(--vy-border)] bg-[var(--vy-surface-2)] p-2 font-mono text-[0.7rem] outline-none placeholder:text-[var(--vy-text-dim)] focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)]"
          />
          {importError && (
            <p id="theme-import-error" role="alert" className="text-xs text-[var(--vy-danger)]">
              {uiText("コードを読み込めませんでした")}{" "}
            </p>
          )}
          <Button className="w-full" onClick={applyImport} disabled={!importText.trim()}>
            {uiText("適用")}{" "}
          </Button>
        </div>
      )}

      {/* custom */}
      <div>
        <p className="mb-1 text-xs font-medium text-[var(--vy-text-dim)]">{uiText("カスタム")}</p>
        <p className="mb-3 text-xs text-[var(--vy-text-dim)]">
          {uiText("値を変更すると自動で「カスタム」プリセットになります")}{" "}
        </p>
        <div className="rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface)] px-4 divide-y divide-[var(--vy-border)]">
          <ColorField
            label={uiText("アクセント")}
            value={theme.accent}
            onChange={(v) => updateThemeField("accent", v)}
          />
          <ColorField
            label={uiText("アクセント文字色")}
            value={theme.accentContrast}
            onChange={(v) => updateThemeField("accentContrast", v)}
          />
          <ColorField
            label={uiText("背景")}
            value={theme.bg}
            onChange={(v) => updateThemeField("bg", v)}
          />
          <ColorField
            label={uiText("トーク背景")}
            value={theme.chatBg}
            onChange={(v) => updateThemeField("chatBg", v)}
          />
          <ColorField
            label={uiText("吹き出し（相手）")}
            value={theme.msgIn}
            onChange={(v) => updateThemeField("msgIn", v)}
          />
          <ColorField
            label={uiText("吹き出し（自分）")}
            value={theme.msgOut}
            onChange={(v) => updateThemeField("msgOut", v)}
          />

          {expanded && (
            <>
              <ColorField
                label={uiText("サーフェス")}
                value={theme.surface}
                onChange={(v) => updateThemeField("surface", v)}
              />
              <ColorField
                label={uiText("サーフェス2")}
                value={theme.surface2}
                onChange={(v) => updateThemeField("surface2", v)}
              />
              <ColorField
                label={uiText("サイドバー")}
                value={theme.sidebar}
                onChange={(v) => updateThemeField("sidebar", v)}
              />
              <ColorField
                label={uiText("テキスト")}
                value={theme.text}
                onChange={(v) => updateThemeField("text", v)}
              />
              <ColorField
                label={uiText("テキスト（薄）")}
                value={theme.textDim}
                onChange={(v) => updateThemeField("textDim", v)}
              />
              <ColorField
                label={uiText("吹き出し文字（相手）")}
                value={theme.msgInText}
                onChange={(v) => updateThemeField("msgInText", v)}
              />
              <ColorField
                label={uiText("吹き出し文字（自分）")}
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
              <span className="text-sm">{uiText("角丸")}</span>
              <span className="text-xs text-[var(--vy-text-dim)]">
                {theme.radius.toFixed(2)}
                {uiText("rem")}{" "}
              </span>
            </div>
            <input
              type="range"
              min={0.2}
              max={1.8}
              step={0.05}
              value={theme.radius}
              onChange={(e) => updateThemeField("radius", Number(e.target.value))}
              aria-label={uiText("角丸")}
              className="mt-2 w-full accent-[var(--vy-accent)]"
            />
          </div>

          <div className="flex items-center justify-between py-3">
            <span className="text-sm">{uiText("トーク背景パターン")}</span>
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
                {uiText("ドット")}{" "}
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
                {uiText("なし")}{" "}
              </button>
            </div>
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
