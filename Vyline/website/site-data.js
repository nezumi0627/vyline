export const version = "1.2.3";
export const repository = "https://github.com/nezumi0627/vyline";
export const release = `${repository}/releases/tag/v${version}`;
export const download = (name) => `${repository}/releases/download/v${version}/${name}`;

export const documents = [
  ["docs/start-here.md", "はじめに", "Vylineを使い始める", "導入から最初の設定まで"],
  ["docs/install/cli.md", "インストール", "Bunとvyl CLI", "全OS共通のコマンド起動と登録"],
  ["docs/install/windows.md", "インストール", "Windows", "Setupとポータブル版の導入"],
  ["docs/install/linux.md", "インストール", "Linux", "x64配布版の展開と起動"],
  ["docs/install/macos.md", "インストール", "macOS", "Apple Silicon / Intel向けローカルアプリ"],
  ["docs/install/docker.md", "インストール", "Docker / Web", "サーバーを立ててブラウザで使う"],
  ["docs/features.md", "使い方", "機能を知る", "会話、外観、アカウント、データ管理"],
  ["docs/user-guide/themes.md", "使い方", "テーマを作る", "VyThemeと表示のカスタマイズ"],
  ["Vyline/docs/guides/vyline-backup-restore.md", "データ", "バックアップと復元", "VylineBackupの保存範囲と復元方式"],
  ["Vyline/docs/guides/ios-backup-restore.md", "データ", "iOSの履歴取り込み", "暗号化ローカルバックアップからの復元"],
  ["docs/setup-account-handoff-debug.md", "データ", "引継ぎと診断", "設定の移行と診断ログ"],
  ["Vyline/docs/guides/error-handling.md", "運用", "エラーの確認と復旧", "安全なエラー表示と操作ごとの復旧手順"],
  ["docs/user-guide/privacy-and-data.md", "データ", "プライバシー", "保存先、AIへの送信、利用前の注意"],
  ["docs/user-guide/update.md", "運用", "アップデート", "データを守って更新する"],
  ["docs/subdevices.md", "運用", "別の端末で使う", "ペアリングと遠隔アクセス"],
  ["docs/selfhosting.md", "運用", "セルフホスト", "永続化と接続の詳しい設定"],
  ["docs/feature-capabilities.md", "開発", "機能の検証状況", "実装と実LINE環境での検証を区別する"],
  ["docs/developers/index.md", "開発", "開発に参加する", "環境構築とコードの入口"],
  ["docs/architecture.md", "開発", "アーキテクチャ", "フロントエンドからプロトコルまで"],
  ["docs/api/openapi.md", "開発", "公開API", "HTTP APIとOpenAPIの参照"],
  ["docs/CONTRIBUTING.md", "開発", "コントリビューション", "実装、調査、レビューの進め方"],
  ["docs/developers/plugin-system.md", "開発", "プラグイン開発資料", "旧実装の設計資料。現行配布版では無効"],
  ["links/README.md", "開発", "関連リポジトリ", "Vyline本体と周辺repoの役割、依存関係"],
];

export const platforms = {
  bun: {
    name: "Bun + vyl", detail: "おすすめ / Windows・macOS・Linux", guide: "cli",
    title: "Bun + vylを登録して起動する。",
    description: "Bun 1.4.0以降とGitがあれば、Windows・macOS・Linuxで同じコマンドを使えます。vylを一度登録すると、次からは好きなフォルダから起動できます。",
    file: null, label: "Bun + vyl の手順を見る",
    command: `git clone --recurse-submodules --branch v${version} ${repository}.git\ncd vyline\nbun install\nbun run vyl register\nvyl dev`,
    note: "vyl register はこのチェックアウトを既定に保存します。解除するときは vyl unregister を実行します。",
  },
  windows: {
    name: "Windows", detail: "インストーラー / x64", guide: "windows",
    title: "Setupを開いて、インストール。",
    description: "Bunの準備は不要です。インストール後、スタートメニューからVylineを起動するとブラウザが開きます。",
    file: `VylineSetup-${version}.exe`, label: "Windows版をダウンロード",
    command: null,
    note: "インストールせず試す場合はポータブルZIPを展開し、Vyline.exeを実行します。",
  },
  linux: {
    name: "Linux", detail: "tar.gz / x64", guide: "linux",
    title: "展開して、いつものアプリに。",
    description: "Linux x64向けの配布版です。Bunの準備は不要です。展開後にinstall.shを実行します。",
    file: `Vyline-linux-x64-${version}.tar.gz`, label: "Linux版をダウンロード",
    command: `tar -xzf Vyline-linux-x64-${version}.tar.gz\ncd Vyline-linux-x64-${version}\n./install.sh\n~/.local/bin/vyline`,
    note: "arm64のLinuxでは、このx64配布物ではなくDockerまたはソースから起動します。",
  },
  macos: {
    name: "macOS", detail: "Apple Silicon / Intel ZIP", guide: "macos",
    title: "Mac用アプリをダウンロード。",
    description: "Apple SiliconとIntel Mac向けのローカルアプリを用意しています。チップに合うZIPを選んでください。",
    file: `Vyline-macos-arm64-${version}.zip`, label: "macOS版（Apple Silicon）をダウンロード",
    command: null,
    note: "Intel Mac用ZIPと初回起動時の注意はmacOSガイドを確認してください。macOS版は未署名・未公証です。",
  },
  docker: {
    name: "Docker / Web", detail: "amd64 / arm64", guide: "docker",
    title: "自分のサーバーを、会話の拠点に。",
    description: "Docker Composeでフロントエンドとバックエンドを起動します。データはホスト側へ保存されます。",
    file: null, label: "Dockerの手順を読む",
    command: `git clone --branch v${version} ${repository}.git\ncd vyline\ndocker compose pull\ndocker compose up -d`,
    note: "ブラウザで http://localhost:3000 を開きます。既定ではホスト内からのみ接続できます。",
  },
};
