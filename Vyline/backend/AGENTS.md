# @vyline/backend

Hono on Bun の BFF。フロントエンドと `@vyline/protocol` の間に立つ。

```bash
bun run dev        # :3001（ルートから bun run dev:backend でも可）
bun run typecheck
```

## 層の責務（重要）

- `src/api/line.ts` — BFF routes。**HTTP の入出力のみ**を行い、処理は service に委譲する
- `src/service/lineService.ts` — **ビジネスロジックの正本**。メッセージ送受信、E2EE、メディア、スタンプ、プロフィール
- `src/line/clientManager.ts` — セッション管理
- `src/storage/` — `vylineCache.ts`（プロフィール/グループ）、`featureLocks.ts`（操作ロック）、`messageLog.ts`（JSONL ログ → `data/logs/`）
- `src/service/backupService.ts` — VylineBackup スナップショット（`data/backups/`）

ロジックを `api/` に書かない。BFF が厚くなったら service へ引き上げる。

## 注意

- `data/` は gitignore。コミットしない
- 新規プロトコル機能は protocol の domain facade 経由で呼ぶ（[../packages/protocol/AGENTS.md](../packages/protocol/AGENTS.md)）
- 主要な定数（`CONTACT_RPC_TIMEOUT_MS` ほか）と共通パターンは [../../docs/architecture.md](../../docs/architecture.md) に一覧がある
