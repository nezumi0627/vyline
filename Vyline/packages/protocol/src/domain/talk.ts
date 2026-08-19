/**
 * TalkDomain — メッセージ送受信の薄い facade
 *
 * Desktop: TalkService_sendMessage / unsendMessage / getPreviousMessagesV2WithRequest
 * E2EE 本体は letterSealing + backend lineService 側（ここは低レベル委譲）
 */

import type { Client } from "./types.js";
import { sendText, type VylineClient } from "../client/VylineClient.js";

export class TalkDomain {
  constructor(private readonly client: Client) {}

  async sendText(to: string, text: string, e2ee = true) {
    return sendText(this.client as VylineClient, to, text, e2ee);
  }

  async unsend(messageId: string) {
    await this.client.base.talk.unsendMessage({ messageId });
  }

  async markRead(chatMid: string, lastMessageId: string) {
    await this.client.base.talk.sendChatChecked({
      seq: 0,
      chatMid,
      lastMessageId,
    });
  }

  get raw() {
    return this.client.base.talk;
  }
}
