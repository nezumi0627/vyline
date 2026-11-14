import { tr as uiText } from "@/i18n";
import { ActionFeedback } from "@/components/action-feedback";
import { useEffect, useState } from "react";
import { api } from "@/api/client";
import { useStore } from "@/lib/store";
import {
  BUILD_COMMIT_SHA,
  checkForUpdates,
  currentVersion,
  formatBuildVersion,
  getUpdateChannel,
  type UpdateInfo,
} from "@/lib/updater";
import { IconUpdate, IconCheck } from "@/components/icons";
import { ReleaseNotes } from "@/components/release-notes";

export function UpdaterPage() {
  const updateSettings = useStore((s) => s.settings);
  const channel = getUpdateChannel(updateSettings.receiveBetaUpdates ?? false);
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(true);
  const [canLaunchInstaller, setCanLaunchInstaller] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [message, setMessage] = useState("");
  const [messageIsError, setMessageIsError] = useState(false);

  const check = async () => {
    setChecking(true);
    setMessage("");
    setMessageIsError(false);
    try {
      setInfo(await checkForUpdates({ force: true, channel }));
    } catch {
      setMessage(
        uiText("更新情報を取得できませんでした。ネットワークを確認して再試行してください。"),
      );
      setMessageIsError(true);
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    let alive = true;
    void api.updater
      .capability()
      .then((capability) => {
        if (alive) setCanLaunchInstaller(capability.canLaunchInstaller);
      })
      .catch(() => undefined);
    void checkForUpdates({ channel })
      .then((next) => {
        if (alive) {
          setInfo(next);
          setChecking(false);
        }
      })
      .catch(() => {
        if (alive) {
          setMessage(
            uiText("更新情報を取得できませんでした。ネットワークを確認して再試行してください。"),
          );
          setMessageIsError(true);
          setChecking(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [channel]);

  const launch = async () => {
    if (!info?.latestVersion || launching) return;
    if (
      !window.confirm(
        uiText(
          "Vyline {{version}} {{channel}} インストーラーをダウンロードして起動します。続行しますか？",
          {
            version: info.latestVersion,
            channel: info.channel === "beta" ? "Beta" : "Stable",
          },
        ),
      )
    )
      return;
    setLaunching(true);
    setMessageIsError(false);
    setMessage(uiText("公式インストーラーを取得し、SHA-256を検証しています…"));
    try {
      const result = await api.updater.launchInstaller(info.latestVersion, info.channel);
      if (!result.ok) throw new Error(result.error ?? "インストーラーを起動できませんでした");
      setMessage(
        uiText("検証済みインストーラーを起動しました。画面の案内に従って更新してください。"),
      );
    } catch (error) {
      setMessageIsError(true);
      setMessage(
        error instanceof Error ? error.message : uiText("インストーラーを起動できませんでした"),
      );
    } finally {
      setLaunching(false);
    }
  };

  return (
    <section className="vy-scroll h-full flex-1 overflow-y-auto bg-[var(--vy-bg)] px-5 py-8 md:px-10">
      <div className="mx-auto max-w-2xl">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--vy-accent)]">
          {uiText("Vyline updater")}{" "}
        </p>
        <h1 className="mt-2 text-2xl font-bold">{uiText("アップデート")}</h1>
        <p className="mt-2 text-sm text-[var(--vy-text-dim)]">
          {uiText("現在のバージョン")} {formatBuildVersion(currentVersion(), BUILD_COMMIT_SHA)}
        </p>

        <div className="mt-7 rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface)] p-5 md:p-7">
          {checking ? (
            <p className="text-sm text-[var(--vy-text-dim)]">
              {uiText(
                channel === "beta"
                  ? "最新のBeta版を確認しています…"
                  : "最新の正式版を確認しています…",
              )}
            </p>
          ) : info?.hasUpdate ? (
            <>
              <div className="flex items-start gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_oklab,var(--vy-accent)_16%,var(--vy-surface))] text-[var(--vy-accent)]">
                  <IconUpdate size={23} />
                </span>
                <div className="min-w-0">
                  <p className="text-xs text-[var(--vy-text-dim)]">
                    {info.channel === "beta" ? uiText("新しいBeta版") : uiText("新しいStable版")}
                  </p>
                  <h2 className="mt-1 font-mono text-xl font-semibold">
                    {uiText("V")}
                    {info.latestVersion}
                  </h2>
                  <p className="mt-1 text-xs text-[var(--vy-text-dim)]">
                    {uiText("対象OS")}:{" "}
                    {uiText(
                      info.platform === "windows"
                        ? info.architecture === "arm64"
                          ? "Windows ARM64"
                          : "Windows x64"
                        : info.platform === "linux"
                          ? "Linux x64"
                          : info.platform === "macos"
                            ? info.architecture === "arm64"
                              ? "macOS Apple Silicon (arm64)"
                              : info.architecture === "x64"
                                ? "macOS Intel (x64)"
                                : "CPUアーキテクチャを判定できないため、配布物を選択できません。"
                            : "判定できません",
                    )}
                  </p>
                </div>
              </div>
              {info.body && (
                <div className="mt-5 max-h-80 overflow-auto rounded-xl bg-[var(--vy-surface-2)] p-4">
                  <ReleaseNotes markdown={info.body} />
                </div>
              )}
              {info.downloadDigest && (
                <p className="mt-4 break-all font-mono text-[0.68rem] text-[var(--vy-text-dim)]">
                  {uiText("SHA-256:")} {info.downloadDigest.replace(/^sha256:/, "")}
                </p>
              )}
              {info.isLocalInstall && info.platform === "windows" && canLaunchInstaller ? (
                <button
                  type="button"
                  onClick={() => void launch()}
                  disabled={launching}
                  className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[var(--vy-accent)] px-5 py-3 text-sm font-semibold text-[var(--vy-accent-contrast)] hover:opacity-90 disabled:opacity-50"
                >
                  <IconUpdate size={17} />
                  {launching ? uiText("準備中…") : uiText("確認済みインストーラーを起動")}
                </button>
              ) : info.downloadUrl ? (
                <a
                  href={info.downloadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-5 inline-flex rounded-xl bg-[var(--vy-accent)] px-5 py-3 text-sm font-semibold text-[var(--vy-accent-contrast)]"
                >
                  {uiText("公式配布ファイルを取得")}{" "}
                </a>
              ) : (
                <p className="mt-5 text-sm text-[var(--vy-text-dim)]">
                  {info.isLocalInstall
                    ? info.platform === "macos" && info.architecture === "unknown"
                      ? uiText("CPUアーキテクチャを判定できないため、配布物を選択できません。")
                      : uiText("このOS向けの配布ファイルはまだありません。")
                    : uiText("リモートサーバーで実行中です。サーバー管理者が更新してください。")}
                </p>
              )}
              {info.url && (
                <a
                  href={info.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 block text-xs text-[var(--vy-text-dim)] underline underline-offset-2"
                >
                  {uiText("GitHubリリースの詳細")}{" "}
                </a>
              )}
              <p className="mt-4 text-xs leading-relaxed text-[var(--vy-text-dim)]">
                {uiText(
                  "インストーラーは明示操作後に取得・検証されます。アプリのデータ領域は更新で削除されません。",
                )}{" "}
              </p>
            </>
          ) : info?.error ? (
            <p role="alert" className="text-sm text-[var(--vy-danger)]">
              {uiText("更新確認に失敗しました。")}{" "}
            </p>
          ) : info?.channel === "beta" && !info.latestVersion ? (
            <p className="text-sm text-[var(--vy-text-dim)]">
              {uiText("利用できるBeta版はまだありません。")}
            </p>
          ) : (
            <div className="flex items-center gap-3 text-sm">
              <IconCheck size={18} />
              <span>
                {info?.channel === "beta"
                  ? uiText("最新のBeta版を使用しています。")
                  : uiText("最新版を使用しています。")}
              </span>
            </div>
          )}
          <ActionFeedback
            error={messageIsError ? message : null}
            status={!messageIsError ? message : null}
            className="mt-3 text-sm"
          />
          <button
            type="button"
            onClick={() => void check()}
            disabled={checking || launching}
            className="mt-5 rounded-lg border border-[var(--vy-border)] px-4 py-2 text-sm text-[var(--vy-text-dim)] hover:bg-[var(--vy-surface-2)] disabled:opacity-50"
          >
            {uiText("更新を再確認")}{" "}
          </button>
        </div>
      </div>
    </section>
  );
}
