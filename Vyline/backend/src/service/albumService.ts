import type { VylineClient } from "@vyline/protocol";

type AlbumClient = {
  list(options: { chatId: string; cursor?: string; orderBy?: string; include?: string }): Promise<unknown>;
  preview(options: { chatId: string; pageSize?: number; thumbnailCount?: number; viewType?: string }): Promise<unknown>;
  create(options: { chatId: string; title: string; modifyDuplicateTitle?: boolean }): Promise<unknown>;
  update(options: { chatId: string; albumId: string; title: string }): Promise<unknown>;
  delete(options: { chatId: string; albumId: string }): Promise<unknown>;
  share(options: { chatId: string; albumId: string }): Promise<unknown>;
  photos(options: {
    chatId: string;
    albumId: string;
    cursor?: string;
    pageSize?: number;
    orderBy?: string;
    include?: string;
    filterType?: string;
    targetUser?: string;
  }): Promise<unknown>;
  addPhotos(options: {
    chatId: string;
    albumId: string;
    photos: Array<{
      obsResourceId: { oid: string; sid?: string; svc?: string };
      width: number;
      height: number;
      shotTime?: number;
      resourceType?: string;
    }>;
  }): Promise<unknown>;
  deletePhotos(options: { chatId: string; albumId: string; photoIds: string[] }): Promise<unknown>;
  upload(options: {
    chatId: string;
    albumId: string;
    oid: string;
    data: Blob;
    contentType?: string;
  }): Promise<{ oid: string }>;
  download(options: {
    chatId: string;
    albumId: string;
    oid: string;
    mediaType?: "image" | "video";
  }): Promise<Response>;
};

const albumClient = (client: VylineClient) =>
  (client.base as typeof client.base & { album: AlbumClient }).album;

export function listAlbums(
  client: VylineClient,
  query: { chatId: string; cursor?: string; orderBy?: string; include?: string },
) {
  return albumClient(client).list(query);
}

export function previewAlbums(client: VylineClient, query: { chatId: string; pageSize?: string; thumbnailCount?: string; viewType?: string }) {
  return albumClient(client).preview({
    chatId: query.chatId,
    ...(query.pageSize ? { pageSize: Number(query.pageSize) } : {}),
    ...(query.thumbnailCount ? { thumbnailCount: Number(query.thumbnailCount) } : {}),
    ...(query.viewType ? { viewType: query.viewType } : {}),
  });
}

export function createAlbum(client: VylineClient, input: { chatId: string; title: string; modifyDuplicateTitle?: boolean }) {
  return albumClient(client).create(input);
}

export function updateAlbum(client: VylineClient, albumId: string, input: { chatId: string; title: string }) {
  return albumClient(client).update({ albumId, ...input });
}

export function deleteAlbum(client: VylineClient, albumId: string, chatId: string) {
  return albumClient(client).delete({ albumId, chatId });
}

export function shareAlbum(client: VylineClient, albumId: string, chatId: string) {
  return albumClient(client).share({ albumId, chatId });
}

export function listAlbumPhotos(
  client: VylineClient,
  albumId: string,
  query: {
    chatId: string;
    cursor?: string;
    pageSize?: string;
    orderBy?: string;
    include?: string;
    filterType?: string;
    targetUser?: string;
  },
) {
  return albumClient(client).photos({
    chatId: query.chatId,
    albumId,
    ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
    ...(query.pageSize !== undefined ? { pageSize: Number(query.pageSize) } : {}),
    ...(query.orderBy !== undefined ? { orderBy: query.orderBy } : {}),
    ...(query.include !== undefined ? { include: query.include } : {}),
    ...(query.filterType !== undefined ? { filterType: query.filterType } : {}),
    ...(query.targetUser !== undefined ? { targetUser: query.targetUser } : {}),
  });
}

export function addAlbumPhotos(client: VylineClient, albumId: string, input: Parameters<AlbumClient["addPhotos"]>[0]) {
  return albumClient(client).addPhotos({ ...input, albumId });
}

export function deleteAlbumPhotos(client: VylineClient, albumId: string, chatId: string, photoIds: string[]) {
  return albumClient(client).deletePhotos({ albumId, chatId, photoIds });
}

export async function uploadAlbumMedia(
  client: VylineClient,
  albumId: string,
  input: { chatId: string; data: Blob; oid?: string; contentType?: string },
): Promise<{ oid: string }> {
  const now = new Date();
  const yy = String(now.getUTCFullYear()).slice(-2);
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const hh = String(now.getUTCHours()).padStart(2, "0");
  const oid = input.oid ?? `${crypto.randomUUID().replaceAll("-", "")}.${yy}${mm}${dd}${hh}`;
  return await albumClient(client).upload({
    albumId,
    chatId: input.chatId,
    oid,
    data: input.data,
  });
}

export function downloadAlbumMedia(
  client: VylineClient,
  albumId: string,
  options: { chatId: string; oid: string; mediaType?: "image" | "video" },
) {
  return albumClient(client).download({ albumId, ...options });
}
