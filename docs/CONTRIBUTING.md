# CONTRIBUTING — Vyline への貢献ガイド

最終更新: 2026-08-24

新規参入者向け。**UI/UX を触らずにプロトコル・backend・protocol を伸ばす**ときの道筋です。

---

## 5 分で掴む全体像

```
apps/desktop (React)  ──HTTP──►  backend (Hono)
                                    │
                                    ▼
                              @vyline/protocol
                         ┌──────────┴──────────┐
                         │  domain/  (facade)  │  ← プロフィール・チャット管理など
                         │  dictionary/        │  ← LINE.js 名 → Desktop 証拠
                         │  login/ e2ee/ obs/  │  ← Desktop パッチ
                         └──────────┬──────────┘
                                    │
                              stack/  (Talk /S4 等)
                                    │
                         @vyline/line-types (Thrift 型のみ)
```

- **外部 `@evex/linejs` 依存はゼロ**。stack は内部 RPC 実装。
- **Desktop LINE が仕様の正**。LINE.js / stack のメソッド名は「辞書」として使う。
- **UI は触らない**（この CONTRIBUTING の範囲外。design は別ドキュメント）。

---

## 初日セットアップ

```powershell
bun install
bun run typecheck
bun run dev   # backend :3001 + frontend :5173
```

詳細: [development.md](./development.md)

---

## 新機能を足すときの必須フロー

やりたいこと例: 「グループ名を変えたい」「自分のステメを変えたい」

### 1. 辞書で名前を特定

LINE.js / stack のメソッド名を探す:

```powershell
# TalkService の public メソッド一覧は stack 内
# Vyline/packages/protocol/stack/base/service/talk/mod.ts
```

または [protocol/dictionary.md](./protocol/dictionary.md) / `RPC_DICTIONARY` を見る。

### 2. Desktop で同じ名前を探す（必須）

```powershell
bun run vyline:find-native -- updateChat --list-only --skip-setup
# 出力: source/desktop/recovered/native-search/<slug>/
```

確認すること:

- `TalkService_<name>_pargs` があるか
- C++ 側 `line::...` の qualifiedName
- 失敗メッセージ文字列（path 推定の手がかり）

詳細: [tools/find-native-symbol.md](./tools/find-native-symbol.md)

### 3. domain facade に薄いメソッドを足す

```
Vyline/packages/protocol/src/domain/
  profile.ts   # 自分
  chat.ts      # グループ
  contacts.ts  # 他人
  talk.ts      # 送受信
  session.ts   # まとめて公開
```

### 4. backend service + BFF

```
Vyline/backend/src/service/lineService.ts  # ビジネス
Vyline/backend/src/api/line.ts             # HTTP のみ
```

### 5. 辞書・modules.map・docs を更新

- `src/dictionary/rpcMap.ts`
- `src/modules.map.ts`
- 必要なら `docs/analysis/<feature>.md`

### 6. 検証

```powershell
bun run typecheck
# 実機: ログイン済みアカウントで API を叩く
```

---

## やってはいけないこと

| NG                                          | 理由                     |
| ------------------------------------------- | ------------------------ |
| 外部 `@evex/linejs` を再導入                | 依存ゼロ方針             |
| UI を勝手に変更                             | 本タスクの範囲外         |
| 連絡先へ無断メッセージ送信                  | AGENTS.md 報告プロトコル |
| `desktop-e2ee-keys.json` / token をコミット | 秘密情報                 |
| Desktop 未検証のまま path を変える          | 実機 x-lc:400 の温床     |

### Vyline では公開しない項目

- 自分プロフィールの「誕生日（MMDD / YYYYMMDD）」更新は扱わない。
- これは Desktop 側でも主に primary 寄りのデバイスタイプでしか安定しないため、Vyline では入力欄を出さず、backend でも更新経路を持たない。
- 表示用に取得済みの誕生日データは残してよいが、編集導線は追加しない。

---

## コード規約（短く）

- TypeScript strict / overengineering 禁止 / 小さなモジュール
- BFF は整形だけ、ロジックは service、LINE 呼び出しは protocol domain
- verbose な pino ログ（subsystem タグ付き）
- 通話 UI（CallOverlay）はダミー維持

---

## 次に読むもの

| ドキュメント                                       | 内容                       |
| -------------------------------------------------- | -------------------------- |
| [onboarding.md](./onboarding.md)                   | 新規参入チェックリスト     |
| [architecture.md](./architecture.md)               | 層構造                     |
| [protocol/dictionary.md](./protocol/dictionary.md) | RPC 辞書                   |
| [tools/desktop-delta.md](./tools/desktop-delta.md) | Desktop 更新時の差分調査   |
| [../AGENTS.md](../AGENTS.md)                       | エージェント向け全体ガイド |
