# Vyline 配布ガイド（Windows exe）

最終更新: 2026-07-31

## 目的

開発サーバー（`bun run dev`）ではなく、エンドユーザー向けに **単一 exe / インストーラ** で配布するための手順と設計メモです。

## バージョン正本

| 場所 | 役割 |
|---|---|
| `Vyline/apps/desktop/src/lib/store.ts` → `UPDATE_NOTES.version` | UI / What's New / updater が参照 |
| ルート `package.json` / `apps/desktop/package.json` | npm / ビルドメタ |
| GitHub Release tag (`vX.Y.Z`) | `checkForUpdates()` が比較 |

リリース時は **3 箇所を同じセマンティックバージョン** に揃える。

## 現状のアップデーター

`apps/desktop/src/lib/updater.ts` は GitHub Releases の latest を確認し、差分があれば情報タブで通知します。

- API: `https://api.github.com/repos/nezumi0627/Vyline/releases/latest`
- exe 置換は別プロセス（Vyline Updater）を想定。Web 版では URL 遷移のみ

## 推奨パッケージ構成（予定）

```
VylineSetup-0.3.1.exe
├── Vyline.exe          # フロント + 埋め込み backend 起動
├── resources/
│   ├── backend/        # bun コンパイル or 同梱 runtime
│   └── web/            # vite build 成果物
└── VylineUpdater.exe   # 差分 DL → 置換 → 再起動
```

実装オプション（いずれか）:

1. **Tauri 2** — 軽量・WebView2・updater プラグインあり（推奨候補）
2. **electron-builder** — 実績多いが重量
3. **自前 bun compile + Inno Setup** — 依存最小・メンテは自前

## ビルド手順（開発用アセット）

```powershell
# UI 本番ビルド
bun run build

# 型チェック
bun run typecheck
```

成果物: `Vyline/apps/desktop/dist/`

backend は現状 `bun Vyline/backend/src/index.ts`。exe 同梱時は:

- `PORT` をローカル固定（例: 18765）
- frontend は相対 `/api` ではなく同梱 backend を指す
- `Vyline/backend/data/` はユーザー AppData へリダイレクト

## インストーラ要件

- [ ] 初回に WebView2 / VC++ ランタイム確認
- [ ] データディレクトリ: `%APPDATA%\Vyline\`
- [ ] 自動起動オプション（任意）
- [ ] アンインストールで data を残す/消す選択
- [ ] コード署名（推奨・SmartScreen 回避）

## リリースチェックリスト

1. `UPDATE_NOTES` を更新（version + items）
2. `package.json` の version を揃える
3. `bun run typecheck` / 手動スモーク（ログイン・送信・スタンプ・ブロック）
4. GitHub Release を作成（tag `vX.Y.Z`、アセットに Setup.exe）
5. What's New が起動時に出ることを確認（`seenUpdateVersion`）

## 秘密情報

`desktop-e2ee-keys.json` / tokens / session は **配布物に含めない**。ユーザーマシンの AppData のみ。
