import { useEffect, useState } from "react";
import { api } from "@/api/client";
import { useStore } from "@/lib/store";
import { mapMember } from "@/lib/mappers";
import type { Member } from "@/lib/store";
import { cn } from "@/lib/utils";
import { IconClose } from "@/components/icons";

const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T | "timeout"> => {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve("timeout" as const), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve("timeout" as const);
      },
    );
  });
};

const PLUS_KEYFRAMES = `
@keyframes vy-pop { from { opacity: 0; transform: translateY(6px) scale(0.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
@keyframes vy-bounce-in { 0% { transform: rotate(0) scale(1); } 40% { transform: rotate(180deg) scale(1.25); } 100% { transform: rotate(225deg) scale(1); } }
`;

/** LINE の日時入力 → エポック ms（candidate 用） */
function toEpochMs(isoLocal: string): number {
  if (!isoLocal) return 0;
  const d = new Date(isoLocal);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--vy-border)] px-4 py-3">
          <h3 className="text-sm font-semibold text-[var(--vy-text)]">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[var(--vy-text-dim)] hover:bg-[var(--vy-surface-2)]"
          >
            <IconClose size={16} />
          </button>
        </div>
        <div className="overflow-y-auto px-4 py-3 text-sm text-[var(--vy-text)]">{children}</div>
      </div>
    </div>
  );
}

function ModalContainer({
  title,
  onClose,
  embedded,
  children,
}: {
  title: string;
  onClose: () => void;
  embedded: boolean;
  children: React.ReactNode;
}) {
  return embedded ? (
    <div className="px-1 pb-4">{children}</div>
  ) : (
    <Modal title={title} onClose={onClose}>
      {children}
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-xs text-[var(--vy-text-dim)]">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  "w-full rounded-lg border border-[var(--vy-border)] bg-[var(--vy-surface-2)] px-3 py-1.5 text-sm text-[var(--vy-text)] outline-none focus:border-[var(--vy-accent)]";

function ErrorText({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>;
}

function collectAlbums(value: unknown): Array<Record<string, unknown>> {
  if (!value || typeof value !== "object") return [];
  const root = value as Record<string, unknown>;
  const result =
    root.result && typeof root.result === "object"
      ? (root.result as Record<string, unknown>)
      : root;
  for (const key of ["albums", "items", "albumList"]) {
    const list = result[key];
    if (Array.isArray(list))
      return list.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
  }
  return [];
}

function collectAlbumPhotos(value: unknown): Array<Record<string, unknown>> {
  if (!value || typeof value !== "object") return [];
  const root = value as Record<string, unknown>;
  const result =
    root.result && typeof root.result === "object"
      ? (root.result as Record<string, unknown>)
      : root;
  const photos = result.photos;
  return Array.isArray(photos)
    ? photos.filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    : [];
}

export function AlbumModal({
  accountId,
  chatId,
  onClose,
  embedded = false,
  initialAlbumId,
}: {
  accountId: string;
  chatId: string;
  onClose: () => void;
  embedded?: boolean;
  initialAlbumId?: string;
}) {
  const [albums, setAlbums] = useState<Array<Record<string, unknown>>>([]);
  const [selectedId, setSelectedId] = useState(initialAlbumId ?? "");
  const [photos, setPhotos] = useState<Array<Record<string, unknown>>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.line.albums.list(accountId, { chatId });
      setAlbums(collectAlbums(result));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [accountId, chatId]);

  const openAlbum = async (id: string) => {
    setSelectedId(id);
    setBusy(true);
    setError(null);
    try {
      setPhotos(collectAlbumPhotos(await api.line.albums.photos(accountId, id, chatId)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (initialAlbumId) void openAlbum(initialAlbumId);
  }, [accountId, chatId, initialAlbumId]);

  const runAlbum = async (task: () => Promise<unknown>, reopen = false) => {
    setBusy(true);
    setError(null);
    try {
      await task();
      await refresh();
      if (reopen && selectedId) await openAlbum(selectedId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const uploadAlbumImage = async (file: File) => {
    if (!selectedId) return;
    const objectUrl = URL.createObjectURL(file);
    try {
      const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => reject(new Error("画像サイズを取得できませんでした"));
        image.src = objectUrl;
      });
      await runAlbum(async () => {
        const uploaded = await api.line.albums.uploadMedia(accountId, selectedId, chatId, file);
        await api.line.albums.addPhotos(accountId, selectedId, chatId, [
          {
            obsResourceId: { oid: uploaded.oid, sid: "a", svc: "album" },
            width: dimensions.width,
            height: dimensions.height,
            shotTime: Date.now(),
            resourceType: "IMAGE",
          },
        ]);
      }, true);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  };

  return (
    <ModalContainer title="アルバム" onClose={onClose} embedded={embedded}>
      <ErrorText error={error} />
      <div className="mb-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={busy}
          className="rounded-lg border border-[var(--vy-border)] py-2 disabled:opacity-50"
          onClick={() => {
            const title = window.prompt("アルバム名");
            if (title?.trim())
              void runAlbum(() => api.line.albums.create(accountId, chatId, title.trim()));
          }}
        >
          新規作成
        </button>
        <button
          type="button"
          disabled={busy}
          className="rounded-lg border border-[var(--vy-border)] py-2 disabled:opacity-50"
          onClick={() =>
            void api.line.albums
              .preview(accountId, chatId)
              .catch((e) => setError(e instanceof Error ? e.message : String(e)))
          }
        >
          プレビュー確認
        </button>
      </div>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs text-[var(--vy-text-dim)]">アルバム一覧</span>
        <button
          type="button"
          disabled={busy}
          className="text-xs text-[var(--vy-accent)] disabled:opacity-50"
          onClick={() => void refresh()}
        >
          再読み込み
        </button>
      </div>
      <div className="max-h-56 space-y-1 overflow-y-auto">
        {albums.length === 0 ? (
          <p className="py-5 text-center text-xs text-[var(--vy-text-dim)]">アルバムがありません</p>
        ) : (
          albums.map((album, index) => {
            const id = String(album.albumId ?? album.id ?? "");
            const title = String(album.title ?? album.name ?? `アルバム ${index + 1}`);
            return (
              <button
                key={id || index}
                type="button"
                className={cn(
                  "w-full rounded-lg border px-3 py-2 text-left",
                  selectedId === id ? "border-[var(--vy-accent)]" : "border-[var(--vy-border)]",
                )}
                onClick={() => id && void openAlbum(id)}
              >
                <span className="block truncate text-sm">{title}</span>
                <span className="block truncate text-[10px] text-[var(--vy-text-dim)]">{id}</span>
              </button>
            );
          })
        )}
      </div>
      {selectedId && (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={busy}
              className="rounded-lg border border-[var(--vy-border)] py-2 disabled:opacity-50"
              onClick={() => {
                const title = window.prompt("新しいアルバム名");
                if (title?.trim())
                  void runAlbum(() =>
                    api.line.albums.rename(accountId, selectedId, chatId, title.trim()),
                  );
              }}
            >
              名前変更
            </button>
            <button
              type="button"
              disabled={busy}
              className="rounded-lg border border-[var(--vy-border)] py-2 disabled:opacity-50"
              onClick={() =>
                void runAlbum(() => api.line.albums.share(accountId, selectedId, chatId), false)
              }
            >
              共有
            </button>
            <label className="cursor-pointer rounded-lg border border-[var(--vy-border)] py-2 text-center">
              写真追加
              <input
                className="hidden"
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void uploadAlbumImage(f);
                  e.currentTarget.value = "";
                }}
              />
            </label>
            <button
              type="button"
              disabled={busy}
              className="rounded-lg border border-red-500/40 py-2 text-red-400 disabled:opacity-50"
              onClick={() =>
                void runAlbum(async () => {
                  await api.line.albums.remove(accountId, selectedId, chatId);
                  setSelectedId("");
                  setPhotos([]);
                })
              }
            >
              アルバム削除
            </button>
          </div>
          <div className="mt-3 grid max-h-64 grid-cols-3 gap-2 overflow-y-auto rounded-lg border border-[var(--vy-border)] p-2">
            {photos.length === 0 ? (
              <p className="col-span-3 py-4 text-center text-xs text-[var(--vy-text-dim)]">
                写真がありません
              </p>
            ) : (
              photos.map((photo, index) => {
                const resource =
                  photo.obsResourceId && typeof photo.obsResourceId === "object"
                    ? (photo.obsResourceId as Record<string, unknown>)
                    : null;
                const oid = String(photo.oid ?? resource?.oid ?? "");
                const photoId = String(photo.photoId ?? photo.id ?? oid);
                const isVideo =
                  String(photo.resourceType ?? resource?.sid ?? "").toLowerCase() === "v";
                if (!oid) return null;
                const src = api.line.albums.mediaUrl(
                  accountId,
                  selectedId,
                  oid,
                  chatId,
                  isVideo ? "video" : "image",
                );
                return (
                  <div key={`${oid}-${index}`} className="relative">
                    {isVideo ? (
                      <video
                        src={src}
                        controls
                        preload="metadata"
                        className="aspect-square w-full rounded-md object-cover"
                      />
                    ) : (
                      <img
                        src={src}
                        alt="アルバム写真"
                        loading="lazy"
                        className="aspect-square w-full rounded-md object-cover"
                      />
                    )}
                    <button
                      type="button"
                      className="absolute right-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white"
                      onClick={() =>
                        void runAlbum(
                          () =>
                            api.line.albums.deletePhotos(accountId, selectedId, chatId, [photoId]),
                          true,
                        )
                      }
                    >
                      削除
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </ModalContainer>
  );
}

function collectPosts(value: unknown): Array<Record<string, unknown>> {
  if (!value || typeof value !== "object") return [];
  const root = value as Record<string, unknown>;
  const result =
    root.result && typeof root.result === "object"
      ? (root.result as Record<string, unknown>)
      : root;
  for (const key of ["posts", "items", "postList", "feeds"]) {
    const list = result[key];
    if (Array.isArray(list))
      return list.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
  }
  return [];
}

function noteSummary(post: Record<string, unknown>): { id: string; text: string } {
  const contents =
    post.contents && typeof post.contents === "object"
      ? (post.contents as Record<string, unknown>)
      : post;
  return {
    id: String(post.postId ?? post.id ?? contents.postId ?? ""),
    text: String(contents.text ?? post.text ?? "").trim(),
  };
}

export function NoteModal({
  accountId,
  chatId,
  onClose,
  embedded = false,
  initialPostId,
}: {
  accountId: string;
  chatId: string;
  onClose: () => void;
  embedded?: boolean;
  initialPostId?: string;
}) {
  const [posts, setPosts] = useState<Array<Record<string, unknown>>>([]);
  const [selectedId, setSelectedId] = useState(initialPostId ?? "");
  const [text, setText] = useState("");
  const [stickerId, setStickerId] = useState("");
  const [stickerPackageId, setStickerPackageId] = useState("");
  const [sharedPostId, setSharedPostId] = useState("");
  const [comment, setComment] = useState("");
  const [media, setMedia] = useState<Array<{ id: string; type: "PHOTO" | "VIDEO" }>>([]);
  const [likeType, setLikeType] = useState("1001");
  const [likeInfo, setLikeInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setError(null);
    try {
      setPosts(collectPosts(await api.line.notes.list(accountId, chatId)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    void refresh();
  }, [accountId, chatId]);

  useEffect(() => {
    if (!initialPostId) return;
    setSelectedId(initialPostId);
    const selected = posts.find((post) => noteSummary(post).id === initialPostId);
    if (selected) setText(noteSummary(selected).text);
  }, [initialPostId, posts]);

  const noteInput = () => ({
    homeId: chatId,
    ...(text.trim() ? { text: text.trim() } : {}),
    ...(sharedPostId.trim() ? { sharedPostId: sharedPostId.trim() } : {}),
    ...(stickerId.trim()
      ? { stickerIds: [stickerId.trim()], stickerPackageIds: [stickerPackageId.trim() || "1"] }
      : {}),
    ...(media.length
      ? { mediaObjectIds: media.map((m) => m.id), mediaObjectTypes: media.map((m) => m.type) }
      : {}),
  });

  const run = async (task: () => Promise<unknown>, after = true) => {
    setBusy(true);
    setError(null);
    try {
      await task();
      if (after) await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File) => {
    const type = file.type.startsWith("video/") ? "video" : "image";
    setBusy(true);
    try {
      const result = await api.line.notes.uploadMedia(accountId, type, file);
      if (!result.objId) throw new Error("メディアIDを取得できませんでした");
      setMedia((prev) => [
        ...prev,
        { id: result.objId, type: type === "video" ? "VIDEO" : "PHOTO" },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalContainer title="ノート" onClose={onClose} embedded={embedded}>
      <ErrorText error={error} />
      <Field label="本文">
        <textarea
          className={cn(inputCls, "min-h-24 resize-y")}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="ノート本文"
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="スタンプID（任意）">
          <input
            className={inputCls}
            value={stickerId}
            onChange={(e) => setStickerId(e.target.value)}
          />
        </Field>
        <Field label="パッケージID">
          <input
            className={inputCls}
            value={stickerPackageId}
            onChange={(e) => setStickerPackageId(e.target.value)}
          />
        </Field>
      </div>
      <Field label="共有元 postId（任意）">
        <input
          className={inputCls}
          value={sharedPostId}
          onChange={(e) => setSharedPostId(e.target.value)}
        />
      </Field>
      <Field label="画像・動画">
        <input
          type="file"
          accept="image/*,video/*"
          multiple
          onChange={(e) => {
            for (const file of Array.from(e.target.files ?? [])) void upload(file);
            e.currentTarget.value = "";
          }}
        />
        {media.length > 0 && (
          <p className="mt-1 text-xs text-[var(--vy-text-dim)]">
            アップロード済み {media.length}件
          </p>
        )}
      </Field>
      <div className="mb-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={busy}
          className="rounded-lg bg-[var(--vy-accent)] py-2 font-semibold text-[var(--vy-accent-contrast)] disabled:opacity-50"
          onClick={() => void run(() => api.line.notes.create(accountId, noteInput()))}
        >
          新規作成
        </button>
        <button
          type="button"
          disabled={busy || !selectedId}
          className="rounded-lg border border-[var(--vy-border)] py-2 disabled:opacity-50"
          onClick={() => void run(() => api.line.notes.update(accountId, selectedId, noteInput()))}
        >
          選択ノートを更新
        </button>
      </div>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs text-[var(--vy-text-dim)]">ノート一覧</span>
        <button
          type="button"
          className="text-xs text-[var(--vy-accent)]"
          onClick={() => void refresh()}
        >
          再読み込み
        </button>
      </div>
      <div className="mb-4 max-h-48 space-y-1 overflow-y-auto">
        {posts.length === 0 ? (
          <p className="py-4 text-center text-xs text-[var(--vy-text-dim)]">ノートがありません</p>
        ) : (
          posts.map((post, index) => {
            const item = noteSummary(post);
            return (
              <button
                type="button"
                key={item.id || index}
                className={cn(
                  "w-full rounded-lg border px-3 py-2 text-left",
                  selectedId === item.id
                    ? "border-[var(--vy-accent)]"
                    : "border-[var(--vy-border)]",
                )}
                onClick={() => {
                  setSelectedId(item.id);
                  setText(item.text);
                }}
              >
                <span className="block truncate text-sm">
                  {item.text || "（メディア/スタンプノート）"}
                </span>
                <span className="block truncate text-[10px] text-[var(--vy-text-dim)]">
                  {item.id}
                </span>
              </button>
            );
          })
        )}
      </div>
      <Field label="コメント">
        <div className="flex gap-2">
          <input
            className={cn(inputCls, "flex-1")}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <button
            type="button"
            disabled={busy || !selectedId || !comment.trim()}
            className="rounded-lg border border-[var(--vy-border)] px-3 disabled:opacity-50"
            onClick={() =>
              void run(
                () => api.line.notes.comment(accountId, selectedId, chatId, comment.trim()),
                false,
              )
            }
          >
            送信
          </button>
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <select className={inputCls} value={likeType} onChange={(e) => setLikeType(e.target.value)}>
          {["1001", "1002", "1003", "1004", "1005", "1006"].map((v) => (
            <option key={v} value={v}>
              リアクション {v}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy || !selectedId}
          className="rounded-lg border border-[var(--vy-border)] py-2 disabled:opacity-50"
          onClick={() =>
            void run(() => api.line.notes.like(accountId, selectedId, chatId, likeType), false)
          }
        >
          リアクション
        </button>
        <button
          type="button"
          disabled={busy || !selectedId}
          className="rounded-lg border border-[var(--vy-border)] py-2 disabled:opacity-50"
          onClick={() =>
            void run(() => api.line.notes.unlike(accountId, selectedId, chatId), false)
          }
        >
          リアクション解除
        </button>
        <button
          type="button"
          disabled={busy || !selectedId}
          className="rounded-lg border border-[var(--vy-border)] py-2 disabled:opacity-50"
          onClick={() =>
            void run(async () => {
              const [mine, list] = await Promise.all([
                api.line.notes.getLike(accountId, selectedId, chatId),
                api.line.notes.listLikes(accountId, selectedId, chatId),
              ]);
              setLikeInfo(JSON.stringify({ mine, list }));
            }, false)
          }
        >
          リアクション確認
        </button>
        <button
          type="button"
          disabled={busy || !selectedId}
          className="rounded-lg border border-[var(--vy-border)] py-2 disabled:opacity-50"
          onClick={() => void run(() => api.line.notes.share(accountId, selectedId, chatId), false)}
        >
          このチャットへ共有
        </button>
        <label className="cursor-pointer rounded-lg border border-[var(--vy-border)] py-2 text-center">
          コメント画像
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file || !selectedId) return;
              void run(async () => {
                const uploaded = await api.line.notes.uploadCommentImage(accountId, file);
                await api.line.notes.comment(
                  accountId,
                  selectedId,
                  chatId,
                  comment.trim(),
                  uploaded.objId,
                );
              }, false);
              e.currentTarget.value = "";
            }}
          />
        </label>
        <button
          type="button"
          disabled={busy || !selectedId}
          className="rounded-lg border border-red-500/40 py-2 text-red-400 disabled:opacity-50"
          onClick={() =>
            void run(async () => {
              await api.line.notes.remove(accountId, chatId, selectedId);
              setSelectedId("");
              setText("");
            })
          }
        >
          削除
        </button>
      </div>
      {likeInfo && (
        <p className="mt-2 break-all text-[10px] text-[var(--vy-text-dim)]">{likeInfo}</p>
      )}
    </ModalContainer>
  );
}

// ── あみだくじ ──────────────────────────────────────────────

function LadderModal({
  accountId,
  chatId,
  onClose,
}: {
  accountId: string;
  chatId: string;
  onClose: () => void;
}) {
  const chat = useStore((s) => s.chats.find((c) => c.id === chatId));
  const storeMembers = chat?.members ?? [];
  // 参加者一覧はグループと同じ処理（VylineCache + バッチプロフィール）で取得する。
  // ストアの members が空/未解決の場合は専用 API で取得して安定化する。
  const [members, setMembers] = useState<Member[]>(storeMembers);
  const [membersLoading, setMembersLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const needFetch =
      storeMembers.length === 0 || storeMembers.some((m) => /^u[0-9a-f]{32}$/i.test(m.name));
    if (!needFetch) {
      setMembers(storeMembers);
      return;
    }
    (async () => {
      setMembersLoading(true);
      try {
        const res = await withTimeout(api.line.getChatMembers(accountId, chatId), 10_000);
        if (cancelled || res === "timeout" || !res.ok || !res.members?.length) return;
        const fetched = res.members.map((m) => mapMember(m.mid, m.displayName, m.thumbnailUrl));
        setMembers(fetched);
      } catch {
        /* 取得失敗はストアの members をそのまま使う */
      } finally {
        if (!cancelled) setMembersLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, chatId, storeMembers]);

  // 作成/共有時に issueLiffView が遅いため、モーダル展開時に先読みする
  useEffect(() => {
    void api.line.liff.warm(accountId, "ladder", chatId);
  }, [accountId, chatId]);

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [options, setOptions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const memberIds = members.map((m) => m.id);
  const selectedIds = memberIds.filter((id) => selected[id]);

  const allSelected = () => {
    const o: Record<string, boolean> = {};
    for (const m of members) o[m.id] = true;
    setSelected(o);
  };

  useEffect(() => {
    setOptions((prev) => {
      const next = [...prev];
      while (next.length > selectedIds.length) next.pop();
      while (next.length < selectedIds.length) next.push("");
      return next;
    });
  }, [selectedIds.length]);

  const generate = async () => {
    if (selectedIds.length < 2) {
      setError("参加者を 2 人以上選択してください");
      return;
    }
    const filled = selectedIds.length;
    if (options.filter((o) => o.trim()).length < filled) {
      setError(`選択肉を${filled}個入力してください`);
      return;
    }
    onClose();
    // 生成はバックグラウンドで実行（モーダルをブロックしない）
    void (async () => {
      try {
        const res = await api.line.ladder.generate(
          accountId,
          chatId,
          selectedIds,
          options.slice(0, selectedIds.length),
        );
        if (!res.ok) throw new Error("生成に失敗しました");
        const r = res.data as { ladderHash?: string };
        // 生成後は自動で flex を送信
        if (r?.ladderHash) {
          await api.line.ladder.message(accountId, chatId, r.ladderHash);
        }
      } catch (e) {
        window.alert(e instanceof Error ? e.message : "あみだくじの作成に失敗しました");
      }
    })();
  };

  return (
    <Modal title="あみだくじ" onClose={onClose}>
      <ErrorText error={error} />
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs text-[var(--vy-text-dim)]">参加者（{selectedIds.length}人）</span>
        <button
          type="button"
          className="text-xs text-[var(--vy-accent)] disabled:opacity-40"
          onClick={allSelected}
          disabled={membersLoading}
        >
          全員選択
        </button>
      </div>
      {membersLoading ? (
        <p className="mb-3 py-6 text-center text-xs text-[var(--vy-text-dim)]">
          参加者を読み込み中…
        </p>
      ) : (
        <div className="mb-3 max-h-56 space-y-1 overflow-y-auto">
          {members.map((m) => (
            <div
              key={m.id}
              className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-[var(--vy-surface-2)]"
            >
              <input
                type="checkbox"
                checked={!!selected[m.id]}
                onChange={(e) => setSelected((p) => ({ ...p, [m.id]: e.target.checked }))}
              />
              <span className="flex-1 truncate">{m.name}</span>
            </div>
          ))}
        </div>
      )}
      {selectedIds.length > 0 && (
        <div className="mb-3">
          <label className="block text-xs text-[var(--vy-text-dim)] mb-1">
            選択肉 ({selectedIds.length}個の結果を入力)
          </label>
          <div className="space-y-1">
            {selectedIds.map((_, i) => (
              <input
                key={i}
                className={cn(inputCls, "text-xs")}
                placeholder={`結果${i + 1}を入力（例: お皿洗い）`}
                value={options[i] ?? ""}
                onChange={(e) =>
                  setOptions((prev) => {
                    const next = [...prev];
                    next[i] = e.target.value;
                    return next;
                  })
                }
              />
            ))}
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={generate}
        className="w-full rounded-lg bg-[var(--vy-accent)] py-2 font-semibold text-[var(--vy-accent-contrast)]"
      >
        作成して送信
      </button>
    </Modal>
  );
}

// ── イベント作成（スケジュール） ─────────────────────────────

function ScheduleModal({
  accountId,
  chatId,
  onClose,
}: {
  accountId: string;
  chatId: string;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [candidates, setCandidates] = useState<string[]>([""]);
  const [error, setError] = useState<string | null>(null);

  // 共有時に issueLiffView が遅いため、モーダル展開時に先読みする
  useEffect(() => {
    void api.line.liff.warm(accountId, "schedule", chatId);
  }, [accountId, chatId]);

  const create = async () => {
    const times = candidates.map(toEpochMs).filter(Boolean);
    if (!name.trim() || times.length === 0) {
      setError("タイトルと日時を 1 つ以上入力してください");
      return;
    }
    onClose();
    // 作成〜共有はバックグラウンドで実行（モーダルをブロックしない）
    void (async () => {
      try {
        const res = await api.line.schedule.create(accountId, chatId, {
          name: name.trim(),
          description: desc.trim(),
          candidates: times,
        });
        if (!res.ok) throw new Error("作成に失敗しました");
        // 現在のチャットに共有（best effort）: encId を直接取得（名前マッチング不要）
        const group = (await api.line.schedule.group(accountId, chatId)) as {
          ok: boolean;
          data?: { encId?: string; groupName?: string };
        };
        const encId = group?.data?.encId;
        if (!encId) throw new Error("共有先グループが見つかりませんでした");
        const data = res.data as { urlKey?: string };
        const eventKey = data?.urlKey ?? null;
        if (!eventKey) throw new Error("イベントの共有用 URL を取得できませんでした");
        await api.line.schedule.share(
          accountId,
          chatId,
          eventKey,
          [encId],
          "イベントを作成しました。日程を回答してください。",
        );
      } catch (e) {
        window.alert(e instanceof Error ? e.message : "イベントの作成に失敗しました");
      }
    })();
  };

  return (
    <Modal title="イベントを作成" onClose={onClose}>
      <ErrorText error={error} />
      <Field label="タイトル">
        <input
          className={inputCls}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例: 忘年会"
        />
      </Field>
      <Field label="詳細（任意）">
        <textarea
          className={cn(inputCls, "min-h-16")}
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
        />
      </Field>
      <Field label="候補日時">
        <div className="space-y-1">
          {candidates.map((c, i) => (
            <div key={i} className="flex items-center gap-1">
              <input
                type="datetime-local"
                className={cn(inputCls, "flex-1")}
                value={c}
                onChange={(e) =>
                  setCandidates((p) => p.map((x, j) => (j === i ? e.target.value : x)))
                }
              />
              <button
                type="button"
                className="rounded px-1 text-[var(--vy-text-dim)] hover:text-red-400"
                onClick={() => setCandidates((p) => p.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="mt-1 text-xs text-[var(--vy-accent)]"
          onClick={() => setCandidates((p) => [...p, ""])}
        >
          + 日時を追加
        </button>
      </Field>
      <button
        type="button"
        onClick={create}
        className="mt-2 w-full rounded-lg bg-[var(--vy-accent)] py-2 font-semibold text-[var(--vy-accent-contrast)]"
      >
        作成して共有
      </button>
    </Modal>
  );
}

// ── アンケート作成 ─────────────────────────────────────────

function PollModal({
  accountId,
  chatId,
  onClose,
}: {
  accountId: string;
  chatId: string;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [choices, setChoices] = useState<string[]>(["", ""]);
  const [multiple, setMultiple] = useState(true);

  // 共有時に issueLiffView が遅いため、モーダル展開時に先読みする
  useEffect(() => {
    void api.line.liff.warm(accountId, "poll", chatId);
  }, [accountId, chatId]);
  const [anonymous, setAnonymous] = useState(false);
  const [closeDate, setCloseDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    const choiceList = choices
      .map((c) => c.trim())
      .filter(Boolean)
      .map((text) => ({ text }));
    if (!title.trim() || choiceList.length < 2) {
      setError("タイトルと選択肢を 2 つ以上入力してください");
      return;
    }
    onClose();
    // 作成〜共有はバックグラウンドで実行（モーダルをブロックしない）
    void (async () => {
      try {
        const res = await api.line.poll.create(accountId, chatId, {
          title: title.trim(),
          multiple,
          anonymous,
          closeDate: toEpochMs(closeDate),
          choiceList,
        });
        if (!res.ok) throw new Error((res as { error?: string }).error || "作成に失敗しました");
        const data = (res.data ?? {}) as Record<string, unknown>;
        const questionId =
          String(
            data.result ??
              data.questionId ??
              (data.question as Record<string, unknown> | undefined)?.questionId ??
              "",
          ) || "";
        if (!questionId)
          throw new Error("アンケートを作成しましたが、共有用 ID を取得できませんでした");
        const a = await api.line.poll.announce(accountId, chatId, questionId);
        if (!a.ok) {
          window.alert("アンケートを作成しましたが、共有に失敗しました（再度共有してください）");
        }
      } catch (e) {
        window.alert(e instanceof Error ? e.message : "アンケートの作成に失敗しました");
      }
    })();
  };

  return (
    <Modal title="アンケートを作成" onClose={onClose}>
      <ErrorText error={error} />
      <Field label="質問">
        <input
          className={inputCls}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例: どこで飲む？"
        />
      </Field>
      <Field label="選択肢">
        <div className="space-y-1">
          {choices.map((c, i) => (
            <div key={i} className="flex items-center gap-1">
              <input
                className={cn(inputCls, "flex-1")}
                value={c}
                onChange={(e) => setChoices((p) => p.map((x, j) => (j === i ? e.target.value : x)))}
              />
              <button
                type="button"
                className="rounded px-1 text-[var(--vy-text-dim)] hover:text-red-400"
                onClick={() => setChoices((p) => (p.length > 2 ? p.filter((_, j) => j !== i) : p))}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="mt-1 text-xs text-[var(--vy-accent)]"
          onClick={() => setChoices((p) => [...p, ""])}
        >
          + 選択肢を追加
        </button>
      </Field>
      <div className="mb-3 flex gap-4">
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={multiple}
            onChange={(e) => setMultiple(e.target.checked)}
          />{" "}
          複数回答可
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={anonymous}
            onChange={(e) => setAnonymous(e.target.checked)}
          />{" "}
          匿名
        </label>
      </div>
      <Field label="締切（任意）">
        <input
          type="datetime-local"
          className={inputCls}
          value={closeDate}
          onChange={(e) => setCloseDate(e.target.value)}
        />
      </Field>
      <button
        type="button"
        onClick={create}
        className="mt-2 w-full rounded-lg bg-[var(--vy-accent)] py-2 font-semibold text-[var(--vy-accent-contrast)]"
      >
        作成
      </button>
    </Modal>
  );
}

// ── メイン: 「+」ボタンとメニュー ───────────────────────────

export function PlusMenu({ chatId }: { chatId: string }) {
  const accountId = useStore((s) => s.accountId);
  const chat = useStore((s) => s.chats.find((c) => c.id === chatId));
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"schedule" | "ladder" | "poll" | "note" | "album" | null>(null);

  const items: {
    key: "schedule" | "ladder" | "poll" | "note" | "album";
    label: string;
    icon: string;
    disabled?: boolean;
  }[] = [
    { key: "schedule", label: "イベントを作成", icon: "📅" },
    { key: "ladder", label: "あみだくじ", icon: "🎯", disabled: chat?.type !== "group" },
    { key: "poll", label: "アンケート", icon: "🗳️" },
    { key: "note", label: "ノート", icon: "📝", disabled: chat?.type !== "group" },
    { key: "album", label: "アルバム", icon: "🖼️", disabled: chat?.type !== "group" },
  ];

  return (
    <>
      <style>{PLUS_KEYFRAMES}</style>
      <div className="relative">
        <button
          type="button"
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-full text-lg text-[var(--vy-text-dim)] transition-transform duration-200 hover:bg-[var(--vy-surface-2)] hover:text-[var(--vy-text)]",
            open && "rotate-45 text-[var(--vy-accent)]",
          )}
          onClick={() => setOpen((p) => !p)}
          aria-label="メニューを開く"
        >
          ＋
        </button>
        {open && (
          <div
            className="absolute bottom-full left-0 z-[70] mb-2 w-52 overflow-hidden rounded-xl border border-[var(--vy-border)] bg-[var(--vy-surface)] shadow-xl"
            style={{ animation: "vy-pop 0.16s ease-out" }}
          >
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                disabled={item.disabled}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-[var(--vy-text)] hover:bg-[var(--vy-surface-2)] disabled:opacity-40"
                onClick={() => {
                  setOpen(false);
                  setMode(item.key);
                }}
              >
                <span className="text-base">{item.icon}</span>
                {item.label}
                {item.disabled && (
                  <span className="ml-auto text-[10px] text-[var(--vy-text-dim)]">
                    グループのみ
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
      {mode === "schedule" && accountId && (
        <ScheduleModal accountId={accountId} chatId={chatId} onClose={() => setMode(null)} />
      )}
      {mode === "ladder" && accountId && (
        <LadderModal accountId={accountId} chatId={chatId} onClose={() => setMode(null)} />
      )}
      {mode === "poll" && accountId && (
        <PollModal accountId={accountId} chatId={chatId} onClose={() => setMode(null)} />
      )}
      {mode === "note" && accountId && (
        <NoteModal accountId={accountId} chatId={chatId} onClose={() => setMode(null)} />
      )}
      {mode === "album" && accountId && (
        <AlbumModal accountId={accountId} chatId={chatId} onClose={() => setMode(null)} />
      )}
    </>
  );
}
