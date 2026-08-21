/**
 * ProfileDomain — 自分のプロフィール取得・更新・画像
 *
 * Desktop: TalkService_getProfile / TalkService_updateProfileAttributes
 * OBS: obs.line-apps.com（アバター・背景）
 */

import type { Client } from "./types.js";
import type { ProfileUpdateInput } from "./types.js";
import {
  getMyExtendedProfile,
  getMyProfile,
  updateMyProfile,
  uploadMyProfileBackground,
  uploadMyProfileImage,
  type MyProfileUpdate,
} from "../protocol/profileOps.js";

export class ProfileDomain {
  constructor(private readonly client: Client) {}

  async getMine() {
    return getMyProfile(this.client);
  }

  async getExtended() {
    return getMyExtendedProfile(this.client);
  }

  async update(input: ProfileUpdateInput) {
    const update: MyProfileUpdate = {};
    if (input.displayName !== undefined) update.displayName = input.displayName;
    if (input.statusMessage !== undefined) update.statusMessage = input.statusMessage;
    if (input.phoneticName !== undefined) update.phoneticName = input.phoneticName;
    if (input.musicProfile !== undefined) update.musicProfile = input.musicProfile;
    if (input.allowSearchByUserid !== undefined) {
      update.allowSearchByUserid = input.allowSearchByUserid;
    }
    if (input.allowSearchByEmail !== undefined) {
      update.allowSearchByEmail = input.allowSearchByEmail;
    }
    if (input.hiddenFromList !== undefined) update.hiddenFromList = input.hiddenFromList;
    const hasAttrs = Object.keys(update).length > 0;
    if (!hasAttrs) {
      throw new Error("ProfileDomain.update: empty update");
    }
    if (hasAttrs) await updateMyProfile(this.client, update);
  }

  async uploadAvatar(data: Blob) {
    return uploadMyProfileImage(this.client, data);
  }

  async uploadBackground(data: Blob) {
    return uploadMyProfileBackground(this.client, data);
  }
}
