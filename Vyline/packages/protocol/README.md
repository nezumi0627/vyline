# @vyline/protocol (Vyline)

LINE Desktop Windows の identity / E2EE を追従しつつ、セッションは副端末で公式 Desktop と併存できるパッケージ。

- **既定**: `ANDROIDSECONDARY`（公式 `DESKTOPWIN` と同時ログイン可）
- **オプトイン**: `VYLINE_DEVICE=DESKTOPWIN` で Desktop 関数レベル完全エミュ（公式を蹴る）

同時ログイン調査: リポジトリ `docs/analysis/dual-login-desktop.md`

---

## デバイスモード (`VYLINE_DEVICE`)

| 値                 | 既定 | 効果                                                        |
| ------------------ | ---- | ----------------------------------------------------------- |
| `ANDROIDSECONDARY` | ○    | 副端末。公式 Desktop / スマホと共存                         |
| `IOSIPAD`          |      | 副端末（代替）                                              |
| `DESKTOPWIN`       |      | Desktop ヘッダー・login パッチ適用。公式 Win Desktop を蹴る |
| `DESKTOPMAC`       |      | 公式 Mac Desktop を蹴る                                     |

```powershell
$env:VYLINE_DEVICE = "ANDROIDSECONDARY"  # 省略時もこれ
$env:VYLINE_DEVICE = "DESKTOPWIN"        # 互換調査用
```

---

## アーキテクチャ

```
VylineUpdater ──detect/refresh──► DesktopProfile (UA / X-Line-Application / hosts)
        │
        ▼
VylineClient (@vyline/protocol/stack + Desktop patches)
  ├─ deviceMode             … VYLINE_DEVICE（既定 ANDROIDSECONDARY）
  ├─ patchDesktopTransport  … DESKTOP* 時のみヘッダー上書き
  ├─ patchDesktopLogin      … DESKTOP* 時のみ QR / Email RPC 上書き
  ├─ ensureValidE2EEIdentity … 自己鍵の検証・Desktop 鍵 import
  └─ talk / call            … Vyline プロトコルスタック TalkService (/S4 系)
```

| 領域                   | 主なファイル                                      |
| ---------------------- | ------------------------------------------------- |
| 公開 API               | `src/index.ts`                                    |
| Desktop 検出・identity | `src/desktop/*`                                   |
| 更新追従               | `src/updater/VylineUpdater.ts`                    |
| ログイン / E2EE        | `src/login/*`                                     |
| クライアント Facade    | `src/client/VylineClient.ts`                      |
| 機能→調査地図          | `src/modules.map.ts`（13 features）               |
| Domain facade          | `src/domain/`（profile / chat / contacts / talk） |
| RPC 辞書               | `src/dictionary/rpcMap.ts`                        |
| Desktop 差分 CLI       | `src/tools/reportDesktopDelta.ts`                 |

ドキュメント: [protocol/dictionary.md](../../docs/protocol/dictionary.md) / [CONTRIBUTING.md](../../docs/CONTRIBUTING.md)

Backend は `Vyline/backend/src/vyline/profileBridge.ts` 経由で `VylineUpdater` を起動時に初期化する。

---

## Login

### QR

1. `loginWithQR` → プロトコルスタック `withQrCode`
2. `patchDesktopLogin` が `qrCodeLoginV2ForSecure` の `systemName` / `modelName` を実 PC 名に置換  
   (`pcIdentity.ts`: ホスト名 + WMI Model)
3. エンドポイントは Desktop と同じ `/acct/lgn/sq/v1`・`/acct/lp/lgn/sq/v1`

### Email (E2EE)

1. `getRSAKeyInfo` → **必ず** `/api/v3/TalkService.do` (v4 は x-lc:400)
2. `loginV2` / `confirmE2EELogin` → `/api/v3p/rs` (Desktop は v3p。v4p は Android 系)
3. `/LF1` で keychain 取得 → `decodeE2EEKeyV1` パッチが keychain 内の**全鍵**を保存
4. 詳細フローはリポジトリの `docs/login-flow.md`

### Token

`loginWithToken` で accessToken 復元。復元後も transport / E2EE ensure を通す。

---

## ヘッダー / Transport

Desktop 実測 (区切りは **TAB `0x09`**):

```
user-agent: DESKTOP:WINDOWS:10.0.26100-11NT(26.3.0.3916)
x-line-application: DESKTOPWIN\t26.3.0.3916\tWINDOWS\t10.0.26100-11NT
x-lal: ja_JP
x-lpv: 1
x-lap: 5
Host: legy-jp.line-apps.com
```

`VylineUpdater` の優先順:

1. 稼働中 `LINE.exe` メモリダンプ (`extract.ts`)
2. インストール版 + OS から合成
3. キャッシュ `desktop-profile.json`
4. `data/desktop-profile.fallback.json`

パス定数 (`patchTransport.ts`):

- Auth: `/api/v3p/rs`
- RSA: `/api/v3/TalkService.do`
- Talk: `/S4`

---

## E2EE

| 処理                               | 担当                                           |
| ---------------------------------- | ---------------------------------------------- |
| Desktop 鍵 JSON 取り込み           | `importDesktopE2EE.ts`                         |
| サーバ最新鍵との整合・送信鍵ローテ | `ensureE2EE.ts`                                |
| 送受信                             | backend `lineService.ts` + Letter Sealing E2EE |

既定の Desktop 鍵ダンプ置き場:

- `Vyline/backend/data/desktop-e2ee-keys.json` (gitignore)

ログイン**前**の履歴は、Desktop と同じ自己鍵が揃っていないと復号できないことがある。  
送信はサーバ最新 `keyId` の秘密鍵が必須。無いと `E2EE_UPDATE_SENDER_KEY`。

---

## 拡張の仕方

1. **新機能を足す**
   - まず `modules.map.ts` に FEATURE を追加し、触るファイルと Desktop 検索文字列を書く
   - 実装は小さなモジュールに分け、`index.ts` から明示 export

2. **Desktop 更新で壊れた**

   ```powershell
   bun run vyline:delta
   ```

   レポートの suggested modules を優先度順に確認する。  
   手順: `docs/tools/desktop-delta.md`

3. **ヘッダーだけ追従したい**
   - `VylineUpdater.refresh()` または backend `POST /debug/vyline/refresh`

4. **RPC パスが変わった**
   - `LINE.exe` で strings 検索 → `patchTransport.ts` / `patchLogin.ts` を更新
   - 結果を `docs/analysis/<feature>.md` に残す

---

## 開発コマンド

```powershell
# パッケージ単体
cd Vyline/packages/protocol
bun run delta

# リポジトリルート
bun run vyline:delta
```

依存: 内部 `stack/`（Thrift RPC）、`@vyline/line-types`（型のみ vendored）。backend は workspace 経由で `@vyline/protocol` を利用。

---

## Domain facade（プロフィール・グループ等）

ログイン済み `Client` を `wrapSession(client)` で包み、機能別に呼び出す。

| Domain   | ファイル                 | 主な操作                                   |
| -------- | ------------------------ | ------------------------------------------ |
| Profile  | `src/domain/profile.ts`  | 自分プロフィール取得・更新・アバター・背景 |
| Contacts | `src/domain/contacts.ts` | 他人取得・表示名 override                  |
| Chat     | `src/domain/chat.ts`     | グループ名・画像                           |
| Talk     | `src/domain/talk.ts`     | 送信・取消・既読                           |
| Session  | `src/domain/session.ts`  | 上記をまとめた `VylineSession`             |

backend は `lineService.ts` から `wrapSession` 経由で利用。HTTP は `backend/src/api/line.ts`。

---

## 公開 export

`src/index.ts` を正とする。主なもの:

- Types: `DesktopProfile`, `DesktopIdentity`, `FeatureId`, …
- Updater: `createVylineUpdater`, `detectInstalledDesktop`
- Client: `loginWithEmail` / `loginWithQR` / `loginWithToken` / `sendText`
- E2EE: `ensureValidE2EEIdentity`, `importDesktopE2EEKeys`
- Map: `MODULES_MAP`, `listFeatures`, `suggestedFeaturesOnDesktopUpdate`
- Domain: `VylineSession`, `wrapSession`, `ProfileDomain`, …
- Dictionary: `RPC_DICTIONARY`, `findRpc`, `listRpcByCategory`
