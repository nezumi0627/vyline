# login-qr — 調査メモ

最終更新: 2026-08-24

Desktop 更新時に確認するポイント:

- `createSession` / `createQrCodeForSecure` / `checkQrCodeVerified` / `qrCodeLoginV2ForSecure`
- `/acct/lgn/sq/v1`, `/acct/lp/lgn/sq/v1`
- QR の systemName / modelName (PC ホスト名・WMI Model)

Vyline: `patchLogin.ts`, `pcIdentity.ts`, `VylineClient.ts`  
詳細フロー: [docs/login-flow.md](../login-flow.md)
