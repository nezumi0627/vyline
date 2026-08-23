import { useState } from "react";
import { useStore } from "@/lib/store";
import { Toggle } from "@/components/vy-ui";

const CONSENT_KEY = "vyline:beta-feature-consent-v1";
const BLOCK_CHECK_FEATURE = "block-status-check";

type ConsentLog = Record<string, { consentedAt: string; version: string }>;

function readConsentLog(): ConsentLog {
  try {
    const raw = localStorage.getItem(CONSENT_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as ConsentLog) : {};
  } catch {
    return {};
  }
}

export function hasBetaFeatureConsent(featureId: string): boolean {
  return Boolean(readConsentLog()[featureId]);
}

function recordBetaFeatureConsent(featureId: string): boolean {
  try {
    localStorage.setItem(
      CONSENT_KEY,
      JSON.stringify({
        ...readConsentLog(),
        [featureId]: { consentedAt: new Date().toISOString(), version: "1" },
      }),
    );
    return true;
  } catch {
    // 同意ログを保存できない環境では、機能を有効化しない。
    return false;
  }
}

export function BetaSection() {
  const settings = useStore((s) => s.settings);
  const updateSetting = useStore((s) => s.updateSetting);
  const [consentPending, setConsentPending] = useState<
    "betaBlockCheckManual" | "betaBlockCheckAuto" | null
  >(null);

  const requestEnable = (key: "betaBlockCheckManual" | "betaBlockCheckAuto") => {
    if (hasBetaFeatureConsent(BLOCK_CHECK_FEATURE)) {
      updateSetting(key, true);
      return;
    }
    setConsentPending(key);
  };

  const agree = () => {
    if (!consentPending || !recordBetaFeatureConsent(BLOCK_CHECK_FEATURE)) return;
    updateSetting(consentPending, true);
    setConsentPending(null);
  };

  return (
    <Section title="ベータ機能" desc="試験的な機能です。挙動や仕様は変更される場合があります。">
      <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs leading-relaxed">
        ベータ機能の同意記録と確認結果はこの端末のローカルストレージに保存します。
        メッセージ本文を収集したり、確認結果を Vyline の外部サービスへ送信したりしません。 LINE
        との通常の通信はこの説明の対象外です。法的助言ではありません。
      </div>

      <Card>
        <Row
          title="プロフィールにブロック確認ボタンを表示"
          desc="プロフィール画面から、対象ユーザーのブロック状態を確認できるようにします。"
        >
          <Toggle
            checked={settings.betaBlockCheckManual}
            onChange={(value) =>
              value
                ? requestEnable("betaBlockCheckManual")
                : updateSetting("betaBlockCheckManual", false)
            }
            label="プロフィールのブロック確認"
          />
        </Row>
        <Row
          title="ブロックの自動確認（友だちのみ全員）"
          desc="友だち一覧を対象に、API 制限を避けるため時間をかけて順番に確認します。"
        >
          <Toggle
            checked={settings.betaBlockCheckAuto}
            onChange={(value) =>
              value
                ? requestEnable("betaBlockCheckAuto")
                : updateSetting("betaBlockCheckAuto", false)
            }
            label="自動ブロック確認"
          />
        </Row>
      </Card>

      {consentPending && (
        <div className="mt-4 rounded-xl border border-[var(--vy-border)] bg-[var(--vy-surface-2)] p-4 text-sm">
          <p className="font-semibold">ベータ機能の個別同意</p>
          <p className="mt-2 text-xs leading-relaxed text-[var(--vy-text-dim)]">
            ブロック確認機能を有効にすると、友だち一覧などの情報を端末上で処理します。
            機能ごとの同意記録は端末内だけに保存します。利用を続ける場合は同意してください。
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={agree}
              className="rounded-lg px-3 py-2 text-xs font-semibold text-[var(--vy-accent-contrast)]"
              style={{ background: "var(--vy-accent)" }}
            >
              同意して有効化
            </button>
            <button
              type="button"
              onClick={() => setConsentPending(null)}
              className="rounded-lg border border-[var(--vy-border)] px-3 py-2 text-xs"
            >
              キャンセル
            </button>
          </div>
        </div>
      )}
    </Section>
  );
}

function Row({
  title,
  desc,
  children,
}: {
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3.5">
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-[var(--vy-text-dim)]">{desc}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface)] px-4 divide-y divide-[var(--vy-border)]">
      {children}
    </div>
  );
}

function Section({
  title,
  desc,
  children,
}: {
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <div className="vy-fade-in">
      <h2 className="text-xl font-bold tracking-tight">{title}</h2>
      <p className="mt-1 mb-5 text-sm text-[var(--vy-text-dim)]">{desc}</p>
      {children}
    </div>
  );
}
