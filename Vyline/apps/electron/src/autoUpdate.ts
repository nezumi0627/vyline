/**
 * autoUpdate.ts — Electron 自動更新（electron-updater 経由の GitHub Releases 連携）
 *
 * LEINs の「LEINsの更新を自動確認」に相当する Electron 版。
 *
 * 注意: 実際の自動ダウンロード・インストールが動くのは、
 *   1. electron-builder.yml の `publish` が実在の GitHub リポジトリを指している
 *   2. そのリポジトリに electron-builder が生成する latest.yml 等を含む
 *      署名済みリリースが実際に公開されている
 * 場合のみ。publish 未設定・未公開の間はチェックが静かに失敗するだけで、
 * ユーザー体験には影響しない（起動をブロックしない・エラーダイアログも出さない）。
 */
import { autoUpdater } from "electron-updater";
import { dialog, shell } from "electron";

let checked = false;

export async function checkForAppUpdates(): Promise<void> {
  if (checked) return;
  checked = true;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on("error", (err) => {
    // publish 未設定・ネットワーク不通などは日常的に起こりうるので warn に留め、
    // ユーザーへは通知しない（起動体験を壊さない）
    console.warn("[autoUpdate] check failed (non-fatal):", err?.message ?? String(err));
  });

  autoUpdater.on("update-available", (info) => {
    console.log("[autoUpdate] update available:", info.version);
    void dialog
      .showMessageBox({
        type: "info",
        title: "Vyline",
        message: `新しいバージョン ${info.version} が利用可能です`,
        detail: "GitHub Releases からダウンロードページを開きますか？",
        buttons: ["開く", "後で"],
        defaultId: 0,
        cancelId: 1,
      })
      .then((res) => {
        if (res.response === 0) {
          const url = `https://github.com/nezumi0627/Vyline/releases/tag/v${info.version}`;
          void shell.openExternal(url);
        }
      });
  });

  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    console.warn("[autoUpdate] checkForAppUpdates threw (non-fatal, likely publish unset):", err);
  }
}
