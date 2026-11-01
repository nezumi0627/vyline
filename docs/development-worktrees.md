# Git Worktree 開発フロー

最終更新: 2026-08-30

Vyline では、複数の人間・AI エージェント・IDE が同時に開発するときの競合を減らすため、**`1 task = 1 branch = 1 git worktree`** を推奨開発方式とします。

repository 全体を `Vyline-feature-a` のようにコピーして並行作業する方式は、Git metadata、submodule、依存関係、未追跡ファイルの状態が分岐しやすいため、新規作業では原則使いません。

## 推奨レイアウト

worktree は repository の外に置きます。Windows では次の配置を推奨します。

```text
E:\projects\
├─ Vyline\
└─ Vyline-worktrees\
   ├─ note-album\
   ├─ openchat\
   ├─ security\
   └─ token-refresh\
```

`.codex-worktrees` のような特定エージェント専用名は新規利用しません。`Vyline-worktrees` は Codex、他の AI、IDE、人間の開発者で共通利用できる作業領域です。

## 新しいタスクを始める

まず本体 repository で remote を更新し、タスク専用 branch と worktree を同時に作ります。

```powershell
cd E:\projects\Vyline
git fetch origin
git worktree add -b feature/<task-name> E:\projects\Vyline-worktrees\<task-name> origin/main
cd E:\projects\Vyline-worktrees\<task-name>
git submodule update --init --recursive
bun install
```

branch prefix は担当者・用途の既存ルールに合わせて `feature/`、`fix/`、`docs/`、エージェント固有prefixなどを使えます。重要なのは、**同じ branch を複数 worktree で同時編集しないこと**です。

## 作業中のルール

- 1つのタスクは1つのworktreeだけで編集する。
- 他タスクのworktreeにある未コミット差分・未追跡ファイルを触らない。
- submodule の branch / commit pointer もタスクごとに確認する。
- 本体 `E:\projects\Vyline` を複数AIの共有作業場にしない。
- 共通変更が必要になった場合は、先にPRへ分離するか、依存するbranchを明示してrebaseする。
- secrets、session、token、`Vyline/backend/data/` はworktree間でコピーしない。

状態確認:

```powershell
git worktree list
git status --short --branch
```

## PR とマージ

作業が完了したら通常のbranchと同じようにcommit / pushし、`main` 向けPRを作成します。

```powershell
git add <files>
git commit -m "feat(scope): describe change"
git push -u origin feature/<task-name>
```

PR が merge されたあと、worktreeに未保存作業がないことを確認して削除します。

```powershell
cd E:\projects\Vyline
git worktree remove E:\projects\Vyline-worktrees\<task-name>
git worktree prune
git branch -d feature/<task-name>
```

`--force` は未コミット差分や未追跡ファイルを失う可能性があるため、通常の後片付けでは使いません。

## 競合したとき

同じファイルを複数タスクで変更する必要が出た場合でも、worktree同士のファイルを直接コピーして上書きしません。

1. 先に片方をcommitする。
2. 必要ならPRを先行してmergeする。
3. もう片方のbranchで `origin/main` をrebaseする。
4. Gitが示した競合だけを解決して再検証する。

これにより「どのAIの変更か分からない」「コピー先だけ修正されて本体へ戻っていない」という状態を避けられます。

## 既存の古いコピー / worktree

既存の `Vyline-*` コピーや `.codex-worktrees` は、未push commit・submodule差分・未追跡ファイルがないことを確認するまで手動削除・リネームしません。

特に submodule を含む登録済みworktreeは、フォルダをExplorerから移動するとGit管理情報が壊れることがあります。整理時は `git worktree list` で登録状態を確認し、Git経由で扱ってください。
