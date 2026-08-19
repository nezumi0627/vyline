# Vyline Electron シェル（macOS 対応）

最終更新: 2026-08-20

## 目的

`bun run dev`（ブラウザ + `localhost:5173`/`:3001`）とは別に、**ネイティブデスクトップアプリ**として
Windows / **macOS** / Linux に配布するための Electron シェル。`Vyline/apps/electron/` に実装。

`docs/distribution.md` が検討していた「Tauri 2 / electron-builder / 自前 bun compile」のうち、
**electron-builder（パッケージング）+ `bun build --compile`（backend の単一実行ファイル化）** を採用した。

## アーキテクチャ

Vyline はもともと「backend（Hono/Bun）が本番フロントビルドを同一オリジンで配信する」自己完結型サーバー
（[selfhosting.md](./selfhosting.md) の Docker 構成と同じ形）なので、Electron 側は薄いシェルで済む:

```
Electron main (Vyline/apps/electron/src/main.ts)
  │
  ├─ 1. backend を子プロセスとして起動し healthz 待機
  │     - 開発時: `bun run src/index.ts`（このリポジトリの Vyline/backend を直接実行）
  │     - パッケージ後: resources/backend-bin/vyline-backend-<platform>-<arch>
  │       （`bun build --compile` で作った単一実行ファイル。エンドユーザーに bun インストール不要）
  │
  ├─ 2. BrowserWindow で http://127.0.0.1:<port>（backend が同一オリジンでフロントを配信）を読み込む
  │
  └─ 3. mac ネイティブ挙動: メニューバー・Dock・外部リンクは既定ブラウザへ委譲・
        マイク/カメラ権限（通話用）・単一インスタンス化・終了時に backend を確実に kill
```

主要ファイル:

| ファイル | 役割 |
| ------------------------------------------------ | ------------------------------------------------------------------ |
| `Vyline/apps/electron/src/main.ts` | メインプロセス（ウインドウ・メニュー・権限・終了処理） |
| `Vyline/apps/electron/src/backendProcess.ts` | backend 子プロセスの起動・空きポート検出・healthz 待機・停止 |
| `Vyline/apps/electron/src/preload.ts` | contextIsolation 用の最小限の橋渡し（`window.vyline` フラグのみ） |
| `Vyline/apps/electron/scripts/buildBackend.ts` | `bun build --compile` で backend を OS/arch 別に単一実行ファイル化 |
| `Vyline/apps/electron/electron-builder.yml` | mac(dmg/zip universal) / win(nsis) / linux(AppImage) パッケージ設定 |
| `Vyline/apps/electron/build/entitlements.mac.plist` | hardened runtime 用エンタイトルメント（マイク/カメラ/ネットワーク） |

## コマンド

```bash
# 開発（ホットではない。変更後は electron:dev を再実行）
bun run electron:dev

# mac 配布物（universal dmg + zip、要 codesign 環境変数）
bun run electron:build:mac

# Windows / Linux
bun run electron:build:win
bun run electron:build:linux

# 全プラットフォーム
bun run electron:build
```

`Vyline/apps/electron/package.json` にはさらに:

- `build:backend` — ホスト OS/arch のみコンパイル（開発反復用）
- `bun run scripts/buildBackend.ts --all` — mac(arm64/x64) + linux(x64) + win(x64) を一括コンパイル
- `bun run scripts/buildBackend.ts --mac-only` — mac universal 配布用に arm64+x64 の2本
- `build:mac:dir` — dmg 化せず `.app` だけ生成（動作確認用、高速）

## 既知の問題と対応（2026-08-20 実装時に発見・修正）

Electron 化の過程で、**Electron 固有ではない既存バグ**もいくつか見つかり、ついでに修正した
（`bun run dev` の通常フローでも本来踏んでいたはずの問題）:

1. **`apps/desktop/tsconfig.json` に `types` 指定が無く、ワークスペース内の `@types/node` 等が
   ambient にリークしていた** — `window.setTimeout` の戻り値型が `NodeJS.Timeout` と誤解釈され
   `tsc -b` が失敗する状態だった。`"types": ["vite/client"]` を明示して修正
   （フロントの型安全性そのものの改善でもある）。
2. **`backend/src/logger.ts` が `pino.transport({ target: "pino-pretty" })`（ワーカースレッド経由で
   ファイルパス解決）を使っており、`bun build --compile` の単一実行ファイル内では
   `unable to determine transport target for "pino-pretty"` で即クラッシュしていた** —
   ワーカーを介さないインプロセス pretty stream（`pinoPretty()` を直接 `pino()` の第2引数に渡す）に変更。
3. **`VylineUpdater` の Desktop プロファイル fallback ファイル
   （`Vyline/packages/protocol/data/desktop-profile.fallback.json`）が実在せず、
   `VYLINE_DATA_DIR` が空/新規の状態で backend を起動すると `ENOENT` で即クラッシュしていた** —
   `VylineUpdater.detect()` は非 Windows（= **macOS/Linux は常にこの分岐**）で
   `cached ?? loadFallbackProfile()` を使う設計なので、mac 対応において必須のファイルだった。
   `docs/reports/desktop-delta-20260726.md` に既にコミット済みの（非秘匿）Desktop delta capture
   （version `26.3.0.3916` / Windows 10.0.26100 11NT）を元に静的プロファイルを追加し、
   `persist.ts` 側も `fs` パス解決ではなく `import ... with { type: "json" }` の静的 import に変更
   （`bun build --compile` の仮想 FS でもパスが壊れず埋め込まれる）。
4. **`bun build --compile` で作った実行ファイルを `Bun.spawn()` / 素の `bun` 文字列で `spawn()`
   しようとすると `posix_spawn ENOENT` になる環境がある** — `node:child_process` の `spawn()` +
   `process.execPath`（実行中の bun バイナリの絶対パス）を使うことで解決。
5. **electron-builder は `package.json` に `"build"` キーがあると、内容に関わらずそちらを設定源として
   使い、同ディレクトリの `electron-builder.yml` を完全に無視する** — 誤って空の `"build": {...}` を
   package.json に残していたため、mac ターゲット・アイコン・entitlements 等が一切適用されない
   ビルドになっていた。`package.json` から `build` キーを削除して解消。
6. **【重要】`electron-builder.yml` の `extendInfo.LSMinimumSystemVersion: 11.0` を YAML でクォート
   していなかったため float として解釈され、生成された `Info.plist` に `<real>` として書き込まれていた。
   Apple 仕様では `LSMinimumSystemVersion` は文字列必須で、AppKit がウインドウの閉じる/最小化/フルスクリーン
   ボタンを作る際に内部で `LaunchServices` のバージョン文字列パーサ（`_LSGetVersionFromString`）に
   渡す際 `NSNumber` を `NSString` として扱おうとして
   `-[__NSCFNumber _getCString:maxLength:encoding:]: unrecognized selector` でクラッシュしていた** —
   パッケージ済み `.app` を起動すると**必ず**（署名の有無・universal/単一 arch を問わず）ウインドウ生成時に
   即クラッシュする、電子アプリとしては致命的なバグだった。`LSMinimumSystemVersion: "11.0"` とクォートして解消。
   （YAML で Info.plist 由来のバージョン文字列を書くときは必ず文字列クォートすること）
7. **【重要】`electron-updater` を `main.ts` のトップレベルで静的 import（`import { autoUpdater } from "electron-updater"`）
   していたため、パッケージ済み `.app` が `app.whenReady()` に到達する前にハングしていた**（メインプロセスは
   生きているが何もログを出さず、backend 子プロセスもウインドウも一切作られない）。原因は未確定だが、electron-builder が
   `publish` 設定時に本来生成するはずの `app-update.yml` がパッケージに含まれておらず、`electron-updater`
   のモジュール初期化コードがこれを同期的に参照しようとしてハング/例外した可能性が高い。`main.ts` では
   `electron-updater` を事前 import せず、起動 10 秒後の自動更新チェック実行時にのみ動的 `import("./autoUpdate.js")`
   するよう変更し解消。実際にパッケージ済み `.app` を起動し backend healthz 200 / フロント 200 を確認して修正を検証済み。
8. **electron-builder の共通 `extraResources` で `resources/backend-bin/` 全体（mac/win/linux 全プラットフォーム分）を
   すべてのパッケージに同梱していた（各パッケージが不要な他 OS 向けバイナリも含むことになり、パッケージサイズが約333MBS余分に肥大化**
   — `mac:`/`win:`/`linux:` 各セクションにプラットフォーム固有の `extraResources` フィルタ（`vyline-backend-darwin-*` 等）を
   追加して解消。合わせて `scripts/buildBackend.ts` の default（ホスト OS のみ）を使うと win/linux パッケージに
   **間違って mac のバイナリだけ**が入る致命的なバグも発見（Windows/Linux 実機では起動すらできない）。
   `package.json` に `build:backend:all`（`--all` フラグで 4 ターゲット全てコンパイル）を追加し、`build:win`/`build:linux`/`build:mac*` 全てが
   これを呼ぶよう変更して解消。

すべて実機（このリポジトリのビルド環境、Apple Silicon mac）で

- `bun run electron:dev` 相当（`electron dist/main.js`、backend は `bun run` 経由）
- `bun run build:mac:arm64:dir` で生成した単一 arch `.app` の直接起動
- `bun run build:mac:dir` で生成した universal `.app` の直接起動

の3パターンで「起動 → backend healthz 200 → フロント `/` 200 → ログイン画面が実際に QR セッションを
LINE サーバーから取得できる」ところまで確認済み。

## 未検証・今後の課題

- **実際の codesign + notarization**（Apple Developer ID が必要。このセッションでは `CSC_IDENTITY_AUTO_DISCOVERY`
  切り替えとローカル ad-hoc 証明書での動作確認まで）。実テストには実在の Apple Developer Program アカウント（有料）が
  必要で、CI でもサンドボックスでも用意不可。`APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID`（または
  `CSC_LINK`/`CSC_KEY_PASSWORD`）を GitHub Secrets に登録した人間オペレータが CI ワークフローに追加すれば
  自動化可能（electron-builder はこれらの環境変数を自動検知する）。
- dmg / zip の実際の作成（`--dir` 型の `.app` 検証のみ実施。`hdiutil` 経由の dmg 作成はビルド時間の都合で未実施）
- ~~Windows (nsis) / Linux (AppImage) の実機ビルド・起動確認（mac のみ実施）~~ →
  **（2026-08-20 解消）** `.github/workflows/ci.yml` の `electron-smoke-test` ジョブ（matrix: macos-latest /
  windows-latest / ubuntu-latest）が、各 OS の **実ランナー**上でネイティブビルド（cross-compile 不要）し、
  パッケージ済みアプリを実際に起動して `/healthz` が 200 を返すまで確認する。このセッションの macOS サンドボックスでは
  実際の Windows/Linux マシンを使えない制約を、GitHub Actions の実 runner で補完する設計。
  **限界**: このワークフローは push/PR で実際に実行されるまで結果を確認できない（このセッション中に GitHub 上で
  実行して結果を見ることはできない）。Linux 実行ファイル名の推定は `find` で動的に解決することで
  ハードコードのリスクを回避済み。
- 通話（WebRTC 相当 / getUserMedia）の実マイク/カメラでの動作確認（`setPermissionRequestHandler` の許可のみ確認）
- ~~自動アップデート~~ → **（2026-08-20 実装）** `src/autoUpdate.ts` で `electron-updater` 統合済み（詳細は上記「既知の問題と対応」7番参照）
- カスタムタイトルバー（現状 mac 標準の frame。`-webkit-app-region` 等を使った Telegram 風の
  没入型タイトルバーにするなら、フロント側の CSS 対応とセットで別タスク）
