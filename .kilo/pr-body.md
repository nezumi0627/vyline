## Summary
- Add message history tracking with `messageState` and `history` fields
- Support revoke-by-self and revoke-by-other with distinct handling
- Add restore flow for revoked-by-self messages from local history
- Add backend endpoints for message history and restore

## Files Changed
- Backend: `chatStore.ts`, `lineService.ts`, `api/line.ts`
- Frontend: `store.ts`, `store-types.ts`, `mappers.ts`, `message-bubble.tsx`, `message-input.tsx`, `sidebar.tsx`, `useVylineSync.ts`, `client.ts`
- Types: `packages/types/src/index.ts`
- Other: `cdnAssetCache.ts`, `mediaCache.ts`, `icons.tsx`, `settings-sections.tsx`