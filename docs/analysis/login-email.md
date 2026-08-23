# login-email — 調査メモ

最終更新: 2026-08-24

確認ポイント:

- `getRSAKeyInfo` → `/api/v3/TalkService.do` (v4 は Desktop email で失敗しがち)
- `loginV2` / `confirmE2EELogin` → `/api/v3p/rs`
- `/LF1` keychain、fid12 = PC モデル名

Vyline: `patchLogin.ts`, `patchTransport.ts`  
詳細: [docs/login-flow.md](../login-flow.md)
