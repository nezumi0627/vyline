# E2EE 復号ジャーニー（発見済み経路）

最終更新: 2026-08-24
状態: Phase 1 進行中 — 事実ベースのメモ。仮説は明示する。

---

## 結論（短く）

1. **Desktop は過去の全自己鍵を keychain に持つ。** Vyline も最新鍵だけでは履歴が復号できない。
2. **送信**はサーバ上の **最新 E2EE 公開鍵** に対応する秘密鍵が必須。無い／不一致だと `E2EE_UPDATE_SENDER_KEY`。
3. Desktop 稼働中メモリから抽出した `desktop-e2ee-keys.json` を置き、`ensureValidE2EEIdentity` で取り込む。
4. それでも復号できないメッセージは空ではなく `E2EE_UNAVAILABLE`（「暗号化メッセージ（復号キーなし）」）と表示する。

---

## Desktop 側の鍵の置き場

| 場所                       | 内容                          | 備考                             |
| -------------------------- | ----------------------------- | -------------------------------- |
| メモリ keychain            | 自己鍵ペア一式（過去分含む）  | **稼働中 LINE.exe** から抽出可能 |
| `.edb` (wxSQLite3)         | ローカル DB（暗号化 at rest） | ディスクからの直接読取は未確立   |
| サーバ `getE2EEPublicKeys` | 登録済み **公開鍵** のみ      | 秘密鍵はサーバに無い             |

Vyline が必要とするのは:

- **履歴復号:** メッセージ chunks が指す **過去の自己鍵**（receiver / 自分送信分の sender）
- **送信:** サーバ最新 `keyId` の秘密鍵（mid 既定鍵）

---

## Vyline 取り込みフロー

```
LINE.exe (running)
    │ メモリ抽出（手順は desktop-reverse-methods.md）
    ▼
Vyline/backend/data/desktop-e2ee-keys.json   ← gitignore
    │
    ▼
loadDesktopE2EEKeyDump / importDesktopE2EEKeys
    │  ・鍵ペア検証 (verifyE2EEKeyPair)
    │  ・サーバ公開鍵と一致するものを優先
    │  ・サーバに無い keyId も履歴用に保存可
    ▼
ensureValidE2EEIdentity
    │  ・一致鍵をすべて残す
    │  ・mid 既定 = サーバ最新 keyId の秘密鍵
    │  ・最新の秘密鍵が無ければ registerE2EEPublicKey（旧鍵は消さない）
    ▼
linejs storage: e2eeKeys:{keyId} / e2eeKeys:{mid}
```

### 主要ファイル

| ファイル                                                  | 役割                               |
| --------------------------------------------------------- | ---------------------------------- |
| `Vyline/packages/protocol/src/login/ensureE2EE.ts`        | 検証・import 呼び出し・sender 修復 |
| `Vyline/packages/protocol/src/login/importDesktopE2EE.ts` | JSON dump → storage マージ         |
| `Vyline/backend/src/service/lineService.ts`               | 取得時 decrypt / 送信時 ensure     |
| `Vyline/backend/src/api/debug.ts`                         | `/debug/decrypt-test/...`          |
| `Vyline/apps/desktop/src/utils/format.ts`                 | `E2EE_UNAVAILABLE` ラベル          |

Dump 探索パス（`ensureE2EE.ts`）:

1. `Vyline/backend/data/desktop-e2ee-keys.json`（リポジトリルート cwd 想定）
2. `data/desktop-e2ee-keys.json`
3. cwd 相対 `data/desktop-e2ee-keys.json`

---

## dump JSON 形（概念）

```json
{
  "mid": "<optional>",
  "extractedAt": "<ISO8601>",
  "keys": [
    {
      "keyId": 12345,
      "privKey": "<base64>",
      "pubKey": "<base64>",
      "e2eeVersion": 1
    }
  ]
}
```

**実値を docs / git に書かない。** ファイルは `.gitignore` 済み。

---

## linejs 復号の要点

1. E2EE メッセージは `msg.chunks` を持つ。
2. `chunks[3]` / `chunks[4]` などから **senderKeyId / receiverKeyId** を復元する（Vyline は `chunkKeyId` でバイト列→数値）。
3. `client.base.e2ee.decryptE2EEMessage(msg)` が対応するローカル秘密鍵と相手公開鍵を使って復号する。
4. `contentType` は数値で来ることがある → `"NONE"` / `"LOCATION"` 等に正規化してから渡す（`lineService.ts`）。
5. グループは `ensureGroupE2EEKey` でグループ鍵を事前確保。

### BAD_DECRYPT 時の再試行

`lineService.decryptE2EEMessageSafe`:

1. 初回 `decryptE2EEMessage` 失敗（`BAD_DECRYPT` / OPENSSL auth 系）
2. 該当 `e2eePublicKeys:{sender|receiver}` と `e2eeGroupKeys:{chatMid}` を削除
3. グループ鍵を再確保して再 decrypt
4. 再失敗 → raw msg を返す（後段で UI 用に失敗判定）

---

## 失敗モードと UI

| 観測                                     | 意味                               | UI / 挙動                                                    |
| ---------------------------------------- | ---------------------------------- | ------------------------------------------------------------ |
| `BAD_DECRYPT`                            | 鍵不一致・キャッシュ不整合・鍵欠落 | 再試行後も失敗なら chunks あり・text 空 → `E2EE_UNAVAILABLE` |
| 空メッセージ (`NONE` + 空 text + chunks) | 実質復号失敗                       | 「🔒 暗号化メッセージ（復号キーなし）」                      |
| `E2EE_UPDATE_SENDER_KEY`                 | mid 鍵がサーバ最新でない           | `forceNewSenderKey` で新規登録して再送                       |
| `E2EE_UNAVAILABLE` (contentType)         | フロント向け明示フラグ             | `format.ts` の `contentTypeLabel`                            |

---

## 送信経路

1. `resolveMyMid` で profile をロード（encrypt が mid を参照）
2. `ensureValidE2EEIdentity`
3. `ensureGroupE2EEKey`（グループ時）
4. `sendMessage({ to, text, e2ee: true })`
5. sender key エラー → `ensureValidE2EEIdentity({ forceNewSenderKey: true })` → 1 回再送
6. その他 E2EE エラーはプレーン再送フォールバックあり（`lineService.ts`）

---

## 復旧手順（運用）

### A. 履歴が読めない

1. 公式 LINE Desktop を起動し、対象アカウントでログイン済みにする。
2. メモリから自己鍵一式を抽出し、`Vyline/backend/data/desktop-e2ee-keys.json` に保存（手法は [desktop-reverse-methods.md](./desktop-reverse-methods.md)）。
3. Vyline backend を再起動（または login / ensure を再実行）。
4. `GET /debug/decrypt-test/:accountId/:chatMid?limit=50` で成功率を確認。
5. まだ失敗するメッセージは、Desktop 側でも読めないか・別デバイス専用鍵かを切り分ける。

### B. 送信が `E2EE_UPDATE_SENDER_KEY`

1. ログで `ensureValidE2EEIdentity` の `serverLatestKeyId` と `keyId` を確認。
2. 自動回転が走る想定。手動なら debug 経由で `forceNewSenderKey`。
3. **旧鍵は消さない**（履歴復号用）。新規は送信専用の最新として mid に載せる。

### C. 空吹き出しになる

1. backend が `E2EE_UNAVAILABLE` を付けているか確認（古いフロントだとラベル未対応）。
2. dump の keys 件数とサーバ keyIds の overlap を確認。

---

## 既知の制限

- linejs ログイン **前** の過去メッセージは、Desktop keychain 無しでは復号できないことが多い。
- `.edb` からの直接鍵抽出は未実装（wxSQLite3）。
- 相手側の鍵ローテーション直後は公開鍵キャッシュが古く、`BAD_DECRYPT` → キャッシュクリア再試行が必要。

---

## 参照

- [desktop-reverse-methods.md](./desktop-reverse-methods.md)
- [../login-flow.md](../login-flow.md)
- [../tasks/PHASES.md](../tasks/PHASES.md) Phase 1
