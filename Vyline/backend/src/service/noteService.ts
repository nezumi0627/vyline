/**
 * service/noteService.ts — LINE ノート（VOOM/Timeline）操作の BFF ロジック
 *
 * プロトコル: packages/protocol/stack/base/timeline/mod.ts (client.base.timeline)
 * homeId はユーザーホームなら u<mid>、グループノートなら g<id>。
 */

import type { VylineClient } from "@vyline/protocol";
import { childLogger } from "../logger.js";

const log = childLogger("note");

export type NoteContentInput = {
  text?: string;
  sharedPostId?: string;
  stickerIds?: string[];
  stickerPackageIds?: string[];
  mediaObjectIds?: string[];
  mediaObjectTypes?: string[];
  textSizeMode?: "AUTO" | "NORMAL";
  backgroundColor?: string;
  textAnimation?: "NONE" | "SLIDE" | "ZOOM" | "BUZZ" | "BOUNCE" | "BLINK";
  contents?: Record<string, unknown>;
  postInfo?: Record<string, unknown>;
};

export async function listNotes(
  accountId: string,
  client: VylineClient,
  homeId: string,
): Promise<unknown> {
  return await client.base.timeline.listPost({ homeId, sourceType: "GROUPHOME" });
}

export async function getGroupHomeUpdates(
  client: VylineClient,
  revision: number,
): Promise<unknown> {
  return await client.base.timeline.getGroupHomeUpdates(revision);
}

export async function createNote(
  accountId: string,
  client: VylineClient,
  homeId: string,
  input: NoteContentInput,
): Promise<unknown> {
  const res = await client.base.timeline.createPost({
    homeId,
    ...input,
    readPermissionType: "ALL",
    sourceType: "GROUPHOME",
  });
  log.info({ accountId, homeId }, "note created");
  return res;
}

export async function getNote(
  accountId: string,
  client: VylineClient,
  homeId: string,
  postId: string,
): Promise<unknown> {
  return await client.base.timeline.getPost({ homeId, postId });
}

export async function deleteNote(
  accountId: string,
  client: VylineClient,
  homeId: string,
  postId: string,
): Promise<unknown> {
  const res = await client.base.timeline.deletePost({ homeId, postId });
  log.info({ accountId, homeId, postId }, "note deleted");
  return res;
}

export async function shareNoteToChat(
  accountId: string,
  client: VylineClient,
  homeId: string,
  postId: string,
): Promise<unknown> {
  const res = await client.base.timeline.sharePost({ postId, homeId });
  log.info({ accountId, homeId, postId }, "note shared");
  return res;
}

export async function updateNote(
  client: VylineClient,
  homeId: string,
  postId: string,
  input: NoteContentInput,
): Promise<unknown> {
  return await client.base.timeline.updatePost({ ...input, homeId, postId });
}

export async function likeNote(
  client: VylineClient,
  homeId: string,
  postId: string,
  likeType?: "1001" | "1002" | "1003" | "1004" | "1005" | "1006",
): Promise<unknown> {
  return await client.base.timeline.likePost({
    contentId: postId,
    homeId,
    ...(likeType ? { likeType } : {}),
  });
}

export async function unlikeNote(
  client: VylineClient,
  homeId: string,
  postId: string,
): Promise<unknown> {
  return await client.base.timeline.unlikePost({ contentId: postId, homeId });
}

export async function getNoteLike(
  client: VylineClient,
  homeId: string,
  postId: string,
): Promise<unknown> {
  return await client.base.timeline.getLike({ contentId: postId, homeId });
}

export async function listNoteLikes(
  client: VylineClient,
  homeId: string,
  postId: string,
): Promise<unknown> {
  return await client.base.timeline.listLikes({ contentId: postId, homeId });
}

export async function commentNote(
  client: VylineClient,
  homeId: string,
  postId: string,
  commentText: string,
  contentsList?: unknown[],
): Promise<unknown> {
  return await client.base.timeline.createComment({
    contentId: postId,
    homeId,
    commentText,
    ...(contentsList ? { contentsList } : {}),
  });
}

export async function listNoteComments(
  client: VylineClient,
  homeId: string,
  postId: string,
): Promise<unknown> {
  return await client.base.timeline.listComments({ contentId: postId, homeId });
}

export async function deleteNoteComment(
  client: VylineClient,
  homeId: string,
  postId: string,
  commentId: string,
): Promise<unknown> {
  return await client.base.timeline.deleteComment({ contentId: postId, commentId, homeId });
}

export async function likeNoteComment(
  client: VylineClient,
  homeId: string,
  commentId: string,
  likeType?: "1001" | "1002" | "1003" | "1004" | "1005" | "1006",
): Promise<unknown> {
  return await client.base.timeline.likeComment({
    commentId,
    homeId,
    ...(likeType ? { likeType } : {}),
  });
}

export async function unlikeNoteComment(
  client: VylineClient,
  homeId: string,
  commentId: string,
): Promise<unknown> {
  return await client.base.timeline.unlikeComment({ commentId, homeId });
}

export async function uploadNoteMedia(
  client: VylineClient,
  type: "image" | "video",
  data: Blob,
): Promise<{ objId: string; objHash: string }> {
  return await client.base.timeline.uploadNoteMedia(type, data);
}

export async function uploadNoteCommentImage(
  client: VylineClient,
  data: Blob,
): Promise<{ objId: string; objHash: string }> {
  return await client.base.timeline.uploadNoteCommentImage(data);
}
