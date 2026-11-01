import { useEffect, useRef, useState } from "react";
import { ThemeApplier } from "@/components/theme-applier";
import { Avatar, Button, SettingsRow, TextField, Toggle } from "@/components/vy-ui";
import { THEME_PRESETS, useStore } from "@/lib/store";
import type { AnimationMode } from "@/lib/store-types";

const CATALOG_THEMES = ["telegram-night", "soft-day", "line-dark"];

export function UiCatalogPage() {
  const theme = useStore((state) => state.theme);
  const animationMode = useStore((state) => state.settings.animationMode);
  const setTheme = useStore((state) => state.setTheme);
  const updateSetting = useStore((state) => state.updateSetting);
  const initialTheme = useRef(theme);
  const initialAnimationMode = useRef(animationMode);
  const [enabled, setEnabled] = useState(true);

  useEffect(
    () => () => {
      setTheme(initialTheme.current);
      updateSetting("animationMode", initialAnimationMode.current);
    },
    [setTheme, updateSetting],
  );

  return (
    <>
      <ThemeApplier />
      <main className="min-h-dvh bg-[var(--vy-bg)] px-4 py-8 text-[var(--vy-text)] sm:px-6 lg:px-10">
        <div className="mx-auto max-w-5xl space-y-6">
          <header className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--vy-accent)]">
              Vyline UI Catalog
            </p>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">共有UIの状態確認</h1>
            <p className="max-w-2xl text-sm leading-relaxed text-[var(--vy-text-dim)]">
              実際のテーマ変数を使い、操作状態・長文・狭い画面・モーション設定をまとめて確認します。
              このページで変更したテーマとアニメーション設定は、ページを離れると元に戻ります。
            </p>
          </header>

          <section className="grid gap-4 rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface)] p-4 sm:grid-cols-2 sm:p-5">
            <div>
              <p className="mb-2 text-xs font-semibold text-[var(--vy-text-dim)]">Theme</p>
              <div className="flex flex-wrap gap-2">
                {CATALOG_THEMES.map((id) => {
                  const preset = THEME_PRESETS.find((item) => item.id === id);
                  if (!preset) return null;
                  return (
                    <Button
                      key={preset.id}
                      size="sm"
                      variant={theme.id === preset.id ? "primary" : "secondary"}
                      aria-pressed={theme.id === preset.id}
                      onClick={() => setTheme({ ...preset })}
                    >
                      {preset.name}
                    </Button>
                  );
                })}
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold text-[var(--vy-text-dim)]">Motion</p>
              <div className="flex flex-wrap gap-2">
                {(["vyline", "feather", "none"] as AnimationMode[]).map((mode) => (
                  <Button
                    key={mode}
                    size="sm"
                    variant={animationMode === mode ? "primary" : "secondary"}
                    aria-pressed={animationMode === mode}
                    onClick={() => updateSetting("animationMode", mode)}
                  >
                    {mode}
                  </Button>
                ))}
              </div>
            </div>
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <CatalogCard
              title="Button"
              description="hover / active はポインター操作、focus-visible は Tab 操作で確認。"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="primary">Primary</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="ghost">Ghost</Button>
                <Button size="sm">Small</Button>
                <Button size="lg">Large</Button>
                <Button disabled>Disabled</Button>
                <Button loading>Loading</Button>
              </div>
            </CatalogCard>

            <CatalogCard
              title="TextField"
              description="通常・エラー・無効・長文を同じ寸法系で比較。"
            >
              <div className="space-y-3">
                <TextField defaultValue="nezumi0627" aria-label="通常入力" />
                <TextField
                  invalid
                  defaultValue="invalid-value"
                  aria-label="エラー入力"
                  aria-describedby="catalog-text-field-error"
                />
                <p
                  id="catalog-text-field-error"
                  role="alert"
                  className="text-xs text-[var(--vy-danger)]"
                >
                  入力内容を確認してください
                </p>
                <TextField disabled defaultValue="編集できない値" aria-label="無効入力" />
                <TextField
                  defaultValue="とても長い入力でも高さやフォーカス表示が崩れず、狭い画面では自然に横幅へ収まることを確認するためのサンプルです。"
                  aria-label="長文入力"
                />
              </div>
            </CatalogCard>

            <CatalogCard
              title="Toggle + SettingsRow"
              description="44px級の操作領域と、説明文が長い場合の整列を確認。"
            >
              <div className="divide-y divide-[var(--vy-border)] rounded-xl border border-[var(--vy-border)] px-4">
                <SettingsRow title="通知を有効にする" description="短い説明文の標準状態です。">
                  <Toggle checked={enabled} onChange={setEnabled} label="通知を有効にする" />
                </SettingsRow>
                <SettingsRow
                  title="かなり長い設定名でも本文側がつぶれないことを確認する項目"
                  description="説明が2行以上になってもスイッチの操作領域を保ち、文字とコントロールが重ならないことを確認します。"
                >
                  <Toggle
                    checked={!enabled}
                    onChange={(value) => setEnabled(!value)}
                    label="長文設定"
                  />
                </SettingsRow>
                <SettingsRow title="変更できない設定">
                  <Toggle checked disabled onChange={() => undefined} label="変更できない設定" />
                </SettingsRow>
              </div>
            </CatalogCard>

            <CatalogCard title="Avatar" description="既存の会話UI向け表現はそのまま維持。">
              <div className="flex flex-wrap items-end gap-5">
                <Avatar glyph="ね" color="var(--vy-accent)" size={36} />
                <Avatar glyph="V" color="#6d7cf6" size={48} ring />
                <Avatar glyph="A" color="#3f8f6f" size={56} online />
              </div>
            </CatalogCard>
          </div>

          <CatalogCard
            title="Long text / narrow viewport"
            description="375px前後でも横スクロールを発生させないための確認用。"
          >
            <p className="break-words text-sm leading-7 text-[var(--vy-text-dim)]">
              Vylineはメッセージクライアントなので、UIの派手さよりも読み続けたときの疲れにくさを優先します。
              共有コンポーネントは必要な部分だけに限定し、チャットバブル・サイドバー・メディア表示など、意味を持つ固有形状は無理に共通化しません。
            </p>
          </CatalogCard>
        </div>
      </main>
    </>
  );
}

function CatalogCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface)] p-4 sm:p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-1 mb-4 text-xs leading-relaxed text-[var(--vy-text-dim)]">{description}</p>
      {children}
    </section>
  );
}
