import { tr as uiText } from "@/i18n";
import { useEffect, useState } from "react";
import { api } from "@/api/client";
import {
  BUILD_COMMIT_SHA,
  checkForUpdates,
  currentVersion,
  formatBuildVersion,
  type UpdateInfo,
} from "@/lib/updater";
import { IconUpdate, IconCheck } from "@/components/icons";

export function UpdaterPage() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(true);
  const [canLaunchInstaller, setCanLaunchInstaller] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [message, setMessage] = useState("");

  const check = async () => {
    setChecking(true);
    setMessage("");
    try {
      setInfo(await checkForUpdates({ force: true }));
    } catch {
      setMessage("更新情報を取得できませんでした。ネットワークを確認して再試行してください。");
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
    void checkForUpdates()
      .then((next) => {
        if (alive) {
          setInfo(next);
          setChecking(false);
        }
      })
      .catch(() => {
        if (alive) {
          setMessage("更新情報を取得できませんでした。ネットワークを確認して再試行してください。");
          setChecking(false);
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  const launch = async () => {
    if (!info?.latestVersion || launching) return;
    if (
      !window.confirm(
        `Vyline ${info.latestVersion} のインストーラーをダウンロードして起動します。続行しますか？`,
      )
    )
      return;
    setLaunching(true);
    setMessage("公式インストーラーを取得し、SHA-256を検証しています…");
    try {
      const result = await api.updater.launchInstaller(info.latestVersion);
      if (!result.ok) throw new Error(result.error ?? "インストーラーを起動できませんでした");
      setMessage("検証済みインストーラーを起動しました。画面の案内に従って更新してください。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "インストーラーを起動できませんでした");
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
              {uiText("最新バージョンを確認しています…")}
            </p>
          ) : info?.hasUpdate ? (
            <>
              <div className="flex items-start gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_oklab,var(--vy-accent)_16%,var(--vy-surface))] text-[var(--vy-accent)]">
                  <IconUpdate size={23} />
                </span>
                <div className="min-w-0">
                  <p className="text-xs text-[var(--vy-text-dim)]">{uiText("新しいバージョン")}</p>
                  <h2 className="mt-1 font-mono text-xl font-semibold">
                    {uiText("V")}
                    {info.latestVersion}
                  </h2>
                </div>
              </div>
              {info.body && (
                <pre className="mt-5 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-[var(--vy-surface-2)] p-4 font-sans text-sm leading-relaxed">
                  {info.body}
                </pre>
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
                  {launching ? "準備中…" : "確認済みインストーラーを起動"}
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
                    ? "このOS向けの配布ファイルはまだありません。"
                    : "リモートサーバーで実行中です。サーバー管理者が更新してください。"}
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
          ) : (
            <div className="flex items-center gap-3 text-sm">
              <IconCheck size={18} />
              <span>{uiText("Vylineは最新です。")}</span>
            </div>
          )}
          {message && (
            <p role="status" className="mt-4 break-words text-sm text-[var(--vy-text-dim)]">
              {message}
            </p>
          )}
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
