/**
 * Domain types — backend / facade 共通の操作入力
 */

export type { Client } from "@vyline/protocol/stack";

export interface ProfileUpdateInput {
  displayName?: string;
  statusMessage?: string;
  phoneticName?: string;
  musicProfile?: string;
  allowSearchByUserid?: boolean;
  allowSearchByEmail?: boolean;
  hiddenFromList?: boolean;
}

export type ChatUpdateAttribute = "NAME" | "PICTURE_STATUS";

export interface ChatUpdateInput {
  chatMid: string;
  name?: string;
  pictureStatus?: string;
}

export interface ContactRenameInput {
  mid: string;
  displayNameOverride: string | null;
}
