# SBC 鍵取り出し（Secure Backup Client / クラウドバックアップ）

最終更新: 2026-08-24

LINE クラウドバックアップから **鍵の束（E2EE 鍵 / PIN / masterKey）を取り出す** 手順と実装位置のまとめ。
SBC 自体はトーク復元を行わない。全体像は次の 4 段階:

1. **SBC 鍵取り出し**（本ドキュメント。実装済み・検証済み）
2. KBCS/LKBS4 RPC でクラウドから blob 取得（`/EKBS4` `/LKBS4` ラッパー実装済み、実データ検証はこれから）
3. 鍵 + blob でメッセージ復号（未検証）
4. Vyline store へ流し込み（未実装）

参照 upstream: [q0jt/line-sbc](https://github.com/q0jt/line-sbc)（Go 正本）→ `src/sbc/` に TS 移植。

---

## エンドポイント対応表

出典: line-sbc `resource/README.md` + `resource/backup.thrift`

| サービス                       | パス      | 役割                                   |
| ------------------------------ | --------- | -------------------------------------- |
| E2EEKeyBackupService           | `/EKBS4`  | E2EE 鍵束の backup/restore             |
| E2eeKeyBackupCertificateServer | `/KBCS`   | HSM 系証明書 (getKeyBackupCertificatesV2) |
| E2EELifetimeKeyBackupService   | `/LKBS4`  | トーク履歴本体（lifetime payload）     |

すべて protocolType=4（compact）。例外は共通で `E2EEKeyBackupException`
（`code` / `reason` / `parameterMap`）。`RequestClient.EXCEPTION_TYPES` に
`/EKBS4` `/LKBS4` を登録済み。

### 主な RPC

- `/EKBS4`: `getE2EEKeyBackupCertificates` / `getE2EEKeyBackupInfo` /
  `restoreE2EEKeyBackup` / `createE2EEKeyBackupEnforced` / `deleteE2EEKeyBackup`
- `/LKBS4`: `createLifetimeKeyBackup` / `restoreLifetimeKeyBackupHeader` /
  `validateLifetimeKeyBackup` / `addLifetimeKeyBackupPayloadDataList` /
  `updateLifetimeKeyBackupHeader` / `getLifetimeKeyBackupPayloadDataList`

## 実装位置

| 内容                                | ファイル                                                                                     |
| ----------------------------------- | -------------------------------------------------------------------------------------------- |
| TS 移植本体（claim 復号エンジン）   | `Vyline/packages/protocol/src/sbc/mod.ts`                                                    |
| msgpack                             | `Vyline/packages/protocol/src/sbc/msgpack.ts`                                                |
| テスト（5 本、全緑）                | `Vyline/packages/protocol/src/sbc/sbc.test.ts`                                               |
| Go 相互検証 JSON 出力               | `Vyline/packages/protocol/src/sbc/crosscheck.ts`                                             |
| サーバー証明書（バンドル）          | `Vyline/packages/protocol/src/sbc/certs/*.pem`                                               |
| `/EKBS4` サービスラッパー           | `Vyline/packages/protocol/stack/base/service/e2eekeybackup/mod.ts`                           |
| `/LKBS4` サービスラッパー（手書き） | `Vyline/packages/protocol/stack/base/service/e2eelifetimekeybackup/mod.ts`                   |
| Thrift struct writer 追加分         | `Vyline/packages/protocol/stack/base/thrift/readwrite/struct.ts`（restore 系 + lifetime 系） |
| 型定義追加分                        | `Vyline/packages/line-types/{thrift,line_types}.ts`                                          |
| 抽出 CLI                            | `Vyline/backend/src/tools/sbcBackupExtract.ts`（`bun run vyline:sbc-extract`）               |

## 鍵取り出しフロー（PIN 経路・v2 claim）

```
mid, PIN, 証明書PEM
  → RestoreClaim.createFromPin(mid, pin, certPem)      … src/sbc/mod.ts
  → restoreE2EEKeyBackup({request:{restoreClaim}}) on /EKBS4
      → { recoveryKey, blobPayload }
  → claim.Restore(recoveryKey, blobPayload)
      → BackupKeys { e2eeKeys[], passcode?, masterKey? }
```

証明書は `getE2EEKeyBackupCertificates()` の `urlHashList` の各要素を
`https://obs.line-scdn.net/{certificateId}` に GET すると PEM が取れる
（取れない場合は `src/sbc/certs/` のバンドル証明書へフォールバック）。

password 経路（v3 claim）: `createFromPassword(mid, password).claim(cert)` →
`RestoreClaimV3`。v3 の AAD 構造は推測混りで未検証。

## アルゴリズム仕様（不変・検証済み範囲）

- claim v2 = msgpack `[2, ts(u64), tempKey(bin64), [1]+RAW(wrap), enc]`
- wrap = `[serverPubRaw64, ctrWrap(seed)]`
- `cs = HKDF(ECDH, nil, "CLAIM_SHARED", 32)`
- `pek = HKDF(seed, mid, "CLAIM_SEED", 28)`
- `h  = Argon2id(pin, salt=mid, AD="ARGON2_PIN", t=4, m=128MiB, p=4, len16)`
- `enc = AES-GCM(pek[:16], pek[16:], h, aad=BE64(ts))`
- 復元側: `rs = HKDF(seed, nil, "RESTORE_SEED", 32)` → masterKey = CTR
- blob = `[1, metaRaw(AAD), GCM(slots)]`, slots = `[e2eeJSON, pin, masterKey]`

## 検証状況

- `bun test src/sbc/` → 5/5 pass（msgpack×2 / argon2id+AD / E2E PIN→claim→verify→鍵復元 / 共有シークレット）
- Go↔TS クロスベリファイ PASS: TS 固定鍵 claim → Go verifier
  （`sbc/verifytool/main.go`、サーバー側 ECDH→seed 復元→GCM 検証→internal
  argon2 IDKeyWithAssociatedData 再計算）→ seed 一致
- noble ciphers v2 注意点: `ctr` / `gcm` は直接 export、`p256.getPublicKey(priv, false)`
  （非圧縮必須）

## 実機検証 (2026-08-24)

実アカウント（QR 再ログイン後）での結果:

- `getE2EEKeyBackupCertificates` → urlHashList 1件、`https://obs.line-scdn.net/{id}` から PEM 取得 OK (920 bytes)
- `getE2EEKeyBackupInfo` → `blobHeaderHash` / `blobPayloadHash` あり、`missingKeyIds: []`
  → サーバーに E2EE 鍵バックアップが存在
- `--pin <6桁> --save-keys` → **restore 成功**。鍵束:
  - `e2eeKeys`: **16 本**（keyID 4906343 [2022-07] 〜 5953546 [2026-08]、全て version=1）
  - `passcode` / `masterKey`: なし（PIN 運用のため正常）
  - 保存先: `Vyline/data/sbc-extract/sbc-keys-<ts>.json`（gitignore 対象確認済み）

### SBC 復元鍵のエンコード形式（未解決）

復元された `encoded_private_key` / `encoded_public_key` は **64 文字の base64 文字列で
デコードすると 48 バイト**になる。検証済みの事実:

- DER/PKCS#8 ヘッダなし（先頭バイトが `30` 開始でない）
- hex 文字列ではない（`[0-9a-f]{64}` に非一致）
- 同一 keyId の既存 Desktop 鍵（v1 Curve25519・32 バイト）と
  どの 32 バイトオフセットでも一致しない
- Curve25519 導出不一致（どの区間を seed にしても公開鍵が再導出されない）
- line-sbc (`blob.go`) も `encoded_*` を不透明文字列として扱う（デコード実装なし）
  → 公式クライアント固有のエンコード（別曲線 / ラップ済み等）の可能性

→ 現状、SBC 復元鍵をそのまま v1 E2EE（Curve25519）として使うことはできない。
`normalizeDesktopE2EEKey` は 32 バイト Curve25519 以外を安全にスキップする。
LKBS4 lifetime backup の payload 復号と合わせ、今後の解析課題。
- LKBS4 `restoreLifetimeKeyBackupHeader` → **`NO_BACKUP` ("no backup")**
  - claim 認証は通っている（AUTHENTICATION_FAILED ではない）ため、
    当該アカウントにはサーバー側トーク履歴バックアップ（lifetime backup）が存在しないことが確定
  - → SBC 経由の「サーバー保管履歴ペイロード抽出」対象なし。
    履歴取り出しは通常のメッセージ取得 + ローカル復号経路で行う
- SBC 復元 16 鍵は既存 Desktop dump (`desktop-e2ee-keys.json`, 23本) の部分集合だった
  （sbc only = 0件）。Vyline storage の `e2eeKeys:<keyId>` は 23本すべて import 済み
- 復号動作確認: BFF `GET /line/main/messages/:chatMid` でテストグループ 50 件取得、
  テキスト正常復号・E2EE エラーフラグなし

### iOS のトーク履歴バックアップは iCloud 行き（HAR 検証）

ユーザーが iOS LINE でバックアップ実行中にキャプチャした HAR
（legy-jp.line-apps.com_2026_08_24_01_33_54.har、79 entries）の解析:

- `/LKBS4` `/EKBS4` `/KBCS` への呼び出しは **0**
- `/S4` は `updateNotificationTokenWithBytes` / `getConfigurations` / `noop` /
  `getSettingsAttributes` のみ（通常同期系）
- `gateway.icloud.com` への CONNECT トンネルが 25+（バックアップ本体は iCloud 宛・TLS で非表示）
- → **iOS 版のトーク履歴バックアップは iCloud 保存**であり LINE サーバーには載らない。
  LKBS4 `NO_BACKUP` の理由がこれで確定。iCloud バックアップは第三者クライアントから参照不可

## CLI の使い方

```powershell
# 情報確認だけ（restore しない・安全）
bun run vyline:sbc-extract -- --account main --info

# PIN で鍵束復元まで（※ 誤 PIN は max10 回で永久ロック。推測試行禁止）
bun run vyline:sbc-extract -- --account main --pin <6桁PIN> --save-keys

# password 経路（v3）
bun run vyline:sbc-extract -- --account main --password "..." 

# LKBS4 を飛ばす / 保存先指定
bun run vyline:sbc-extract -- ... --skip-lkbs --out Vyline/backend/data/sbc-extract
```

- メッセージ送信は行わない（読み取り系 RPC のみ）
- 鍵ファイルは `Vyline/backend/data/` 配下（gitignore 対象・コミット禁止）

## LKBS4（トーク履歴本体）の現状

- thrift 定義は line-sbc `resource/backup.thrift` 由来で型・writer・ラッパーまで実装済み
  - `restoreLifetimeKeyBackupHeader(restoreClaim) → {recoveryKey}`
  - `getLifetimeKeyBackupPayloadDataList(metadataList) → payloadDataList[{metadata, blobPayload}]`
- payload blob（`LifetimePayloadData.blobPayload`）の**復号アルゴリズムは未解明**
  （line-sbc も未実装）。metadata の `e2ee.e2EEPublicKeyId` / `singleValue.type`
  (`INITIAL_BACKUP_ENCRYPTION_KEY`) と鍵束の中身（masterKey 等）からの導出を検証する段階

## 未検証リスク

- v3 claim（password 経路）の AAD 構造
- LKBS4 payload の暗号方式・鍵導出
- `restoreLifetimeKeyBackupHeader` のみでヘッダ状態が変わる可能性（サーバー側 state machine）
