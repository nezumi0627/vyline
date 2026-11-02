# CONTRIBUTING — Vyline への貢献ガイド

最終更新: 2026-11-03

新規参入者向け。プロトコル・backend の変更を、Desktop の UI と混同せずに実装するための道筋です。UI の変更が必要なタスクでは `apps/desktop` の既存コンポーネントと設計資料も確認してください。

---

## 5 分で掴む全体像

<figure class="architecture-map" role="group" aria-labelledby="contribution-map-title">
<figcaption id="contribution-map-title">画面からLINEサーバーまで</figcaption>
<div class="architecture-flow">
<div class="architecture-node"><small>FRONTEND</small><strong>apps/desktop</strong><span>React · Vite</span></div>
<div class="architecture-connector"><span>HTTP</span><b aria-hidden="true">→</b></div>
<div class="architecture-node"><small>BACKEND</small><strong>backend</strong><span>Hono · 入出力とサービス</span></div>
</div>
<div class="architecture-down"><span>セッション処理</span><b aria-hidden="true">↓</b></div>
<section class="architecture-protocol" aria-label="Vyline protocol の構成">
<div class="architecture-node protocol-title"><small>PROTOCOL</small><strong>@vyline/protocol</strong></div>
<div class="architecture-branches">
<div><strong>domain/</strong><span>プロフィール・チャットの facade</span></div>
<div><strong>dictionary/</strong><span>LINE.js 名と Desktop 証拠</span></div>
<div><strong>login/ · e2ee/ · obs/</strong><span>Desktop 準拠の通信処理</span></div>
</div>
</section>
<div class="architecture-down"><span>RPC transport</span><b aria-hidden="true">↓</b></div>
<div class="architecture-flow architecture-flow-bottom">
<div class="architecture-node"><small>THRIFT RPC</small><strong>stack/</strong><span>Talk · /S4 · Login · OBS</span></div>
<div class="architecture-connector"><b aria-hidden="true">→</b></div>
<div class="architecture-node"><small>型定義</small><strong>@vyline/line-types</strong><span>vendored Thrift types</span></div>
</div>
</figure>

- **外部 `@evex/linejs` 依存はゼロ**。stack は内部 RPC 実装。
- **Desktop LINE が仕様の正**。LINE.js / stack のメソッド名は「辞書」として使う。
- **このガイドは UI の実装手順を扱わない**。UI を変更する場合も、backend / protocol の責務はこの境界に従う。

---

## 初日セットアップ

```powershell
bun install
bun run typecheck
bun run dev   # backend :3001 + frontend :5173
```

詳細: [development.md](./development.md)

### 並行開発は Git worktree を使う

Vyline の推奨開発方式は **`1 task = 1 branch = 1 git worktree`** です。複数のAIエージェント、人間、IDEが同時に作業する場合も、repository全体をコピーせずタスクごとにworktreeを分離してください。

標準配置、作成・削除手順、競合時の扱いは [development-worktrees.md](./development-worktrees.md) を参照してください。

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
- 通話 UI は `useCall` → BFF → managed call session → WebSocket PCM まで接続済み。ただし実 LINE 環境での E2E 成功は継続検証対象

---

## 次に読むもの

| ドキュメント                                       | 内容                       |
| -------------------------------------------------- | -------------------------- |
| [onboarding.md](./onboarding.md)                   | 新規参入チェックリスト     |
| [architecture.md](./architecture.md)               | 層構造                     |
| [protocol/dictionary.md](./protocol/dictionary.md) | RPC 辞書                   |
| [tools/desktop-delta.md](./tools/desktop-delta.md) | Desktop 更新時の差分調査   |
| [../AGENTS.md](../AGENTS.md)                       | エージェント向け全体ガイド |
