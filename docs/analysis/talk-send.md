# talk-send — 調査メモ

最終更新: 2026-08-24

確認ポイント:

- TalkService `/S4` `sendMessage` / `unsendMessage` / 既読
- content-type thrift・ヘッダー連動

Vyline: `VylineClient.ts`, `patchTransport.ts`, backend `lineService.ts`
