/**
 * Profile RPC — stack/client/features/profile の nezuline 内製版
 *
 * stack ソースを直接 import しない（typecheck が vendored stack 全体を引き込まないため）。
 * Desktop: TalkService_getProfile / updateProfileAttributes + OBS talk/p/<mid>
 */

import type * as line from "@vyline/line-types";
import type { Client } from "@vyline/nezuline/stack";

const ProfileAttribute = {
  DISPLAY_NAME: 2,
  PHONETIC_NAME: 4,
  STATUS_MESSAGE: 16,
  ALLOW_SEARCH_BY_USERID: 32,
  ALLOW_SEARCH_BY_EMAIL: 64,
  MUSIC_PROFILE: 256,
  HIDDEN_FROM_LIST: 1024,
} as const;

export interface MyProfileUpdate {
  displayName?: string;
  statusMessage?: string;
  phoneticName?: string;
  /** LINE musicProfile 文字列（JSON or サービス固有 ID） */
  musicProfile?: string;
  allowSearchByUserid?: boolean;
  allowSearchByEmail?: boolean;
  hiddenFromList?: boolean;
}

/** ExtendedProfile.birthday — Desktop: TalkService_updateExtendedProfileAttribute */
export interface MyBirthdayUpdate {
  /** "YYYY" — 空で年非表示 */
  year?: string;
  /** "MMDD" */
  day: string;
  yearEnabled?: boolean;
  dayEnabled?: boolean;
  yearPrivacy?: "PUBLIC" | "PRIVATE";
  dayPrivacy?: "PUBLIC" | "PRIVATE";
}

/** ExtendedProfileAttribute.BIRTHDAY（Thrift: attr i32、誕生日のみ） */
const EXTENDED_PROFILE_ATTR_BIRTHDAY = 0;

function bool(v: boolean): string {
  return v ? "true" : "false";
}

function buildAttrMap(update: MyProfileUpdate): Record<number, line.ProfileContent> {
  const out: Record<number, line.ProfileContent> = {};
  const put = (attr: number, value: string) => {
    out[attr] = { value, meta: {} };
  };
  if (update.displayName !== undefined) put(ProfileAttribute.DISPLAY_NAME, update.displayName);
  if (update.statusMessage !== undefined) put(ProfileAttribute.STATUS_MESSAGE, update.statusMessage);
  if (update.phoneticName !== undefined) put(ProfileAttribute.PHONETIC_NAME, update.phoneticName);
  if (update.musicProfile !== undefined) put(ProfileAttribute.MUSIC_PROFILE, update.musicProfile);
  if (update.allowSearchByUserid !== undefined) {
    put(ProfileAttribute.ALLOW_SEARCH_BY_USERID, bool(update.allowSearchByUserid));
  }
  if (update.allowSearchByEmail !== undefined) {
    put(ProfileAttribute.ALLOW_SEARCH_BY_EMAIL, bool(update.allowSearchByEmail));
  }
  if (update.hiddenFromList !== undefined) {
    put(ProfileAttribute.HIDDEN_FROM_LIST, bool(update.hiddenFromList));
  }
  return out;
}

export async function getMyProfile(client: Client): Promise<line.Profile> {
  return client.base.talk.getProfile({});
}

export async function updateMyProfile(client: Client, update: MyProfileUpdate): Promise<void> {
  const profileAttributes = buildAttrMap(update);
  if (Object.keys(profileAttributes).length === 0) return;
  await client.base.talk.updateProfileAttributes({
    reqSeq: await client.base.getReqseq(),
    request: { profileAttributes },
  });
}

export async function getMyExtendedProfile(client: Client) {
  return client.base.talk.getExtendedProfile({ syncReason: "INTERNAL" });
}

export async function updateMyBirthday(
  client: Client,
  birthday: MyBirthdayUpdate,
): Promise<void> {
  const day = birthday.day.replace(/[^0-9]/g, "").slice(0, 4);
  if (day.length !== 4) {
    throw new Error("birthday.day must be MMDD");
  }
  const year = (birthday.year ?? "").replace(/[^0-9]/g, "").slice(0, 4);
  await client.base.talk.updateExtendedProfileAttribute({
    reqSeq: await client.base.getReqseq(),
    attr: EXTENDED_PROFILE_ATTR_BIRTHDAY,
    extendedProfile: {
      birthday: {
        year,
        day,
        yearEnabled: birthday.yearEnabled ?? Boolean(year),
        dayEnabled: birthday.dayEnabled ?? true,
        yearPrivacyLevelType: birthday.yearPrivacy ?? "PRIVATE",
        dayPrivacyLevelType: birthday.dayPrivacy ?? "PUBLIC",
      },
    },
  });
}

export async function uploadMyProfileImage(
  client: Client,
  data: Blob,
): Promise<{ objId: string; objHash: string }> {
  const mid = client.base.profile?.mid;
  if (!mid) {
    throw new Error("uploadMyProfileImage requires logged-in client (no profile.mid)");
  }
  const result = await client.base.obs.uploadObjectForService({
    data,
    oType: "image",
    obsPath: `talk/p/${mid}`,
  });
  return { objId: result.objId, objHash: result.objHash };
}

export async function uploadMyProfileBackground(
  client: Client,
  data: Blob,
): Promise<{ objId: string; objHash: string }> {
  const result = await client.base.obs.uploadObjectForService({
    data,
    oType: "image",
    obsPath: "myhome/h",
  });
  return { objId: result.objId, objHash: result.objHash };
}
