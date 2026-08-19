# @vyline/protocol

LINE プロトコルスタック。Thrift RPC（`/S4`, `/api/v3p/rs`）、E2EE、Desktop 準拠パッチ。`@evex/linejs` には依存しない（メソッド名・構造パターンのみ参考にしている）。

```bash
bun run stack:types   # Thrift 型ビルド
bun run typecheck
bun test
```

## 実装場所の探し方

`src/dictionary/rpcMap.ts` の **RPC_DICTIONARY** が起点。LINE.js 名 → Desktop 証拠 → Vyline 実装の対応表になっている。

1. `linejsName` で検索する
2. `desktopEvidence` で Desktop 内の実体を確認する
3. `stackApi` → `domainApi` → `backendApi` の順に追跡する

`linejsName` フィールドが linejs との対応を示す。

## 構成

- `src/domain/` — `VylineSession` facade。**新規機能はここに薄いメソッドを足す**のが推奨経路
- `src/dictionary/` — RPC_DICTIONARY
- `src/login/` — E2EE・鍵管理・Desktop パッチ
- `stack/` — Thrift RPC 本体
- `stack/base/e2ee/mod.ts` — E2EE 復号エンジン

## 参照

- [../../../docs/protocol/dictionary.md](../../../docs/protocol/dictionary.md) — RPC 辞書・Desktop 検証表
- [../../../docs/CONTRIBUTING.md](../../../docs/CONTRIBUTING.md) — 機能追加フロー
- Desktop で名前を探す手順は [../../../docs/tools/](../../../docs/tools/) を参照（`bun run vyline:find-native -- <name>`）
