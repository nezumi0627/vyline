import { useState } from "react";
import { useStore, UPDATE_NOTES } from "@/lib/store";
import { Button, SettingsRow, Toggle } from "@/components/vy-ui";
import { WindowsLineTokenBetaPanel } from "@/components/windows-line-token-beta-panel";
import {
  betaFeatureIdForSetting,
  hasBetaFeatureConsent as isBetaFeatureConsentActive,
  recordBetaFeatureDecision,
} from "@/lib/betaConsent";

export function BetaSection() {
  const settings = useStore((s) => s.settings);
  const updateSetting = useStore((s) => s.updateSetting);
  const accountId = useStore((s) => s.accountId);
  const [consentPending, setConsentPending] = useState(false);

  const requestEnable = () => {
    if (isBetaFeatureConsentActive(betaFeatureIdForSetting("betaWindowsLineTokens"))) {
      updateSetting("betaWindowsLineTokens", true);
      return;
    }
    setConsentPending(true);
  };

  const agree = async () => {
    const recorded = await recordBetaFeatureDecision(
      betaFeatureIdForSetting("betaWindowsLineTokens"),
      "accepted",
      { featureVersion: "1", appVersion: UPDATE_NOTES.version },
    );
    if (!recorded) return;
    updateSetting("betaWindowsLineTokens", true);
    setConsentPending(false);
  };

  const disableBetaFeature = async () => {
    updateSetting("betaWindowsLineTokens", false);
    await recordBetaFeatureDecision(betaFeatureIdForSetting("betaWindowsLineTokens"), "withdrawn", {
      featureVersion: "1",
      appVersion: UPDATE_NOTES.version,
    });
  };

  return (
    <Section title="ベータ機能" desc="試験中の機能です。挙動や仕様は変更される場合があります。">
      <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs leading-relaxed">
        機能ごとの同意・撤回履歴はこの端末に保存します。メッセージ本文や確認結果をVylineの外部サービスへ送信しません。
      </div>

      <Card>
        <SettingsRow
          title="Windows版LINEのトークン確認（Beta）"
          description="起動中のLINE.exeから認証候補を読み取り、期限とペア関係だけを表示します。"
        >
          <Toggle
            checked={settings.betaWindowsLineTokens}
            onChange={(value) => (value ? requestEnable() : void disableBetaFeature())}
            label="Windowsトークン確認"
          />
        </SettingsRow>
      </Card>

      {settings.betaWindowsLineTokens && <WindowsLineTokenBetaPanel accountId={accountId} />}
      {consentPending && (
        <div className="mt-4 rounded-xl border border-[var(--vy-border)] bg-[var(--vy-surface-2)] p-4 text-sm">
          <p className="font-semibold">ベータ機能の個別同意</p>
          <p className="mt-2 text-xs leading-relaxed text-[var(--vy-text-dim)]">
            この端末上で実行中のWindows版LINEから認証候補を読み取り、種類・期限・ペア関係を確認します。トーク本文や認証情報そのものは画面・ログに表示しません。同意記録は端末内に保存します。
          </p>
          <div className="mt-3 flex gap-2">
            <Button variant="primary" size="sm" onClick={() => void agree()}>
              同意して有効化
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setConsentPending(false)}>
              キャンセル
            </Button>
          </div>
        </div>
      )}
      <div className="mt-4">
        <SqliteBlockedListConsent />
      </div>
    </Section>
  );
}

function SqliteBlockedListConsent() {
  const enabled = useStore((state) => state.settings.betaBlockedListSqliteSync);
  const updateSetting = useStore((state) => state.updateSetting);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const setEnabled = async (next: boolean) => {
    if (busy || next === Boolean(enabled)) return;
    setBusy(true);
    setMessage("");
    try {
      if (next) {
        const accepted = window.confirm(
          "ブロック一覧をアカウント別のVyline SQLiteに保存し、取得失敗時に最後の一覧を表示します。保存するのはブロック対象MIDです。同意して有効にしますか？",
        );
        const recorded = await recordBetaFeatureDecision(
          betaFeatureIdForSetting("betaBlockedListSqliteSync"),
          accepted ? "accepted" : "declined",
          { featureVersion: "1", appVersion: UPDATE_NOTES.version },
        );
        if (!accepted) {
          setMessage(
            recorded
              ? "同意しなかったためOFFのままです。"
              : "OFFのままです。選択履歴を保存できませんでした。",
          );
          return;
        }
        if (!recorded) {
          setMessage("同意履歴を保存できなかったため、有効化しませんでした。");
          return;
        }
        updateSetting("betaBlockedListSqliteSync", true);
        setMessage("有効にしました。");
        return;
      }

      updateSetting("betaBlockedListSqliteSync", false);
      const recorded = await recordBetaFeatureDecision(
        betaFeatureIdForSetting("betaBlockedListSqliteSync"),
        "withdrawn",
        { featureVersion: "1", appVersion: UPDATE_NOTES.version },
      );
      setMessage(
        recorded
          ? "OFFにしました。保存済みキャッシュは保持し、利用しません。"
          : "OFFにしましたが、選択履歴を保存できませんでした。",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsRow
      title="ブロックリスト差分同期（SQLite / Beta）"
      description="同意するとブロック対象MIDをアカウント別SQLiteへ保存し、取得失敗時の表示に利用します。"
    >
      <div className="flex flex-col items-end gap-1">
        <Toggle
          checked={Boolean(enabled)}
          onChange={(value) => void setEnabled(value)}
          disabled={busy}
          label="ブロックリスト差分同期"
        />
        {message && (
          <span role="status" className="text-[11px] text-[var(--vy-text-dim)]">
            {message}
          </span>
        )}
      </div>
    </SettingsRow>
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
