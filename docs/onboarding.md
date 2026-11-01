# Onboarding — 新規参入チェックリスト

最終更新: 2026-08-24

所要目安: 半日（環境構築 + コード地図 + Desktop ツール 1 回実行）

---

## Day 0 — 動かす

- [ ] Bun が入っている (`bun --version`)
- [ ] `bun install` が通る
- [ ] `bun run typecheck` が通る
- [ ] `bun run dev` で backend `:3001` / frontend `:5173` が立つ
- [ ] （任意）既存トークンでログインできる

環境変数の例はリポジトリの `.env.example` を参照。

---

## Day 0 — 読む（この順）

1. [AGENTS.md](../AGENTS.md) — プロジェクト方針・編集範囲
2. [README.md](./README.md) — ドキュメント索引
3. [architecture.md](./architecture.md) — 層と依存方向
4. [CONTRIBUTING.md](./CONTRIBUTING.md) — 機能追加フロー
5. [protocol/dictionary.md](./protocol/dictionary.md) — RPC の探し方
6. 関心中の機能なら `docs/analysis/` の該当メモ

---

## Day 1 — コードの歩き方

### 触ってよい場所

| パス                                       | 役割                                                         |
| ------------------------------------------ | ------------------------------------------------------------ |
| `Vyline/packages/protocol/src/domain/`     | OOP facade（プロフィール等）                                 |
| `Vyline/packages/protocol/src/dictionary/` | LINE.js ↔ Desktop 辞書                                       |
| `Vyline/packages/protocol/src/protocol/`   | stack を直接 import しない薄い RPC 層（例: `profileOps.ts`） |
| `Vyline/packages/protocol/src/login/`      | Desktop パッチ                                               |
| `Vyline/packages/protocol/src/e2ee/`       | Letter Sealing                                               |
| `Vyline/backend/src/service/`              | ビジネスロジック                                             |
| `Vyline/backend/src/api/`                  | Hono BFF                                                     |
| `docs/`                                    | ドキュメント                                                 |

### 原則として触らない場所

| パス                                  | 理由                                                |
| ------------------------------------- | --------------------------------------------------- |
| `Vyline/apps/desktop/src/components/` | UI（別タスク）                                      |
| `archive/`                            | 旧実装・参考のみ                                    |
| `Vyline/backend/data/`                | 秘密・gitignore                                     |
| `source/desktop/`                     | 巨大アーティファクト（読むのは OK、コミットしない） |

---

## Day 1 — Desktop ツールを 1 回回す

前提: `source/desktop/recovered/unpacked_LINE.exe` があること。

```powershell
bun run vyline:find-native -- sendMessage --list-only --skip-setup
```

成功すると:

`source/desktop/recovered/native-search/sendMessage/`

に README / strings.json ができる。`TalkService_sendMessage_pargs` が見えれば OK。

---

## よくある質問

**Q. stack は linejs じゃないの？**  
A. 由来は vendored プロトコル実装だが、パッケージ名は内部 `protocol/stack`。外部 JSR 依存はない。仕様の正は Desktop。

**Q. どこにメソッドを足す？**  
A. まず `domain/`、次に `lineService`、最後に `api/line.ts`。辞書も更新。

**Q. 通話は？**  
A. `useCall` から backend の managed call session / WebSocket PCM まで接続済み。まだ実験的で、実 LINE 環境の E2E 成功確認は継続中。



---

## 完了の定義（オンボーディング）

- [ ] typecheck / dev が分かる
- [ ] domain / BFF / stack の役割を説明できる
- [ ] find-native を 1 回実行した
- [ ] 「新機能は辞書→Desktop→domain→BFF」の順を覚えている
