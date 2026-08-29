import { useEffect, useState } from "react";
import { api } from "@/api/client";

type PanelKind = "notes" | "albums";

function records(value: unknown, keys: string[]) {
  if (!value || typeof value !== "object") return [];
  const root = value as Record<string, unknown>;
  const result =
    root.result && typeof root.result === "object"
      ? (root.result as Record<string, unknown>)
      : root;
  for (const key of keys) {
    const list = result[key];
    if (Array.isArray(list)) {
      return list.filter(
        (item): item is Record<string, unknown> => !!item && typeof item === "object",
      );
    }
  }
  return [];
}

function noteText(post: Record<string, unknown>) {
  const contents =
    post.contents && typeof post.contents === "object"
      ? (post.contents as Record<string, unknown>)
      : post;
  return String(contents.text ?? post.text ?? "").trim();
}

export function ProfileContentPanel({
  kind,
  accountId,
  chatId,
}: {
  kind: PanelKind;
  accountId: string;
  chatId: string;
}) {
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [photos, setPhotos] = useState<Array<Record<string, unknown>>>([]);
  const [selectedAlbumId, setSelectedAlbumId] = useState("");
  const [selectedAlbumTitle, setSelectedAlbumTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const value =
        kind === "notes"
          ? await api.line.notes.list(accountId, chatId)
          : await api.line.albums.list(accountId, { chatId });
      setItems(
        records(
          value,
          kind === "notes"
            ? ["posts", "items", "postList", "feeds"]
            : ["albums", "items", "albumList"],
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setSelectedAlbumId("");
    setSelectedAlbumTitle("");
    setPhotos([]);
    void refresh();
  }, [accountId, chatId, kind]);

  const openAlbum = async (id: string, title: string) => {
    setSelectedAlbumId(id);
    setSelectedAlbumTitle(title);
    setLoading(true);
    setError(null);
    try {
      setPhotos(records(await api.line.albums.photos(accountId, id, chatId), ["photos", "items"]));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="px-5 pb-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {kind === "notes"
              ? "ノート一覧"
              : selectedAlbumId
                ? selectedAlbumTitle
                : "アルバム一覧"}
          </p>
          <p className="mt-0.5 text-xs text-[var(--vy-text-dim)]">
            {kind === "notes"
              ? "このトークに保存されているノート"
              : selectedAlbumId
                ? `${photos.length}件のメディア`
                : "このトークで共有されているアルバム"}
          </p>
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={() => {
            if (selectedAlbumId) {
              setSelectedAlbumId("");
              setSelectedAlbumTitle("");
              setPhotos([]);
            } else {
              void refresh();
            }
          }}
          className="shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--vy-accent)] transition-colors hover:bg-[var(--vy-surface-2)] disabled:opacity-50"
        >
          {selectedAlbumId ? "一覧へ" : "再読み込み"}
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded-xl border border-[color-mix(in_oklab,var(--vy-danger)_35%,var(--vy-border))] bg-[color-mix(in_oklab,var(--vy-danger)_8%,transparent)] px-3 py-2 text-xs text-[var(--vy-danger)]">
          {error}
        </div>
      )}

      {loading && items.length === 0 && photos.length === 0 ? (
        <div className="py-16 text-center text-sm text-[var(--vy-text-dim)]">読み込み中…</div>
      ) : kind === "notes" ? (
        items.length === 0 ? (
          <Empty label="ノートはまだありません" />
        ) : (
          <div className="space-y-2">
            {items.map((post, index) => {
              const id = String(post.postId ?? post.id ?? index);
              const text = noteText(post);
              return (
                <article
                  key={id}
                  className="rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface-2)] px-4 py-3"
                >
                  <p className="whitespace-pre-wrap break-words text-sm leading-6">
                    {text || "画像・動画・スタンプを含むノート"}
                  </p>
                  <p className="mt-2 truncate text-[10px] text-[var(--vy-text-dim)]">{id}</p>
                </article>
              );
            })}
          </div>
        )
      ) : selectedAlbumId ? (
        photos.length === 0 ? (
          <Empty label="このアルバムには写真がありません" />
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {photos.map((photo, index) => {
              const resource =
                photo.obsResourceId && typeof photo.obsResourceId === "object"
                  ? (photo.obsResourceId as Record<string, unknown>)
                  : undefined;
              const oid = String(photo.oid ?? resource?.oid ?? "");
              if (!oid) return null;
              const isVideo =
                String(photo.resourceType ?? resource?.sid ?? "").toLowerCase() === "v";
              const src = api.line.albums.mediaUrl(
                accountId,
                selectedAlbumId,
                oid,
                chatId,
                isVideo ? "video" : "image",
              );
              return isVideo ? (
                <video
                  key={`${oid}-${index}`}
                  src={src}
                  controls
                  preload="metadata"
                  className="aspect-square w-full rounded-xl border border-[var(--vy-border)] bg-black object-cover"
                />
              ) : (
                <img
                  key={`${oid}-${index}`}
                  src={src}
                  alt="アルバム写真"
                  loading="lazy"
                  className="aspect-square w-full rounded-xl border border-[var(--vy-border)] bg-[var(--vy-surface-2)] object-cover"
                />
              );
            })}
          </div>
        )
      ) : items.length === 0 ? (
        <Empty label="アルバムはまだありません" />
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {items.map((album, index) => {
            const id = String(album.albumId ?? album.id ?? "");
            const title = String(album.title ?? album.name ?? `アルバム ${index + 1}`);
            return (
              <button
                key={id || index}
                type="button"
                disabled={!id}
                onClick={() => id && void openAlbum(id, title)}
                className="group overflow-hidden rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface-2)] text-left transition-transform hover:-translate-y-0.5 disabled:opacity-50"
              >
                <div className="grid aspect-[4/3] grid-cols-2 gap-px bg-[var(--vy-border)]">
                  {[0, 1, 2, 3].map((cell) => (
                    <span
                      key={cell}
                      className="bg-[color-mix(in_oklab,var(--vy-accent)_12%,var(--vy-surface))] transition-colors group-hover:bg-[color-mix(in_oklab,var(--vy-accent)_18%,var(--vy-surface))]"
                    />
                  ))}
                </div>
                <div className="px-3 py-2.5">
                  <p className="truncate text-sm font-medium">{title}</p>
                  <p className="mt-0.5 truncate text-[10px] text-[var(--vy-text-dim)]">{id}</p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--vy-border)] bg-[var(--vy-surface-2)] px-4 py-14 text-center text-sm text-[var(--vy-text-dim)]">
      {label}
    </div>
  );
}
