# Vyline を使い始める

最終更新: 2026-11-03

このページは、Vylineを初めて使う人向けの入口です。
現在の安定版は **1.2.3** です。
[操作できる導入ツアー](https://nezumi0627.github.io/Vyline/#start)でも手順を確認できます。
VylineはLINE非公式のクライアントです。利用前に[プライバシーとデータ](./user-guide/privacy-and-data.md)を確認してください。

## 環境を選ぶ

| 環境 | 導入方法 | 手順 |
| --- | --- | --- |
| Windows x64 | SetupまたはポータブルZIP。Bun不要 | [Windows](./install/windows.md) |
| Linux x64 | tar.gzを展開しinstall.shを実行。Bun不要 | [Linux](./install/linux.md) |
| macOS | ソース起動またはブラウザ接続。専用インストーラーなし | [macOS](./install/macos.md) |
| Docker / Web | amd64またはarm64サーバーで起動 | [Docker](./install/docker.md) |

## ログインと初回設定

1. 起動したVylineでQRコードログインを選びます。
2. スマホのLINEのQRコードリーダーで読み取り、ログインを承認します。確認番号が表示された場合は画面の案内に従ってください。
3. ログイン後のVyline Setupで、使い方とアカウントごとの設定を選びます。
4. 設定からテーマ、文字サイズ、表示密度、通知を調整します。

QRコードの期限が切れた場合は、VylineでQRコードを再発行してください。
詳しい流れは[ログインフロー](./login-flow.md)を参照してください。

## まず知っておくこと

- できることの一覧は[機能ガイド](./features.md)にあります。
- 「実装がある」と「今回の監査で実 LINE 環境まで確認済み」は同じ意味ではありません。検証状態は [Feature Capability Matrix](./feature-capabilities.md) を正本にします。
- Windows / macOS / Linuxの配布物、ソース起動、Dockerなどの導入方法は[配布ガイド](./distribution.md)と[セルフホストガイド](./selfhosting.md)を参照してください。

## 使い始めたら

1. [機能ガイド](./features.md)から会話や表示の使い方を確認します。
2. 更新前や大きな設定変更前はSnapshot / VylineBackupを作成します。[更新手順](./user-guide/update.md)を確認してください。
3. 別環境へ設定を移す場合は設定画面の引継ぎ機能を使います。引継ぎZIPには認証トークンやE2EE鍵を含めません。履歴は[VylineBackup](../Vyline/docs/guides/vyline-backup-restore.md)で別に扱います。

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
