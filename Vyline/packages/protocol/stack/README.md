# Vyline protocol stack (internal)

`@vyline/protocol` 内部の LINE プロトコル RPC スタックです。Desktop 準拠の Legy トランスポートは `RequestClient` + `patchDesktopTransport` / `patchDesktopLogin` で実装しています。

- Talk: `/S4` (Compact Thrift)
- Auth: `/api/v3p/rs`, getRSAKeyInfo: `/api/v3/TalkService.do`
- E2EE: `letterSealing`（protocol）+ stack `e2ee/`
- OBS: stack `obs/`

型定義ビルド:

```powershell
cd Vyline/packages/protocol
bun run stack:types
```

外部プロトコルライブラリ / JSR 依存なし。Thrift 型は `@vyline/line-types`、実装は Desktop 解析に基づく自前スタック。
