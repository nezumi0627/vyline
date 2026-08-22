/**
 * Message Logger — 受信メッセージをログに記録する最小サンプル。
 *
 * 使い方:
 *   1. このフォルダごと Vyline/backend/data/plugins/ にコピー
 *   2. POST /line/{accountId}/plugins/message-logger/enable
 *
 * ログは backend の stdout に `plugin:message-logger` として出力される。
 */
import { definePlugin } from "@vyline/plugin-sdk";

export default definePlugin({
  id: "message-logger",
  name: "Message Logger",
  version: "0.1.0",
  description: "受信メッセージをログに記録する",
  permissions: ["messages:read"],

  activate(ctx) {
    ctx.messages.on("message", (message) => {
      ctx.logger.info(`new message ${message.id} (${message.contentType})`);
    });
  },

  deactivate() {
    // ハンドラは無効化時に自動解除される
  },
});
