# login-qr — 調査メモ

Desktop 更新時に確認するポイント:

- `createSession` / `createQrCodeForSecure` / `checkQrCodeVerified` / `qrCodeLoginV2ForSecure`
- `/acct/lgn/sq/v1`, `/acct/lp/lgn/sq/v1`
- QR の systemName / modelName (PC ホスト名・WMI Model)

Vyline: `patchLogin.ts`, `pcIdentity.ts`, `NezuClient.ts`  
詳細フロー: [docs/login-flow.md](../login-flow.md)
