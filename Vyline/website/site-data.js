export const version = "1.0.3";
export const repository = "https://github.com/nezumi0627/vyline";
export const release = `${repository}/releases/tag/v${version}`;
export const download = (name) => `${repository}/releases/download/v${version}/${name}`;

export const documents = [
  ["docs/start-here.md", "はじめに", "Vylineを使い始める", "導入から最初の設定まで"],
  ["docs/install/windows.md", "インストール", "Windows", "Setupとポータブル版の導入"],
  ["docs/install/linux.md", "インストール", "Linux", "x64配布版の展開と起動"],
  ["docs/install/macos.md", "インストール", "macOS", "ソース起動とブラウザからの利用"],
  ["docs/install/docker.md", "インストール", "Docker / Web", "サーバーを立ててブラウザで使う"],
  ["docs/features.md", "使い方", "機能を知る", "会話、外観、アカウント、データ管理"],
  ["docs/user-guide/themes.md", "使い方", "テーマを作る", "VyThemeと表示のカスタマイズ"],
  ["Vyline/docs/guides/vyline-backup-restore.md", "データ", "バックアップと復元", "VylineBackupの保存範囲と復元方式"],
  ["Vyline/docs/guides/ios-backup-restore.md", "データ", "iOSの履歴取り込み", "暗号化ローカルバックアップからの復元"],
  ["docs/setup-account-handoff-debug.md", "データ", "引継ぎと診断", "設定の移行と診断ログ"],
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
];

export const platforms = {
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
    name: "macOS", detail: "ソース / ブラウザ", guide: "macos",
    title: "Macでは、ブラウザが入口。",
    description: "macOS専用のインストーラーはありません。GitとBun 1.4.0以降を用意し、安定版のソースから起動できます。",
    file: null, label: "macOSの手順を読む",
    command: `git clone --recurse-submodules --branch v${version} ${repository}.git\ncd vyline\nbun install\nbun run dev`,
    note: "起動後は http://localhost:5173 を開きます。別のサーバーで動かし、Macから接続する方法も選べます。",
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
