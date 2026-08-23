# Login Flow

最終更新: 2026-08-24

旧実装 (Go + Wails) で確認済みの LINE ログインフロー。linejs 移行後も参考になる。

---

## QR ログインフロー

```
1. createSession()
   POST /acct/lgn/sq/v1
   → { sessionId: "SQ..." }

2. createQrCodeForSecure(sessionId)
   POST /acct/lgn/sq/v1
   → { qrCodeUrl: "https://line.me/R/au/lgn/sq/SQ...",
       expiredIn: 2,          ← 分単位
       returnCode: 150,
       pinCode: "<32文字の認証キー>" }

3. checkQrCodeVerified(sessionId)
   POST /acct/lp/lgn/sq/v1  (long polling)
   x-line-access: "SQ..."
   → タイムアウト (status 0) = まだスキャンされていない
   → 200 = スキャン済み

4. verifyCertificate(sessionId, curve25519PublicKey)
   POST /acct/lgn/sq/v1
   → { accessToken: "eyJ...", certificate: "..." }
```

---

## メールログイン E2EE フロー

```
1. Curve25519 鍵ペア生成 (secretKey, publicKey)

2. e2eeData = AES-ECB(SHA256("114514"), publicKey)

3. getRSAKeyInfo(identityProvider=0)
   POST /api/v3/TalkService.do
   → { keyId, n_hex, e_hex, session_key }

4. RSA 暗号化
   plain = chr(len(sk)) + sk + chr(len(email)) + email + chr(len(pw)) + pw
   encrypted = RSA_PKCS1_v1_5(plain, pubKey)

5. loginV2(loginType=2, keynm=keyId, encData=encrypted, e2eeData)
   POST /api/v3p/rs
   → { verifier: "...", status: 3 }

6. GET /LF1
   x-line-access: verifier
   → e2eeInfo.metadata (serverPublicKey, encryptedKeyChain)

7. deviceSecret = encryptDeviceSecret(serverPubKey, ourSecretKey, encryptedKeyChain)
   = AES-ECB(SHA256(sharedSecret || "Key"), xor(SHA256(encryptedKeyChain)))

8. confirmE2EELogin(verifier, deviceSecret)
   POST /api/v3p/rs
   → e2eeLogin (verifier)

9. loginV2(loginType=1, keynm, encData, e2eeData, verifier=e2eeLogin)
   POST /api/v3p/rs
   → { tokenInfo: { accessToken: "eyJ...", refreshToken: "eyJ..." } }
```

---

## 共通ヘッダー (LINE Desktop Windows — 実ランタイム確認)

Vyline / VylineUpdater が Desktop 実体から追従する形式。
`X-Line-Application` の区切りは **TAB (0x09)**（表示上ドットに見えることがある）。

```
user-agent: DESKTOP:WINDOWS:10.0.26100-11NT(26.3.0.3916)
x-line-application: DESKTOPWIN\t26.3.0.3916\tWINDOWS\t10.0.26100-11NT
x-lal: ja_JP
x-lpv: 1
x-lap: 5
content-type: application/x-thrift
accept-encoding: gzip
x-line-access: <token>   ← ログイン後のみ
Host: legy-jp.line-apps.com
```

### Desktop 関数レベル対応 (Vyline)

| 処理       | Desktop (LINE.exe)                                                                   | Vyline                                        |
| ---------- | ------------------------------------------------------------------------------------ | --------------------------------------------- |
| QR         | createSession → createQrCodeForSecure → checkQrCodeVerified → qrCodeLoginV2ForSecure | 同左。systemName=ホスト名, modelName=PCモデル |
| Email RSA  | getRSAKeyInfo @ `/api/v3/TalkService.do`                                             | 同左                                          |
| Email Auth | loginV2 / confirmE2EELogin @ `/api/v3p/rs`                                           | 同左。fid12=PCモデル                          |
| Talk       | `/S4` sendMessage / getProfile                                                       | linejs TalkService (DESKTOPWIN→/S4系)         |

出典: 稼働中 LINE.exe (26.3.0.3916) プロセスメモリ + `%LOCALAPPDATA%\LINE`。

---

## エンドポイント一覧

| パス                     | ホスト                  | 用途                                            |
| ------------------------ | ----------------------- | ----------------------------------------------- |
| `/acct/lgn/sq/v1`        | `legy-jp.line-apps.com` | QR セッション・QR コード生成・verifyCertificate |
| `/acct/lp/lgn/sq/v1`     | `legy-jp.line-apps.com` | QR スキャン確認 (long polling)                  |
| `/api/v3/TalkService.do` | `legy-jp.line-apps.com` | getRSAKeyInfo                                   |
| `/api/v3p/rs`            | `legy-jp.line-apps.com` | loginV2 / confirmE2EELogin                      |
| `/LF1`                   | `legy-jp.line-apps.com` | E2EE 鍵情報取得                                 |
| `/S4`                    | `legy-jp.line-apps.com` | TalkService (メッセージ等)                      |
| `/SQ1`                   | `legy-jp.line-apps.com` | fetchMyEvents (long polling)                    |
| `/CH4`                   | `legy-jp.line-apps.com` | Channel                                         |
| `/RE4`                   | `legy-jp.line-apps.com` | RelationService                                 |

---

## Thrift Compact Protocol

旧実装で確認済みの仕様。linejs が内部で処理するため通常は意識不要。

```
[0x82] [type<<5 | version=1] [seq_id zigzag varint] [name_len varint] [name]
フィールド: [(delta<<4 | type)] または [0x00, fid zigzag varint, type]
文字列: [len varint] [data]
i32/i64: [zigzag varint]
```

**注意**: struct ネスト時は `lastFID` をスタックで管理する必要がある。

---

## Token 保存

```json
// %APPDATA%/Vyline/session.json (旧実装)
// 新実装では SQLite に暗号化保存
{
  "accessToken": "eyJ...",
  "refreshToken": "eyJ...",
  "certificate": "...",
  "device": "IOSIPAD"
}
```

> **同時ログイン**: Vyline 既定は `IOSIPAD`（`VYLINE_DEVICE`）。  
> `DESKTOPWIN` のままだと公式 LINE Desktop Windows と同じスロットを占有し、互いにキックする。  
> 詳細: [docs/analysis/dual-login-desktop.md](./analysis/dual-login-desktop.md)

---

## Vyline（protocol）での実装方針

外部 `@evex/linejs` は使わない。backend が `@vyline/protocol` 経由でログインする。

```typescript
import { loginWithQR, loginWithEmail, loginWithToken } from "@vyline/protocol";

// QR ログイン（backend: POST /auth/qr 等）
const session = await loginWithQR({/* … */});

// メールログイン（E2EE フロー — 本ドキュメント前半参照）
const session = await loginWithEmail({ email, password });

// トークン復元
const session = await loginWithToken({ accessToken, refreshToken });
```

- Desktop ヘッダー追従: `patchDesktopTransport` / `VylineUpdater`
- ログイン RPC パッチ: `patchDesktopLogin`（DESKTOPWIN 時）
- 詳細: [packages/protocol/README.md](../Vyline/packages/protocol/README.md)

---

## 既知の制限（E2EE / 履歴）

- 一部環境で、**Vyline ログイン前に届いた過去メッセージ**は E2EE 復号に失敗することがある。
- この現象は `BAD_DECRYPT` として観測される場合がある。
- Vyline はログイン後に Desktop 抽出の E2EE 自己鍵一式を取り込み、サーバ公開鍵と照合する。
- 公式 Desktop が復号できる過去メッセージは、同じ自己鍵（keychain）があれば Vyline でも復号できる。
- それでも復号できない場合は「暗号化メッセージ（復号キーなし）」と表示する。
- Desktop 鍵の取り込み: `Vyline/backend/data/desktop-e2ee-keys.json`（LINE.exe 稼働中にメモリ抽出）を置くと自動 import。
- **送信**はサーバ上の最新 E2EE 公開鍵の秘密鍵が必須。無い／不一致だと `E2EE_UPDATE_SENDER_KEY` になる。
  その場合は旧鍵（履歴用）を残したまま新規 sender 鍵を登録して再送する。
