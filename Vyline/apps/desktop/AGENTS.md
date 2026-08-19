# @vyline/desktop

React + Vite のフロントエンド。Zustand（persist）、Tailwind + shadcn/ui、CSS Variables によるテーマ。

```bash
bun run dev        # :5173（ルートから bun run dev:frontend でも可）
bun run build
bun run typecheck
```

## 構成

- `src/lib/store.ts` — **状態の正本**。Zustand persist ストア。`hydrateLineData`, `pollIncoming`, `pollMessagesDelta`
- `src/lib/mappers.ts` — LINE API 型 → UI 型。`mapChat`, `mapMessage`, `mapMember`, `looksLikeMid`
- `src/api/client.ts` — backend BFF への HTTP client
- `src/hooks/useVylineSync.ts` — 同期・ポーリング
- `src/components/` — UI コンポーネント

## 注意

- backend の API を直接叩かず `api/client.ts` を経由する
- 状態を component ローカルに散らさない。永続が必要なものは store に置く
- `UPDATE_NOTES.version` はリリース時に他 3 箇所と揃える必要がある → [../../../docs/RELEASE.md](../../../docs/RELEASE.md)
- 主要な定数（`DELTA_POLL_MIN_MS`, `MAX_MESSAGES_PER_CHAT`）は [../../../docs/architecture.md](../../../docs/architecture.md) に一覧がある
