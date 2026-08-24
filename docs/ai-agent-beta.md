# Agent I ベータ機能

Issue #64 のベータ機能として、Yahoo の Agent I を使った文章支援を提供します。

質問・文章の推敲・明示的に選択したトークの要約を行い、回答は下書きへ挿入できます。チャット画面からの今日の会話要約、相手プロフィールからの会話要約にも対応します。LINEへの自動送信は行いません。

入力したプロンプト、明示的に選択した要約本文、短いAI会話履歴は回答生成のためYahooのAgent Iへ送信されます。Vylineはそれらを保存・収集せず、匿名Yahooセッションもbackendメモリ内だけに保持します。

初回利用時に機能単位の同意を求め、同意ログは端末のローカルストレージに保存します。機密情報・認証情報・第三者の個人情報を入力しないでください。回答は正確性を保証せず、法律・医療・金融の助言ではありません。

API:

- `POST /api/beta/agent-i/:accountId/chat`
- `GET /api/beta/agent-i/:accountId/history`
- `DELETE /api/beta/agent-i/:accountId/session`
