/**
 * ContactsDomain — 他人プロフィール取得・友だち表示名
 *
 * Desktop: getContactsV3 / TalkService_updateContactSetting
 */

import type { Client } from "./types.js";
import type { ContactRenameInput } from "./types.js";

export class ContactsDomain {
  constructor(private readonly client: Client) {}

  async get(mid: string) {
    return this.client.getUser(mid);
  }

  async listFriends() {
    return this.client.fetchUsers();
  }

  /**
   * 友だちの表示名 override（LINE の「友だち編集 → 表示名」）。
   * displayNameOverride=null でクリア。
   */
  async rename(input: ContactRenameInput) {
    const user = await this.client.getUser(input.mid);
    await user.rename(input.displayNameOverride);
  }
}
