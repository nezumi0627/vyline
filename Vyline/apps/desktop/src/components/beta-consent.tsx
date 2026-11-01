import { useState } from "react";
import { useStore, UPDATE_NOTES } from "@/lib/store";
import { Button, SettingsRow, TextField, Toggle } from "@/components/vy-ui";
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
  const [mid, setMid] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [profile, setProfile] = useState<{
    mid: string;
    displayName: string;
    statusMessage: string;
  } | null>(null);
  const [consentPending, setConsentPending] = useState<
    | "betaBlockCheckManual"
    | "betaBlockCheckAuto"
    | "betaMidSearch"
    | "betaAgentI"
    | "betaWindowsLineTokens"
    | null
  >(null);

  const requestEnable = (
    key:
      | "betaBlockCheckManual"
      | "betaBlockCheckAuto"
      | "betaMidSearch"
      | "betaAgentI"
      | "betaWindowsLineTokens",
  ) => {
    const feature = betaFeatureIdForSetting(key);
    if (isBetaFeatureConsentActive(feature)) {
      updateSetting(key, true);
      return;
    }
    setConsentPending(key);
  };

  const agree = async () => {
    if (!consentPending) return;
    const key = consentPending;
    const recorded = await recordBetaFeatureDecision(betaFeatureIdForSetting(key), "accepted", {
      featureVersion: "1",
      appVersion: UPDATE_NOTES.version,
    });
    if (!recorded) return;
    updateSetting(key, true);
    setConsentPending(null);
  };

  const disableBetaFeature = async (key: NonNullable<typeof consentPending>) => {
    updateSetting(key, false);
    await recordBetaFeatureDecision(betaFeatureIdForSetting(key), "withdrawn", {
      featureVersion: "1",
      appVersion: UPDATE_NOTES.version,
    });
  };

  return (
    <Section title="ベータ機能" desc="試験的な機能です。挙動や仕様は変更される場合があります。">
      <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs leading-relaxed">
        ベータ機能の同意記録と確認結果はこの端末のローカルストレージに保存します。
        メッセージ本文を収集したり、確認結果を Vyline の外部サービスへ送信したりしません。 LINE
        との通常の通信はこの説明の対象外です。法的助言ではありません。
      </div>

      <Card>
        <SettingsRow
          title="プロフィールにブロック確認ボタンを表示"
          description="プロフィール画面から、対象ユーザーのブロック状態を確認できるようにします。"
        >
          <Toggle
            checked={settings.betaBlockCheckManual}
            onChange={(value) =>
              value
                ? requestEnable("betaBlockCheckManual")
                : void disableBetaFeature("betaBlockCheckManual")
            }
            label="プロフィールのブロック確認"
          />
        </SettingsRow>
        <SettingsRow
          title="ブロックの自動確認（友だちのみ全員）"
          description="友だち一覧を対象に、API 制限を避けるため時間をかけて順番に確認します。"
        >
          <Toggle
            checked={settings.betaBlockCheckAuto}
            onChange={(value) =>
              value
                ? requestEnable("betaBlockCheckAuto")
                : void disableBetaFeature("betaBlockCheckAuto")
            }
            label="自動ブロック確認"
          />
        </SettingsRow>
        <SettingsRow
          title="MID でユーザー検索（Beta）"
          description="u + 32桁の16進数のMIDからプロフィールだけを検索します。"
        >
          <Toggle
            checked={settings.betaMidSearch}
            onChange={(value) =>
              value ? requestEnable("betaMidSearch") : void disableBetaFeature("betaMidSearch")
            }
            label="MID検索"
          />
        </SettingsRow>
        <SettingsRow
          title="Agent I AIアシスタント"
          description="質問・文章支援・明示選択したトークの要約を行います。入力内容はYahooへ送信されます。"
        >
          <Toggle
            checked={settings.betaAgentI}
            onChange={(value) =>
              value ? requestEnable("betaAgentI") : void disableBetaFeature("betaAgentI")
            }
            label="Agent I AIアシスタント"
          />
        </SettingsRow>
        <SettingsRow
          title="Windows版LINEのトークン確認（Beta）"
          description="起動中のLINE.exeから認証候補を読み取り、期限とペア関係だけを表示します。"
        >
          <Toggle
            checked={settings.betaWindowsLineTokens}
            onChange={(value) =>
              value
                ? requestEnable("betaWindowsLineTokens")
                : void disableBetaFeature("betaWindowsLineTokens")
            }
            label="Windowsトークン確認"
          />
        </SettingsRow>
      </Card>

      {settings.betaMidSearch && (
        <Card>
          <div className="py-4">
            <p className="text-sm font-medium">ユーザー MID を検索</p>
            <div className="mt-2 flex gap-2">
              <TextField
                value={mid}
                onChange={(event) => setMid(event.target.value.trim())}
                placeholder="u + 32桁の16進数"
                invalid={Boolean(searchError)}
                aria-describedby={searchError ? "beta-mid-search-error" : undefined}
                className="min-w-0 flex-1"
                spellCheck={false}
              />
              <Button
                variant="primary"
                size="sm"
                disabled={searching || !accountId}
                loading={searching}
                onClick={async () => {
                  if (!accountId || !/^u[0-9a-f]{32}$/i.test(mid)) {
                    setSearchError("u + 32桁の16進数で入力してください");
                    setProfile(null);
                    return;
                  }
                  setSearching(true);
                  setSearchError(null);
                  setProfile(null);
                  try {
                    const response = await api.line.getContact(accountId, mid);
                    if (!response.ok || !response.profile)
                      throw new Error("ユーザーが見つかりません");
                    setProfile({
                      mid,
                      displayName: response.profile.displayName,
                      statusMessage: response.profile.statusMessage,
                    });
                  } catch (error) {
                    setSearchError(error instanceof Error ? error.message : "検索に失敗しました");
                  } finally {
                    setSearching(false);
                  }
                }}
              >
                {searching ? "検索中…" : "検索"}
              </Button>
            </div>
            {searchError && (
              <p id="beta-mid-search-error" role="alert" className="mt-2 text-xs text-red-400">
                {searchError}
              </p>
            )}
            {profile && (
              <div className="mt-3 rounded-lg border border-[var(--vy-border)] p-3 text-xs">
                <p className="font-semibold">{profile.displayName || profile.mid}</p>
                <p className="mt-1 break-all text-[var(--vy-text-dim)]">{profile.mid}</p>
                {profile.statusMessage && <p className="mt-1">{profile.statusMessage}</p>}
              </div>
            )}
          </div>
        </Card>
      )}

      {settings.betaWindowsLineTokens && <WindowsLineTokenBetaPanel accountId={accountId} />}

      {consentPending && (
        <div className="mt-4 rounded-xl border border-[var(--vy-border)] bg-[var(--vy-surface-2)] p-4 text-sm">
          <p className="font-semibold">ベータ機能の個別同意</p>
          <p className="mt-2 text-xs leading-relaxed text-[var(--vy-text-dim)]">
            有効にした機能に応じて、友だち一覧または指定MIDのプロフィールを端末上で処理します。
            機能ごとの同意記録は端末内だけに保存します。利用を続ける場合は同意してください。
          </p>
          <div className="mt-3 flex gap-2">
            <Button variant="primary" size="sm" onClick={agree}>
              同意して有効化
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setConsentPending(null)}>
              キャンセル
            </Button>
          </div>
        </div>
      )}
      <SqliteBlockedListConsent />
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
