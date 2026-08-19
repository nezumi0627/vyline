/**
 * ChatDomain — グループ/ルーム管理（名前・画像・招待など）
 *
 * Desktop: TalkService_updateChat_pargs
 * updatedAttribute: NAME | PICTURE_STATUS | …
 */

import type { Client } from "./types.js";
import type { ChatUpdateInput } from "./types.js";

export class ChatDomain {
  constructor(private readonly client: Client) {}

  async get(chatMid: string) {
    return this.client.getChat(chatMid);
  }

  async updateName(chatMid: string, name: string) {
    const chat = await this.client.getChat(chatMid);
    return chat.updateName(name);
  }

  /**
   * グループ画像: OBS で得た picturePath を updateChat(PICTURE_STATUS) に渡す。
   */
  async updatePicturePath(chatMid: string, picturePath: string) {
    const chat = await this.client.getChat(chatMid);
    return chat.updateChat({
      chat: { chatMid, picturePath },
      updatedAttribute: "PICTURE_STATUS",
    });
  }

  /**
   * グループ画像を OBS に上げてから Chat 属性を更新する。
   */
  async uploadAndSetPicture(chatMid: string, data: Blob) {
    const { objId, objHash } = await this.client.base.obs.uploadObjTalk(chatMid, "image", data);
    const picturePath = `/${objHash || objId}`;
    await this.updatePicturePath(chatMid, picturePath);
    return { picturePath, objId, objHash };
  }

  async update(input: ChatUpdateInput) {
    if (input.name !== undefined) {
      return this.updateName(input.chatMid, input.name);
    }
    if (input.pictureStatus !== undefined) {
      return this.updatePicturePath(input.chatMid, input.pictureStatus);
    }
    throw new Error("ChatDomain.update: name or pictureStatus required");
  }

  async invite(chatMid: string, mids: string[]) {
    const chat = await this.client.getChat(chatMid);
    return chat.invite(mids);
  }

  async kick(chatMid: string, mid: string) {
    const chat = await this.client.getChat(chatMid);
    return chat.kick(mid);
  }

  async leave(chatMid: string) {
    const chat = await this.client.getChat(chatMid);
    return chat.leave();
  }
}
