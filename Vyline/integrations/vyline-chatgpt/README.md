# Vyline ChatGPT plugin

ChatGPTの **プラグイン → 追加 → Connection: Tunnel** から登録する。
内部のtool通信はMCP SDKのStreamable HTTP。既存Vylineコンテナ内でbackendと
OpenAI公式 `tunnel-client` を起動する。LINE操作にOpenAIの生成APIは使わない。

同梱CLIはOpenAIのv0.0.14ソースを固定し、`golang.org/x/net v0.57.0`と
OpenTelemetry SDK v1.44.0へ依存を更新してGo 1.27.1で再ビルドした
`0.0.14-vyline.1`。公式配布バイナリの脆弱性を修正し、CLIと全toolの機能を維持する。
依存ロックは`./tunnel-client/go.mod`と`go.sum`。GoはDockerのビルド段階だけで使用する。

## Dockerへの組み込み

既存のdata/storageマウントとアカウントをそのまま使う。以下はリポジトリルートで実行。
既存Composeで別名サービス・ポート・data配置を使っている場合、その設定を維持して
同じ変更を反映する。`down -v` やデータディレクトリの初期化は不要。

1. OpenAI Platformの[Tunnels](https://platform.openai.com/settings/organization/tunnels)で
   tunnelを用意し、使用するChatGPT workspaceに関連付ける。
   runtime keyをリポジトリ外のファイルへ保存する。キーをチャットやCompose本文へ貼らない。
   `VYLINE_OPENAI_TUNNEL_KEY_FILE` にそのファイルの絶対パスを設定する。
2. 変更を含むイメージをビルドする。既存の稼働コンテナはこの段階では置き換えない。

   ```sh
   docker compose -f docker-compose.yml -f Vyline/integrations/vyline-chatgpt/docker-compose.chatgpt.yml build vyline
   ```

3. **既存サービスを停止してから**同じdataマウントでgrantを作成する。
   tokenファイルへの別プロセスの同時書き込みを防ぎ、再起動で認証キャッシュも更新する。
   引数なしのsetupは保存アカウントのIDと表示名だけを出す。

   ```sh
   docker compose stop vyline
   docker compose -f docker-compose.yml -f Vyline/integrations/vyline-chatgpt/docker-compose.chatgpt.yml run --rm --no-deps -e VYLINE_CHATGPT_ENABLED=false vyline bun Vyline/backend/src/chatgpt/setup.ts
   docker compose -f docker-compose.yml -f Vyline/integrations/vyline-chatgpt/docker-compose.chatgpt.yml run --rm --no-deps -e VYLINE_CHATGPT_ENABLED=false vyline bun Vyline/backend/src/chatgpt/setup.ts --accounts main,second --tunnel-id tunnel_YOUR_ID --server-admin
   docker compose -f docker-compose.yml -f Vyline/integrations/vyline-chatgpt/docker-compose.chatgpt.yml up -d --no-deps vyline
   ```

   `main,second` は実際のIDへ置き換える。grantは列挙したアカウントのread/write。
   `--server-admin` は共通プロキシ・共通キャッシュなどサーバー全体の操作用admin scopeを付ける。
   省略してもtoolは一覧に残り、実行時に不足権限が返る。通常のアカウント操作はread/writeで使える。
   後から追加したLINEアカウントを自動許可しない。追加時は停止してsetupを再実行する。
   setupは従来のプラグイン用トークンだけを失効し、新しいトークンで置き換える。

4. 起動確認:

   ```sh
   docker compose logs --tail 80 vyline
   docker compose exec vyline tunnel-client doctor --profile-file /app/data/chatgpt/tunnel.yaml --explain
   ```

   profileは`/app/data/chatgpt/tunnel.yaml`、VylineのBearerは同ディレクトリの
   `authorization`（0600）。OpenAI runtime keyはDocker secret
   `/run/secrets/openai-tunnel-runtime-key`。イメージには秘密情報を含めない。
   backendの内部ポートはこのoverlayでは3000。変更した場合はprofileの接続先も合わせる。

## ChatGPTへの登録

開発者モードを有効にしてプラグイン画面から追加し、Tunnelを選択する。
作成したtunnel IDを指定し、read/write toolを確認する。認証はtunnel側に設定した
アカウント限定Bearerで行う。同じtunnelを使えるworkspace利用者はそのgrantを共有するため、
他の利用者には別tunnelと別grantを用意する。

新しい会話でプラグインを追加し、順に実行する:

- 「アカウント一覧を確認して」
- 「mainアカウントの友人から○○さんを探して」
- 「その友人との直近15件を確認して」「さらに前を100件確認して」
- 「mainの未読と不在着信を確認して」
- 「この画像を表示して」
- 書き込み検証は明示した自分のテスト宛先へ送信して確認する。

同名の友人が複数いればMIDで選択する。各応答にaccountIdを付ける。
toolを読むだけで既読送信しない。writeは接続のread/write権限に従う。
ChatGPT自身の確認画面・workspaceポリシーはサーバーから解除しない。

## 同梱スキルとの関連付け（任意）

開発者モードで登録したサーバー自体がChatGPTプラグインとして使える。
同梱スキルもパッケージとして利用する場合は、登録後のURLにある実際の
`plugin_asdk_app...` IDを渡してマッピングを生成する:

```sh
bun Vyline/integrations/vyline-chatgpt/bind-plugin.ts plugin_asdk_app_ACTUAL_ID
```

生成前のパッケージはスキルだけを含む。実在しないapp IDを同梱しない。
生成された`.app.json`と`.codex-plugin/plugin.json`を登録済みプラグインとともに利用する。

## 対応操作と取得範囲

171 tools（read 66 / write 105）を用意している。
toolの正本は`backend/src/chatgpt/catalog.ts`と`tools.ts`。
メッセージ・画像・その他メディア・返信・編集・取消・リアクション・既読、友人とグループ、
スタンプ・組合せスタンプ、ノート、アルバム、投票、日程調整、アナウンス、通話制御、
録音設定と記録管理、バックアップ、Vyline設定、キャッシュ・プロキシ管理を提供する。
初期状態では無効。`VYLINE_CHATGPT_ENABLED=true`で`/v1/chatgpt/mcp`が有効になる。

- 履歴は既定15件、1回1〜100件。`nextCursor`を繰り返して必要な件数を取得する。
  検索・不在着信は保存済み履歴が対象。未保存の古い履歴は`get_messages`で取得する。
  日時検索はepochミリ秒の`fromTime`/`toTime`（両端含む）。同時刻の履歴もIDを含むカーソルで進む。
- `get_missed_calls`はUIと共通の通話判定を使う。不在着信以外の通話で1ページが埋まると
  結果が空でも`nextCursor`がある。続きがなくなるまで取得する。
- `poll_events`は呼び出し時の差分取得。ChatGPTが呼び出していない間の自動通知ではない。
- メディア入力は実データのbase64またはダウンロードURL。1回最大8MiB。
  大容量のバックアップなどはURL入力の`offset`/`length`で分割し、対応する分割アップロードtoolへ渡す。
  録音チャンクは512KiB以下、Androidバックアップは開始toolが返す`chunkSize`に従う。
  URLはHTTPSの完全一致ホスト許可、公開IPへの接続、リダイレクト拒否。
  既定ホストは`files.oaiusercontent.com`。実際の添付URLが別ホストの場合は
  `VYLINE_CHATGPT_UPLOAD_HOSTS`にそのホストをカンマ区切りで明示する。
  ChatGPTがダウンロードURLも実データも提供できない添付は直接送信できない。
- 画像はMCP imageとして返す。大きな受信メディアは`offset`/`length`（最大2MiB）で分割する。
- 通話開始・応答・終了は制御用。音声や映像の接続にはVyline画面が必要。
  LINE側の権限・契約・コンテンツ用ログイン・既存の通話許可条件はそのまま適用する。
- LINE認証トークン、E2EE鍵などはtool応答に含めない。
  書き込みのタイムアウトや通信断では実行済みの可能性があるため、状態を確認してから再試行する。

## コネクター作成時のスキーマエラー

`Invalid MCP tool schema for tool 'get_profile'` は、旧版が公開スキーマへ
Unicodeプロパティ正規表現を出力していた互換性問題。修正版イメージへ更新してから
コネクターを作成し直す。アカウントの設定やトークンを作り直す必要はない。
修正版もサーバー側のUnicode ID検証・アカウント権限検証と171 toolsを維持する。

## 無効化・ロールバック

`VYLINE_CHATGPT_ENABLED=false`にするかoverlayを外し、従来イメージ・Composeで
`up -d --no-deps vyline`する。data/storageは削除しない。失効も必要ならサービス停止中に
同じdataマウントで`setup.ts --revoke`を実行し、再起動する。

## ローカル検証

```sh
bun test Vyline/backend/src/chatgpt/plugin.test.ts
bun run typecheck
```

SDKクライアントとのHTTP接続、read/writeとアカウント境界、画像、カーソル、保存履歴を検証する。
これらは実LINE送信・OpenAI Tunnel接続・Dockerビルドの証明ではない。実接続は上の手順で確認する。

公式資料: [プラグイン接続](https://developers.openai.com/plugins/deploy/connect-chatgpt)、
[Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)、
[tunnel-client](https://github.com/openai/tunnel-client)。
