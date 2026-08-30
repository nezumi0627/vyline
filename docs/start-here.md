# Vyline を使い始める

最終更新: 2026-08-31

このページは、コードを読まずに Vyline を試したい人向けの入口です。Vyline は LINE 非公式・未承認のサードパーティクライアントで、現在は Beta です。利用前に [README の重要事項](../README.md#ご利用前の重要事項) を確認してください。

## まず知っておくこと

- できることの一覧は [README](../README.md#主な機能) にあります。
- 「実装がある」と「今回の監査で実 LINE 環境まで確認済み」は同じ意味ではありません。検証状態は [Feature Capability Matrix](./feature-capabilities.md) を正本にします。
- Windows / Linux の配布物、ソース起動、Docker など導入方法ごとの違いは [README のインストール・更新](../README.md#インストール更新) を参照してください。

## 最短ルート

1. [README のインストール・更新](../README.md#インストール更新) から自分に合う導入方法を選びます。
2. 初回ログイン後は Vyline Setup の案内に従って設定します。設定はアカウント単位で保存されます。
3. 更新前や大きな設定変更前は Snapshot / VylineBackup を作成します。更新手順は [update.md](./user-guide/update.md) を参照してください。
4. 別環境へ設定を移す場合は、設定画面の引継ぎ機能を使います。引継ぎ ZIP は認証 token や E2EE 鍵を含めない設計です。

## Backup / Restore

- 通常のデータ保護は Snapshot / VylineBackup を使います。
- iOS ローカル暗号化バックアップからの履歴復元は専用機能です。現在の対応範囲と制限は [iOS backup restore guide](../Vyline/docs/guides/ios-backup-restore.md) を確認してください。
- 設定引継ぎ、VylineBackup、診断機能の実装上の詳細は [setup-account-handoff-debug.md](./setup-account-handoff-debug.md) にあります。

## 困ったとき

1. `vyl doctor` で環境を確認します。CLI の使い方は [vyl-cli.md](../Vyline/docs/vyl-cli.md) を参照してください。
2. 設定 > 詳細・復元 > 診断ログで、ログが記録されているか確認します。
3. GitHub Issue を作る場合は、送信前プレビューで共有内容を確認してください。共有用データは token、session、secret、full MID、メッセージ本文などを除去する前提です。
4. 開発者向けのトラブル調査は [onboarding.md](./onboarding.md) と [development.md](./development.md) へ進んでください。

## よくある質問

### Vyline は公式 LINE クライアントですか？

いいえ。LINE 株式会社および LY Corporation とは関係のない非公式クライアントです。

### すべての機能が実 LINE 環境で確認済みですか？

いいえ。外部 LINE runtime を必要とする多くの機能は、実装 chain が確認できても live E2E 未検証のため `partial` 扱いです。現在の根拠は [Feature Capability Matrix](./feature-capabilities.md) を参照してください。

### 開発に参加したいです。

[開発者向け入口](./developers/index.md) から始めてください。AI エージェントへ作業を任せる場合は [AI Entry](./developers/for-ai.md) を使います。
