# AGENTS.ai.md — AI が Vyline を触る時の実態メモ

最終更新: 2026-08-29

このファイルは、AI エージェントが Vyline を調査・修正するときに迷いやすかった点を短くまとめる補助ガイドです。まず `AGENTS.md` を読み、その後にこのファイルを読んでください。

---

## AI が実際に困ったこと

### 1. 入口が多く、どれが正本か迷う

README、`docs/README.md`、`docs/onboarding.md`、`docs/development.md`、`AGENTS.md`、`Vyline/docs/*` があり、最初にどれを信じるべきか判断に時間がかかる。

**正しい読み順:**

1. `AGENTS.md`
2. `docs/README.md`
3. `docs/onboarding.md`
4. `docs/architecture.md`
5. 対象機能の近い docs
6. 実コード

README はユーザー向け入口。実装判断の正本にしない。

### 2. submodule と workspace の境界が見えにくい

`Vyline/packages/protocol`、`Vyline/packages/plugin`、`Vyline/packages/themes`、`tools` は役割が違う。普通の package と submodule が混ざるため、clone/archive/CI/Docker で見え方が変わる。

**確認すること:**

```bash
bun run vyl:doctor
```

`Protocol package` や `Plugin package` が missing の場合、まず submodule か archive install の制約を疑う。

### 3. docs を一気に整理しようとすると過剰変更になりやすい

既存docsをテンプレートに機械的に当てると、意味のある文脈や既存の言い回しを壊す。

**方針:**

- 新規docsや大改修だけ `docs/templates/` を使う
- 既存docsは必要箇所だけ直す
- 用語変更は一括置換しない
- README は元の構成を守る

### 4. CLI に重い処理を入れると使いにくくなる

`vyl doctor` や `vyl init` は軽い入口であるべき。npm publish、Trivy container scan、Docker build、フルsecurity scanを通常CLIへ入れると毎回重くなる。

**CLIに入れてよいもの:**

- `doctor`: Bun/Git/submodule/.env/data/storage など軽量チェック
- `fix`: `.env` 作成、data/storage 作成、submodule update、bun install
- `snapshot`: ローカルデータ保護
- `plugin create`: scaffold

**CLIに入れないもの:**

- npm publish
- Docker image vulnerability scan
- full Trivy filesystem scan
- OSV/Trivy全量実行
- release作成

重い処理は GitHub Actions の手動workflow、release workflow、schedule に置く。

### 5. セキュリティは大事だが、PRごとに全部回すと遅い

PRでは軽量なOSV dependency scanを優先する。重い Trivy filesystem/container scan は main push、schedule、workflow_dispatch に寄せる。

**目安:**

| タイミング | 実行するもの |
| --- | --- |
| PR | OSV dependency scan |
| main push | OSV + Trivy fs + Trivy image |
| weekly schedule | OSV + Trivy fs + Trivy image |
| manual dispatch | full=true で全量 |
| npm publish | release/manual workflow only |

---

## 作業前チェック

```bash
bun run vyl:doctor
bun run typecheck
```

docsだけの変更なら `bun run docs:readme:check` も確認する。Security Scanやnpm publishは通常作業では走らせない。

---

## 報告で必ず書くこと

- 触ったブランチ
- PR番号
- 最新head SHA
- CIの状態
- 実際にできたこと
- できなかったこと、または secret/token が必要なこと

npm publishについては、`NPM_TOKEN` secret が無い環境では「公開準備まで」と明記する。
