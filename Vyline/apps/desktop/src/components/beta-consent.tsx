import { tr as uiText } from "@/i18n";
import { useEffect, useState } from "react";
import { useStore, UPDATE_NOTES } from "@/lib/store";
import { Button, SettingsRow, Toggle } from "@/components/vy-ui";
import { api } from "@/api/client";
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
    <Section
      title={uiText("ベータ機能")}
      desc={uiText("試験中の機能です。挙動や仕様は変更される場合があります。")}
    >
      <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs leading-relaxed">
        {uiText(
          "機能ごとの同意・撤回履歴はこの端末に保存します。メッセージ本文や確認結果をVylineの外部サービスへ送信しません。",
        )}{" "}
      </div>

      <Card>
        <SquareBetaToggle accountId={accountId} />
      </Card>

      <Card className="mt-4">
        <SettingsRow
          title={uiText("Windows版LINEのトークン確認（Beta）")}
          description={uiText(
            "起動中のLINE.exeから認証候補を読み取り、期限とペア関係だけを表示します。",
          )}
        >
          <Toggle
            checked={settings.betaWindowsLineTokens}
            onChange={(value) => (value ? requestEnable() : void disableBetaFeature())}
            label={uiText("Windowsトークン確認")}
          />
        </SettingsRow>
      </Card>

      {settings.betaWindowsLineTokens && <WindowsLineTokenBetaPanel accountId={accountId} />}
      {consentPending && (
        <div className="mt-4 rounded-xl border border-[var(--vy-border)] bg-[var(--vy-surface-2)] p-4 text-sm">
          <p className="font-semibold">{uiText("ベータ機能の個別同意")}</p>
          <p className="mt-2 text-xs leading-relaxed text-[var(--vy-text-dim)]">
            {uiText(
              "この端末上で実行中のWindows版LINEから認証候補を読み取り、種類・期限・ペア関係を確認します。トーク本文や認証情報そのものは画面・ログに表示しません。同意記録は端末内に保存します。",
            )}{" "}
          </p>
          <div className="mt-3 flex gap-2">
            <Button variant="primary" size="sm" onClick={() => void agree()}>
              {uiText("同意して有効化")}{" "}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setConsentPending(false)}>
              {uiText("キャンセル")}{" "}
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

function SquareBetaToggle({ accountId }: { accountId: string | null }) {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    setEnabled(false);
    if (!accountId)
      return () => {
        cancelled = true;
      };
    void api.line
      .squareStatus(accountId)
      .then((status) => {
        if (
          status.enabled &&
          !isBetaFeatureConsentActive(betaFeatureIdForSetting("betaOpenChatSquare"), "2")
        ) {
          return api.line.squareDisable(accountId).then(() => {
            if (!cancelled) {
              setEnabled(false);
              setMessage(
                uiText(
                  "OpenChatの説明が更新されたためOFFにしました。内容を確認して再度有効にしてください。",
                ),
              );
            }
          });
        }
        if (!cancelled) setEnabled(status.enabled);
      })
      .catch(() => {
        if (!cancelled) setMessage(uiText("OpenChatの設定状態を読み込めませんでした"));
      });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  const change = async (next: boolean) => {
    if (!accountId || busy || next === enabled) return;
    setBusy(true);
    setMessage("");
    try {
      if (next) {
        const accepted = window.confirm(
          uiText(
            "OpenChat Betaを有効にします。プライマリデバイスから取得した通信を基準にした試験的実装で、サブデバイス互換は未検証です。利用は推奨できず、有効化と操作は自己責任となります。LINE Square APIへ接続し、参加中の一覧と開いたルームのメッセージをこのアカウント専用SQLiteに保存します。後日サブデバイスでも通信を再取得して互換性を検証し、安定化する予定です。有効にしますか？",
          ),
        );
        const recorded = await recordBetaFeatureDecision(
          betaFeatureIdForSetting("betaOpenChatSquare"),
          accepted ? "accepted" : "declined",
          { featureVersion: "2", appVersion: UPDATE_NOTES.version },
        );
        if (!accepted || !recorded) {
          setMessage(
            uiText(accepted ? "同意履歴を保存できないためOFFのままです" : "キャンセルしました"),
          );
          return;
        }
        await api.line.squareEnable(accountId);
        setEnabled(true);
        window.dispatchEvent(
          new CustomEvent("vyline:square-changed", { detail: { enabled: true } }),
        );
        setMessage(uiText("有効にしました。一覧を取得します"));
        return;
      }
      await api.line.squareDisable(accountId);
      setEnabled(false);
      window.dispatchEvent(
        new CustomEvent("vyline:square-changed", { detail: { enabled: false } }),
      );
      const recorded = await recordBetaFeatureDecision(
        betaFeatureIdForSetting("betaOpenChatSquare"),
        "withdrawn",
        { featureVersion: "2", appVersion: UPDATE_NOTES.version },
      );
      setMessage(
        uiText(
          recorded
            ? "無効にしました。以後Square通信を停止します。保存済みキャッシュは保持されます。"
            : "無効にしましたが、同意撤回履歴を保存できませんでした",
        ),
      );
    } catch {
      setMessage(
        uiText("設定を変更できませんでした。通信が行われていないことを確認して再試行してください"),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsRow
      title={uiText("OpenChat / Square（Beta）")}
      description={uiText(
        "プライマリデバイスの通信を基準にした試験実装です。サブデバイス互換は未検証で利用は推奨できません。有効にするまでSquare通信は行いません。後日サブデバイスで再検証します。",
      )}
    >
      <div className="flex flex-col items-end gap-1">
        <Toggle
          checked={enabled}
          onChange={(value) => void change(value)}
          disabled={busy || !accountId}
          label={uiText("OpenChatを有効にする")}
        />
        {message && (
          <span role="status" className="max-w-72 text-right text-[11px] text-[var(--vy-text-dim)]">
            {message}
          </span>
        )}
      </div>
    </SettingsRow>
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
          uiText(
            "ブロック一覧をアカウント別のVyline SQLiteに保存し、取得失敗時に最後の一覧を表示します。保存するのはブロック対象MIDです。同意して有効にしますか？",
          ),
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
      title={uiText("ブロックリスト差分同期（SQLite / Beta）")}
      description={uiText(
        "同意するとブロック対象MIDをアカウント別SQLiteへ保存し、取得失敗時の表示に利用します。",
      )}
    >
      <div className="flex flex-col items-end gap-1">
        <Toggle
          checked={Boolean(enabled)}
          onChange={(value) => void setEnabled(value)}
          disabled={busy}
          label={uiText("ブロックリスト差分同期")}
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

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface)] px-4 divide-y divide-[var(--vy-border)] ${className}`}
    >
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
