import { useId, useState } from "react";
import type { recordingClient, RecordingSettingsResponse } from "@/api/recordings";
import { requestControllerConfirm } from "@/ui/controller-dialog";
import { RECORDING_CONSENT } from "@/utils/callRecording";
import { RecordingPathInput } from "./recording-path-input";

const field =
  "min-h-11 w-full min-w-0 rounded-lg border border-[var(--vy-border)] bg-[var(--vy-surface)] px-3 text-sm";
const button =
  "min-h-11 rounded-lg border border-[var(--vy-border)] px-3 text-sm disabled:opacity-40";
export function RecordingSettings({
  initial,
  client,
  reload,
}: {
  initial: RecordingSettingsResponse;
  client: ReturnType<typeof recordingClient>;
  reload: () => Promise<void>;
}) {
  const kindId = useId();
  const [preferences, setPreferences] = useState(initial.preferences);
  const [target, setTarget] = useState({
    name: "",
    kind: "local" as "local" | "webdav",
    path: "",
    username: "",
    password: "",
    allowPrivateNetwork: false,
    allowInsecureHttp: false,
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function run(work: () => Promise<void>, success: string) {
    setBusy(true);
    setMessage("");
    try {
      await work();
      setMessage(success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "設定を保存できませんでした");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="rounded-xl border border-[var(--vy-border)] bg-[var(--vy-surface)] p-4">
      <summary className="cursor-pointer py-2 text-sm font-semibold">
        保存期間・自動記録・保存先
      </summary>
      <form
        className="mt-4 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            await client.saveSettings(preferences);
            await reload();
          }, "これから開始する記録に適用しました");
        }}
      >
        <p className="text-xs text-[var(--vy-text-dim)]">
          変更は次に開始する記録に適用されます。既存のファイルは移動せず、保存期限も変更しません。
        </p>
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={preferences.automatic}
            onChange={(event) => {
              const automatic = event.target.checked;
              if (automatic && !preferences.consentAccepted) {
                void (async () => {
                  const accepted = await requestControllerConfirm(RECORDING_CONSENT, {
                    title: "通話記録の確認",
                    acceptLabel: "記録を有効にする",
                    cancelFirst: true,
                  });
                  if (!accepted) return;
                  setPreferences((current) => ({
                    ...current,
                    automatic: true,
                    consentAccepted: true,
                  }));
                })();
                return;
              }
              setPreferences({
                ...preferences,
                automatic,
                consentAccepted: preferences.consentAccepted || automatic,
              });
            }}
          />
          通話接続後に自動で記録する
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-2 text-sm">
            <span>記録形式</span>
            <select
              aria-label="記録形式"
              className={field}
              value={preferences.kind}
              onChange={(event) =>
                setPreferences({
                  ...preferences,
                  kind: event.target.value === "video" ? "video" : "audio",
                })
              }
            >
              <option value="audio">録音（音声のみ）</option>
              <option value="video">録画（音声・映像）</option>
            </select>
          </label>
          <label className="space-y-2 text-sm">
            <span>保存期間</span>
            <select
              aria-label="保存期間"
              className={field}
              value={preferences.retentionDays}
              onChange={(event) =>
                setPreferences({ ...preferences, retentionDays: Number(event.target.value) })
              }
            >
              {[7, 30, 90, 365, 0].map((days) => (
                <option key={days} value={days}>
                  {days ? `${days}日` : "無期限"}
                </option>
              ))}
              {![7, 30, 90, 365, 0].includes(preferences.retentionDays) && (
                <option value={preferences.retentionDays}>{preferences.retentionDays}日</option>
              )}
            </select>
          </label>
        </div>
        <label className="block space-y-2 text-sm">
          <span>保存先</span>
          <select
            aria-label="保存先"
            className={field}
            value={preferences.targetId ?? ""}
            onChange={(event) =>
              setPreferences({ ...preferences, targetId: event.target.value || null })
            }
          >
            <option value="">サーバーの標準ストレージ</option>
            {initial.targets.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}（{item.kind === "webdav" ? "WebDAV" : "サーバー内"}）
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-[var(--vy-text-dim)]">
          自動記録は自分以外が全員退出すると停止します。通話画面の手動／自動の切替は、その通話だけに適用されます。無期限でもアカウントの容量上限は変わりません。
        </p>
        <button
          type="submit"
          className={`${button} bg-[var(--vy-accent)] text-[var(--vy-accent-contrast)]`}
          disabled={busy}
        >
          記録設定を保存
        </button>
      </form>
      <section
        aria-label="保存先を管理"
        className="mt-6 space-y-3 border-t border-[var(--vy-border)] pt-4"
      >
        <h3 className="text-sm font-semibold">保存先を管理</h3>
        {initial.targets.map((item) => (
          <div key={item.id} data-native-kind="section" className="space-y-2 rounded-lg border border-[var(--vy-border)] p-3">
            <p className="break-words text-sm font-medium">{item.name}</p>
            <p className="break-all text-xs text-[var(--vy-text-dim)]">{item.path}</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={button}
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await client.testTarget(item.id);
                  }, "接続を確認しました（実際の書き込みは記録保存時）")
                }
              >
                接続を確認
              </button>
              <button
                type="button"
                className={button}
                disabled={busy}
                onClick={() => {
                  const targetId = item.id;
                  const targetName = item.name;
                  void (async () => {
                    const confirmed = await requestControllerConfirm(
                      `保存先「${targetName}」を削除しますか？ 記録が残っている保存先は削除できません。`,
                      { title: "保存先の削除", acceptLabel: "削除する", cancelFirst: true },
                    );
                    if (!confirmed) return;
                    await run(async () => {
                      await client.removeTarget(targetId);
                      const next = await client.settings();
                      setPreferences(next.preferences);
                      await reload();
                    }, "保存先を削除しました");
                  })();
                }}
              >
                保存先を削除
              </button>
            </div>
          </div>
        ))}
        <details>
          <summary className="cursor-pointer py-3 text-sm">保存先を追加</summary>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await client.addTarget(target);
                setTarget({ ...target, name: "", path: "", password: "" });
                await reload();
              }, "保存先を追加しました。上の保存先から選んで設定を保存してください");
            }}
          >
            <label className="block space-y-2 text-sm">
              <span>保存先の名前</span>
              <input
                required
                maxLength={80}
                className={field}
                value={target.name}
                onChange={(event) => setTarget({ ...target, name: event.target.value })}
              />
            </label>
            <fieldset
              disabled={busy}
              className="space-y-2 disabled:opacity-50 [&:disabled_label]:cursor-not-allowed"
            >
              <legend className="text-sm">保存先の種類</legend>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["local", "サーバー内"],
                    ["webdav", "WebDAV"],
                  ] as const
                ).map(([kind, label]) => (
                  <label
                    key={kind}
                    className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm text-[var(--vy-text)] hover:bg-[var(--vy-surface-2)] active:bg-[var(--vy-surface-3)] ${target.kind === kind ? "border-[var(--vy-accent)] bg-[var(--vy-surface-2)]" : "border-[var(--vy-border)] bg-[var(--vy-surface)]"}`}
                  >
                    <input
                      type="radio"
                      name={kindId}
                      value={kind}
                      checked={target.kind === kind}
                      className="h-4 w-4 shrink-0 accent-[var(--vy-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--vy-text)]"
                      onChange={() => setTarget({ ...target, kind, path: "", password: "" })}
                    />
                    <span className="whitespace-nowrap font-medium">{label}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-[var(--vy-text-dim)]">
                {target.kind === "local"
                  ? "サーバーのフォルダーや、マウント済みの外部ディスクに保存します。"
                  : "WebDAV対応のNASやストレージに転送します。"}
              </p>
            </fieldset>
            {target.kind === "local" ? (
              <RecordingPathInput
                value={target.path}
                onChange={(path) => setTarget({ ...target, path })}
                client={client}
                roots={initial.roots}
                disabled={busy}
              />
            ) : (
              <label className="block space-y-2 text-sm">
                <span>WebDAVフォルダーのURL</span>
                <input
                  required
                  maxLength={2048}
                  className={field}
                  type="url"
                  value={target.path}
                  onChange={(event) => setTarget({ ...target, path: event.target.value })}
                />
              </label>
            )}
            {target.kind === "local" ? (
              <>
                <p className="text-xs text-[var(--vy-text-dim)]">
                  Dockerのホスト側へ保存する場合は、対応するコンテナ内のマウント先を選んでください。未マウントのホスト側パスや、ブラウザー端末のフォルダーは候補に出ません。
                </p>
                <ul className="space-y-1 text-xs text-[var(--vy-text-dim)]">
                  {initial.roots.map((root) => (
                    <li key={root.path} className="break-all">
                      {root.path} ·{" "}
                      {root.available
                        ? `空き ${(root.freeBytes / 1024 ** 3).toFixed(1)} GiB`
                        : "利用できません"}
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-[var(--vy-text-dim)]">
                  別のルートはサーバー管理者が VYLINE_RECORDING_ALLOWED_ROOTS に追加できます。
                </p>
              </>
            ) : (
              <>
                <label className="block space-y-2 text-sm">
                  <span>ユーザー名</span>
                  <input
                    autoComplete="off"
                    maxLength={256}
                    className={field}
                    value={target.username}
                    onChange={(event) => setTarget({ ...target, username: event.target.value })}
                  />
                </label>
                <label className="block space-y-2 text-sm">
                  <span>パスワード／アプリパスワード</span>
                  <input
                    autoComplete="new-password"
                    maxLength={4096}
                    type="password"
                    className={field}
                    value={target.password}
                    onChange={(event) => setTarget({ ...target, password: event.target.value })}
                  />
                </label>
                <label className="flex min-h-11 items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={target.allowPrivateNetwork}
                    onChange={(event) =>
                      setTarget({
                        ...target,
                        allowPrivateNetwork: event.target.checked,
                        allowInsecureHttp: event.target.checked && target.allowInsecureHttp,
                      })
                    }
                  />
                  LAN内のNASへの接続を許可
                </label>
                <label className="flex min-h-11 items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    disabled={!target.allowPrivateNetwork}
                    checked={target.allowInsecureHttp}
                    onChange={(event) =>
                      setTarget({ ...target, allowInsecureHttp: event.target.checked })
                    }
                  />
                  LAN内で暗号化されないHTTP接続を許可
                </label>
                {target.allowInsecureHttp && (
                  <p className="text-xs text-[var(--vy-danger)]">
                    HTTPでは認証情報と記録が暗号化されません。信頼できるLANでのみ使用してください。
                  </p>
                )}
                <p className="text-xs text-[var(--vy-text-dim)]">
                  認証情報の保護: {initial.credentialProtection}
                  。転送失敗時はサーバー内の一時ファイルを残し、一覧から再送できます。
                </p>
              </>
            )}
            <p className="text-xs text-[var(--vy-text-dim)]">
              選んだ保存先の下に、ログイン中のアカウント専用サブフォルダーを自動作成します。同じ保存先を複数アカウントで使っても記録は混ざりません。
            </p>
            <button type="submit" disabled={busy} className={button}>
              保存先を追加する
            </button>
          </form>
        </details>
      </section>
      {message && (
        <p role="status" className="mt-4 break-words text-sm">
          {message}
        </p>
      )}
    </details>
  );
}
