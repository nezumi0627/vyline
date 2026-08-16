# Desktop Delta Report

生成: 2026-07-26T06:53:10.913Z
status: **unchanged**

## バージョン

| | 値 |
|---|---|
| キャッシュ (or fallback) | `26.3.0.3916` |
| インストール | `26.3.0.3916` |
| versionChanged | false |
| shaChanged | false |
| profile source | cache |
| detectionMethod | scan |

### Identity (cached/fallback)

```
UA:  DESKTOP:WINDOWS:10.0.26100-11NT(26.3.0.3916)
XLA: DESKTOPWIN	26.3.0.3916	WINDOWS	10.0.26100-11NT
```

## %LOCALAPPDATA%\LINE パス

lineRoot: `C:\Users\ren11\AppData\Local\LINE`

- **lineRoot**: `C:\Users\ren11\AppData\Local\LINE`
- **bin**: `C:\Users\ren11\AppData\Local\LINE\bin`
- **data**: `C:\Users\ren11\AppData\Local\LINE\Data`
- **ini**: `C:\Users\ren11\AppData\Local\LINE\Data\LINE.ini`
- **updateLog**: `C:\Users\ren11\AppData\Local\LINE\bin\update_log.txt`
- **exe**: `C:\Users\ren11\AppData\Local\LINE\bin\26.3.0.3916\LINE.exe`
- **versionDir**: `C:\Users\ren11\AppData\Local\LINE\bin\26.3.0.3916`

exeSha256 (installed): `8d26fbf87ba4cfe303649cf702213bada2145530705e9e2db7f979c5de32154d`

## 再確認すべきモジュール (modules.map)

全 feature id: login-qr, login-email, headers-transport, e2ee-keys, e2ee-send, e2ee-decrypt, talk-send, sync-events, stickers, calls

### login-qr — QR ログイン (`high`)

**Vyline files**
- `Vyline/packages/nezuline/src/login/patchLogin.ts`
- `Vyline/packages/nezuline/src/login/pcIdentity.ts`
- `Vyline/packages/nezuline/src/client/NezuClient.ts`
- `Vyline/backend/src/line/clientManager.ts`
- `Vyline/backend/src/api/auth.ts`

**Desktop search strings**

```
createSession
createQrCodeForSecure
checkQrCodeVerified
qrCodeLoginV2ForSecure
/acct/lgn/sq/v1
/acct/lp/lgn/sq/v1
```

**Analysis docs**
- [docs/login-flow.md](../login-flow.md)
- [docs/analysis/login-qr.md](../analysis/login-qr.md)

### login-email — メールログイン (E2EE) (`high`)

**Vyline files**
- `Vyline/packages/nezuline/src/login/patchLogin.ts`
- `Vyline/packages/nezuline/src/login/patchTransport.ts`
- `Vyline/packages/nezuline/src/login/pcIdentity.ts`
- `Vyline/packages/nezuline/src/client/NezuClient.ts`
- `Vyline/backend/src/line/clientManager.ts`
- `Vyline/backend/src/api/auth.ts`

**Desktop search strings**

```
getRSAKeyInfo
loginV2
confirmE2EELogin
/api/v3/TalkService.do
/api/v3p/rs
/LF1
e2eeData
```

**Analysis docs**
- [docs/login-flow.md](../login-flow.md)
- [docs/analysis/login-email.md](../analysis/login-email.md)

### headers-transport — ヘッダー / トランスポート (`high`)

**Vyline files**
- `Vyline/packages/nezuline/src/login/patchTransport.ts`
- `Vyline/packages/nezuline/src/desktop/identity.ts`
- `Vyline/packages/nezuline/src/desktop/extract.ts`
- `Vyline/packages/nezuline/src/desktop/version.ts`
- `Vyline/packages/nezuline/src/updater/NezuUpdater.ts`
- `Vyline/backend/src/nezu/profileBridge.ts`

**Desktop search strings**

```
DESKTOPWIN
DESKTOP:WINDOWS
x-line-application
user-agent
x-lap
x-lpv
legy-jp.line-apps.com
/S4
/api/v3p/rs
```

**Analysis docs**
- [docs/login-flow.md](../login-flow.md)
- [docs/analysis/headers-transport.md](../analysis/headers-transport.md)
- [docs/tools/desktop-delta.md](../tools/desktop-delta.md)

### e2ee-keys — E2EE 鍵管理 (`high`)

**Vyline files**
- `Vyline/packages/nezuline/src/login/ensureE2EE.ts`
- `Vyline/packages/nezuline/src/login/importDesktopE2EE.ts`
- `Vyline/packages/nezuline/src/login/patchLogin.ts`
- `Vyline/backend/src/api/debug.ts`

**Desktop search strings**

```
decodeE2EEKeyV1
encryptedKeyChain
negotiateE2EEPublicKey
registerE2EEPublicKey
e2eeKeys
```

**Analysis docs**
- [docs/login-flow.md](../login-flow.md)
- [docs/analysis/e2ee-keys.md](../analysis/e2ee-keys.md)

### e2ee-send — E2EE 送信 (`high`)

**Vyline files**
- `Vyline/packages/nezuline/src/login/ensureE2EE.ts`
- `Vyline/packages/nezuline/src/client/NezuClient.ts`
- `Vyline/backend/src/service/lineService.ts`
- `Vyline/backend/src/api/line.ts`

**Desktop search strings**

```
encryptE2EEMessage
sendMessage
E2EE_UPDATE_SENDER_KEY
negotiateE2EEPublicKey
```

**Analysis docs**
- [docs/analysis/e2ee-send.md](../analysis/e2ee-send.md)
- [docs/login-flow.md](../login-flow.md)

### e2ee-decrypt — E2EE 復号 (`high`)

**Vyline files**
- `Vyline/packages/nezuline/src/login/ensureE2EE.ts`
- `Vyline/packages/nezuline/src/login/importDesktopE2EE.ts`
- `Vyline/backend/src/service/lineService.ts`
- `Vyline/backend/src/api/debug.ts`

**Desktop search strings**

```
decryptE2EEMessage
decryptE2EEDataMessage
tryRegisterE2EEGroupKey
BAD_DECRYPT
```

**Analysis docs**
- [docs/analysis/e2ee-decrypt.md](../analysis/e2ee-decrypt.md)
- [docs/login-flow.md](../login-flow.md)

## Notes

- キャッシュとインストール版は一致 (差分なし)
- 差分なしのため high priority モジュールのみ列挙 (全件は --all 相当で status=updated 時)

## 次のアクション

1. 上記モジュールを優先度順に確認する
2. LINE.exe から searchStrings を strings / メモリダンプで探す
3. 差分があれば `docs/analysis/<feature>.md` にメモし、対応ソースを直す
4. 必要なら NezuUpdater.refresh() または `POST /debug/nezu/refresh`
5. CDN: https://desktop.line-scdn.net/win/v2/real/update_info.json

詳細: [docs/tools/desktop-delta.md](../tools/desktop-delta.md)
