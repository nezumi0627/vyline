/**
 * Settings Demo — プラグイン設定の永続化サンプル。
 *
 * ポイント:
 * - settings:read / settings:write 権限で ctx.settings が有効になる
 * - 設定はアカウント別に data/plugin-settings/<accountId>.<pluginId>.json へ保存
 * - 権限がない場合、get/set は例外ではなく警告ログ + 既定値フォールバック
 */
import { definePlugin } from "@vyline/plugin-sdk";

export default definePlugin({
  id: "settings-demo",
  name: "Settings Demo",
  version: "0.1.0",
  description: "設定の保存/読込とメッセージ購読",
  permissions: ["messages:read", "settings:read", "settings:write"],

  async activate(ctx) {
    // 初回起動時に初期値を書き込む（既にあればそのまま）
    const count = await ctx.settings.get<number>("seenCount", 0);
    await ctx.settings.set("seenCount", count);

    ctx.messages.on("message", async (message) => {
      const prev = await ctx.settings.get<number>("seenCount", 0);
      await ctx.settings.set("seenCount", prev + 1);
      if (prev % 10 === 0) {
        ctx.logger.info(`processed ${prev} messages so far`);
      }
      void message;
    });
  },

  deactivate() {},
});
