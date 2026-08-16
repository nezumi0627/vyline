# headers-transport — 調査メモ

確認ポイント:

- `DESKTOPWIN` + TAB 区切り `X-Line-Application`（**Desktop エミュ時のみ**）
- `DESKTOP:WINDOWS:…(appVer)` User-Agent
- `x-lap` / `x-lpv` / Host `legy-jp.line-apps.com`
- Talk `/S4`, Auth `/api/v3p/rs`（Desktop）/ `/api/v4p/rs`（ANDROIDSECONDARY）

同時ログイン（既定は副端末で Desktop ヘッダーを当てない）: [dual-login-desktop.md](./dual-login-desktop.md)

Vyline: `patchTransport.ts`, `identity.ts`, `deviceMode.ts`, `NezuUpdater.ts`  
ツール: [docs/tools/desktop-delta.md](../tools/desktop-delta.md)
