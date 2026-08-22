/**
 * Example Vyline plugin — 受信メッセージをログに記録するだけの最小構成。
 *
 * 使い方: このフォルダごと Vyline/backend/data/plugins/ にコピーし、
 * 設定 > API/プラグイン (または POST /line/{accountId}/plugins/example-plugin/enable) で有効化。
 */
import { definePlugin } from "@vyline/plugin-sdk";

export default definePlugin({
  id: "example-plugin",
  name: "Example Plugin",
  version: "0.1.0",
  description: "受信メッセージをログに記録する",
  permissions: ["messages:read"],

  activate(ctx) {
    ctx.messages.on("message", (message) => {
      ctx.logger.info(`new message ${message.id} (${message.contentType})`);
    });
  },

  deactivate() {
    // cleanup — ハンドラは自動解除される
  },
});
