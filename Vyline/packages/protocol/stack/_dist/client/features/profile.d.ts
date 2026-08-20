import type * as line from "@vyline/line-types";
import type { Client } from "../mod.ts";
/**
 * `ProfileAttribute` values from the Thrift schema (enum `Pb1_K6`).
 *
 * Used as the i32 key in `updateProfileAttributes` so the server knows
 * which subset of the profile is being modified.
 */
export declare const ProfileAttribute: {
    readonly EMAIL: 1;
    readonly DISPLAY_NAME: 2;
    readonly PHONETIC_NAME: 4;
    readonly PICTURE: 8;
    readonly STATUS_MESSAGE: 16;
    readonly ALLOW_SEARCH_BY_USERID: 32;
    readonly ALLOW_SEARCH_BY_EMAIL: 64;
    readonly BUDDY_STATUS: 128;
    readonly MUSIC_PROFILE: 256;
    readonly AVATAR_PROFILE: 512;
    readonly HIDDEN_FROM_LIST: 1024;
};
export type ProfileAttributeKey = keyof typeof ProfileAttribute;
/**
 * Friendly per-field update shape.  Each present key is translated into
 * a `(ProfileAttribute, ProfileContent)` map entry for the server.
 */
export interface MyProfileUpdate {
    displayName?: string;
    statusMessage?: string;
    phoneticName?: string;
    musicProfile?: string;
    allowSearchByUserid?: boolean;
    allowSearchByEmail?: boolean;
    hiddenFromList?: boolean;
}
/**
 * Fetches the signed-in user's own profile (`talk.getProfile`).
 */
export declare function getMyProfile(client: Client): Promise<line.Profile>;
/**
 * Uploads a new profile picture for the signed-in user.
 *
 * LINE Android does this by POSTing the image bytes directly to
 * `/r/talk/p/<mid>` on OBS — the OBS edge writes the object, returns
 * its hash, and the next `getProfile` call shows the new
 * `pictureStatus` reflecting the new image.  No separate Thrift call
 * is needed.
 *
 * @param data  The image bytes (JPEG / PNG).
 * @returns OBS object id + hash. The new picture is live after this
 *          resolves; subsequent friends' `getContacts` will see it.
 */
export declare function uploadMyProfileImage(client: Client, data: Blob): Promise<{
    objId: string;
    objHash: string;
}>;
/**
 * Uploads a new profile-background image (the cover photo behind the
 * profile picture, visible on the user's profile page).
 *
 * Posts to OBS path `myhome/h` — same as a regular myhome photo post
 * — and the returned object id is the one to associate with the
 * profile in a follow-up call (LINE Android persists this association
 * via the myhome service; the OBS object alone is enough for the
 * image to be queryable).
 */
export declare function uploadMyProfileBackground(client: Client, data: Blob): Promise<{
    objId: string;
    objHash: string;
}>;
/**
 * Updates one or more attributes on the signed-in user's profile.
 *
 * Server-side this is a single `updateProfileAttributes` RPC carrying
 * only the keys you actually changed — sparse, not a full replace.
 *
 * @example
 *   await client.updateMyProfile({ statusMessage: "離席中" });
 */
export declare function updateMyProfile(client: Client, update: MyProfileUpdate): Promise<void>;
