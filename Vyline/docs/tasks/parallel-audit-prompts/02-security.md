# Chat B — Security / CVE / Threat Audit

あなたは Vyline 全体のセキュリティ監査担当です。「脆弱性が無さそう」で終わらせず、コード・依存関係・設定・データ保存・ネットワーク境界を根拠付きで調査してください。

最初に `AGENTS.md` を読み、`common-security-audit`, `common-owasp`, `common-llm-security`, `common-security-standards`, `code-review-and-quality`, `ponytail`, `minimize-cursor-cost` を必要範囲で使用する。

## 対象

- backend API / middleware
- auth / token / session / QR login
- DPAPI / secureStore / tokenStore
- account separation / MID scoped storage
- LAN / Tailscale / CORS / origin / CSRF
- file upload / media proxy / CDN
- ZIP import/export / backup / restore
- path traversal / symlink / zip-slip
- SSRF / open redirect
- XSS / HTML / Flex / Rich content rendering
- plugin system / dynamic import / permissions
- command execution / child process
- logs / diagnostics / secrets leakage
- WebSocket / polling / rate limit / DoS
- dependency CVE / lockfile / GitHub advisory
- CI / release / secrets / artifact integrity
- prototype pollution / unsafe parsing / deserialization
- insecure defaults / debug endpoints

## 手順

1. trust boundary とデータフローを作る。
2. 危険sinkを検索し、呼び出し元まで追う。
3. 認証・認可は endpoint 単位で確認する。
4. dependency scanner / audit / GitHub advisory 等で CVE を確認する。
5. 発見事項を severity と exploitability で分類する。
6. false positive はコード根拠で落とす。
7. 修正する場合は root cause に最小変更を入れ、security regression test を残す。

安全なローカル検証を優先する。実アカウントや第三者への攻撃、無断スキャン、実データ破壊はしない。

## 特に疑うこと

- localhost 前提の API が LAN 公開時にも同じ信頼モデルになっていないか
- frontend 側だけの制限を security control と誤認していないか
- token/session がログ・diagnostic・backup に混入しないか
- アカウントAのキャッシュ・設定・メディアがアカウントBから読めないか
- URL fetch/proxy が private network に到達できないか
- ZIP/backup の path validation が完全か
- plugin が backend/FS/token に過剰アクセスできないか
- `dangerouslySetInnerHTML`, URL scheme, markdown/render path に XSS がないか
- error response が内部パス・token・stack を露出しないか

## 成果物

`docs/reports/` または既存 security report の適切な場所へ以下を残す。

- Threat model
- Finding ID / severity / affected path
- 攻撃成立条件
- コード根拠
- 修正内容または推奨修正
- 検証方法
- CVE / advisory reference
- 未確認事項

「CVEなし」と「脆弱性なし」は別物として扱う。

## 完了条件

重大な trust boundary が全てレビューされ、High/Critical は修正または明確な blocker 化、Medium 以下も追跡可能な形になっている。依存関係の CVE scan と security-focused test の結果を記録する。
