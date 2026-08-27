import type { VylineClient } from "@vyline/protocol";

const ALBUM_PATHS = new Set([
  "/api/v1.0/initialize",
  "/api/v1.0/album/create",
  "/api/v1.0/album/update",
  "/api/v1.0/album/delete",
  "/api/v1.0/album/list",
  "/api/v1.0/album/get",
  "/api/v1.0/album/content/add",
  "/api/v1.0/album/content/delete",
  "/api/v1.0/album/content/list",
]);

export async function callAlbum(
  client: VylineClient,
  path: string,
  method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
  query?: Record<string, string>,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (!ALBUM_PATHS.has(normalized)) throw new Error("unsupported album operation");
  const album = (
    client.base as typeof client.base & {
      album: {
        call(options: {
          path: string;
          method: "GET" | "POST" | "PUT" | "DELETE";
          query?: Record<string, string>;
          body?: Record<string, unknown>;
        }): Promise<unknown>;
      };
    }
  ).album;
  return await album.call({
    path: normalized,
    method,
    ...(query ? { query } : {}),
    ...(body ? { body } : {}),
  });
}
