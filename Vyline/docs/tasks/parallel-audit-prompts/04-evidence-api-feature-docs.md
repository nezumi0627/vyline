# Chat D — Evidence First / API整合 / 全機能ドキュメント

あなたは「できたを疑う」担当です。README、コメント、過去の報告に `done` と書かれていても信用せず、実コード・型・RPC・テスト・Desktop evidence から機能の成立を確認してください。

最初に `AGENTS.md`、`docs/CONTRIBUTING.md`、`docs/protocol/dictionary.md`、`packages/protocol/src/dictionary/rpcMap.ts` を読む。必要な Skill は `api-and-interface-design`, `documentation-and-adrs`, `investigate-first`, `code-review-and-quality`, `ponytail`, `minimize-cursor-cost`。

## 目的

全機能について、次の chain を根拠でつなぐ。

`LINE/Thrift evidence -> protocol stack -> domain API -> backend service -> BFF -> frontend client/store -> UI -> test/verification`

存在しない段があれば「部分対応」。UIだけある、routeだけある、型だけある状態を「完成」としない。

## API監査

公開・内部 API を棚卸しし、以下を確認する。

- function / route 名
- LINE RPC / Thrift 名との対応
- request / response type
- nullable / optional semantics
- error model
- timeout / retry
- auth/account scope
- side effect
- deprecated alias

基本は LINE の正式な関数名・概念に寄せる。ただし Vyline 独自 BFF の都合で別名が必要なら、mapping を docs に明示する。

名前だけ合わせるための破壊的 rename はしない。互換性を壊す変更は migration/deprecation plan を作る。

## 機能マトリクス

主要機能を一覧化する。最低限:

- login / token / session
- chat list / sync / unread / read
- text / reply / unsend / edit相当機能
- image / video / audio / file
- sticker / emoji
- mention
- Flex / Rich content
- profile / contact / group member
- group management
- OpenChat / Square
- album / note
- call event
- backup / restore / import
- multi-account / subdevice
- theme / plugin
- diagnostics / update

各機能を `verified / partial / unverified / unsupported` の4段階にする。

## Feature docs

全機能を1ファイルずつ乱造しない。既存 docs の構造に合わせ、関連機能を自然な単位でまとめる。

各機能docsには最低限:

- ユーザーから見た機能
- 実装経路
- API / 型
- LINE/Desktop 根拠
- edge cases
- security/privacy considerations
- tests / verification
- known limitations

## 重要ルール

- external evidence は URL / version / date を残す
- 推測は `hypothesis` と明記
- 実送信が必要なテストは AGENTS.md の指定先以外へ送らない
- Desktop解析結果が古い可能性を常に考慮する
- docs とコードが矛盾した場合、実挙動を確認してから docs を修正する

## 成果物

- Feature capability matrix
- API/RPC mapping audit
- contradictions report
- 根拠付き feature docs
- unsupported / unknown backlog

## 完了条件

「Vylineは何が本当にできるか」を第三者が docs だけで追跡でき、各 `verified` 項目にはコード/型/証拠/検証のリンクがある。
