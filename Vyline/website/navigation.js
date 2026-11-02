const aliases = { tour: "start", explore: "experience", library: "docs", main: "home" };
export function routeFromHash(hash) {
  const name = hash.replace(/^#\/?/, "").split(/[?\/]/)[0];
  const route = aliases[name] ?? name;
  return ["start", "experience", "docs"].includes(route) ? route : "home";
}

export const guideIntents = {
  appearance: { question: "見た目を、自分好みに。", description: "アプリのテーマ、文字サイズ、表示密度の設定から始めます。テーマの仕組みやプリセットを作る方法も、このガイドにまとめています。", path: "docs/user-guide/themes.md", title: "テーマと表示のガイド" },
  data: { question: "何を、残したい？", choices: [
    ["会話の履歴とメディア", "VylineBackupで、チャットを選んで保存・復元する", "Vyline/docs/guides/vyline-backup-restore.md"],
    ["見た目などの設定", "設定引継ぎZIPを使う。ログイン情報は含めません", "docs/setup-account-handoff-debug.md"],
    ["iPhoneにある過去の履歴", "暗号化ローカルバックアップの対応範囲を確認する", "Vyline/docs/guides/ios-backup-restore.md"],
  ] },
  help: { question: "どこで、困っている？", choices: [
    ["ログイン・初回設定", "QRコードとスマホ側の承認から確認する", "docs/start-here.md"],
    ["アプリの更新", "環境ごとの更新方法と、事前のバックアップを確認する", "docs/user-guide/update.md"],
    ["原因を調べたい", "診断ログを確認し、共有前に内容を見直す", "docs/setup-account-handoff-debug.md"],
  ] },
};
