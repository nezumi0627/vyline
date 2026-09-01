import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { api } from "@/api/client";
import { compressImageFile } from "@/utils/compressImage";
import {
  IconSend,
  IconSmile,
  IconPaperclip,
  IconMic,
  IconClose,
  IconAtSign,
  IconBellOff,
  IconSpark,
} from "@/components/icons";
import { AgentIActionDialog } from "@/components/agent-i-action-dialog";
import { StickerEmojiPanel } from "@/components/sticker-emoji-panel";
import { FloatNotice } from "@/components/float-notice";
import { segmentTextWithSticon, type SticonResource } from "@/utils/lineSticon";
import { buildMentionMetadata, recomputeMentionsOnEdit } from "@/utils/mention";
import { mapMember } from "@/lib/mappers";
import { isDesktopInteraction } from "@/lib/interactionEnvironment";
import { PlusMenu } from "@/components/plus-menu";
import type { MessageState } from "@/lib/store-types";

function replyPreviewText(msg: {
  kind: string;
  text?: string;
  altText?: string;
  sticker?: string;
  messageState?: MessageState;
}): string {
  if (msg.messageState?.startsWith("revoked")) return "取り消されたメッセージ";
  if (msg.kind === "image") return "写真";
  if (msg.kind === "video") return "動画";
  if (msg.kind === "audio") return "音声メッセージ";
  if (msg.kind === "sticker") return "スタンプ";
  if (msg.kind === "emoji") return "絵文字";
  if (msg.kind === "call") return "通話";
  if (msg.kind === "flex" || msg.kind === "rich") return msg.altText || msg.text || "カード";
  if (msg.kind === "system") return msg.text || "システムメッセージ";
  const t = (msg.text ?? "").replace(/[￼�$]/g, "").trim();
  return t || "絵文字";
}

/** LINE Desktop と同じ OBJECT REPLACEMENT CHARACTER（送信ペイロード用・画面には出さない） */
const STICON_PLACEHOLDER = "\uFFFC";

/** \u672A\u4F7F\u7528\u30C1\u30E3\u30C3\u30C8\u7528\u306E\u7A7A\u30EA\u30B9\u30C8\uFF08\u6BCE render \u65B0\u3057\u3044\u914D\u5217\u3092\u4F5C\u3089\u306A\u3044\uFF09 */
const NO_STICONS: SticonResource[] = [];

function buildSticonMetadata(resources: SticonResource[]): Record<string, string> | undefined {
  if (!resources.length) return undefined;
  return {
    REPLACE: JSON.stringify({
      sticon: {
        resources: resources.map((r) => ({
          S: r.S ?? 0,
          E: r.E ?? (r.S ?? 0) + 1,
          productId: r.productId,
          sticonId: r.sticonId,
          version: 1,
          resourceType: "STATIC",
        })),
      },
    }),
    STICON_OWNERSHIP: JSON.stringify([...new Set(resources.map((r) => r.productId))]),
  };
}

/** 本文中の ￼ 位置から S/E を再構築（編集後のずれを防ぐ） */
function recomputeSticonRanges(text: string, resources: SticonResource[]): SticonResource[] {
  const out: SticonResource[] = [];
  let ri = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === STICON_PLACEHOLDER && ri < resources.length) {
      const r = resources[ri++]!;
      out.push({ productId: r.productId, sticonId: r.sticonId, S: i, E: i + 1 });
    }
  }
  return out;
}

function syncSticonsToText(text: string, resources: SticonResource[]): SticonResource[] {
  return recomputeSticonRanges(text, resources);
}

/** カーソル直前のトークンが "@" で始まる場合、その開始位置と検索語を返す（グループ内メンション用） */
function detectMentionTrigger(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  if (caret <= 0) return null;
  let j = caret;
  while (j > 0 && !/\s/.test(text[j - 1]!)) j--;
  if (text[j] === "@" && (j === 0 || /\s/.test(text[j - 1]!))) {
    return { start: j, query: text.slice(j + 1, caret) };
  }
  return null;
}

export function MessageInput({ chatId }: { chatId: string }) {
  const draft = useStore((s) => s.drafts[chatId] ?? "");
  const setDraft = useStore((s) => s.setDraft);
  const sendMessage = useStore((s) => s.sendMessage);
  const sendSticker = useStore((s) => s.sendSticker);
  const sendCombinationSticker = useStore((s) => s.sendCombinationSticker);
  const sendAudio = useStore((s) => s.sendAudio);
  const accountId = useStore((s) => s.accountId);
  const agentEnabled = useStore((s) => s.settings.betaAgentI);
  const replyToId = useStore((s) => s.replyToId);
  const setReplyTo = useStore((s) => s.setReplyTo);
  const scrollToMessage = useStore((s) => s.scrollToMessage);
  const messages = useStore((s) => s.messages);
  const chats = useStore((s) => s.chats);
  const self = useStore((s) => s.self);
  const blockedMids = useStore((s) => s.blockedMids);
  const lockedChatMids = useStore((s) => s.lockedChatMids);
  const fileRef = useRef<HTMLInputElement>(null);

  const [picker, setPicker] = useState(false);
  const [muteNext, setMuteNext] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  // 下書きの本文（￼ プレースホルダ）と絵文字メタデータを同一ストアに永続化して、チャット切替・再起動後もズレないようにする
  const draftSticons = useStore((s) => s.draftSticons[chatId] ?? NO_STICONS);
  const setDraftSticons = useStore((s) => s.setDraftSticons);
  const setDraftMentions = useStore((s) => s.setDraftMentions);
  const [overlayScrollTop, setOverlayScrollTop] = useState(0);
  // メンション候補ピッカー（"@" トリガー）
  const [mentionPicker, setMentionPicker] = useState<{ start: number; query: string } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [pendingMedia, setPendingMedia] = useState<
    Array<{
      id: string;
      file: File;
      url: string;
      kind: "image" | "video";
    }>
  >([]);
  const [sendingMediaBatch, setSendingMediaBatch] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);

  // 画像送信中かどうか（楽観メッセージの pending image を検出）
  const sendingImage = messages.some(
    (m) =>
      m.chatId === chatId &&
      m.authorId === "me" &&
      (m.kind === "image" || m.kind === "video") &&
      m.status === "sending",
  );
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    for (const item of pendingMedia) URL.revokeObjectURL(item.url);
    setPendingMedia([]);
  }, [chatId]);

  // ￼ プレースホルダの実幅（1em 比）を計測し、絵文字画像を同じ幅に描画する。
  // オーバーレイと textarea の折返し位置・キャレットを一致させるため。1em 固定だとフォント fallback 時にズレる。
  const [sticonEm, setSticonEm] = useState(1);
  const measureSticonEm = () => {
    const ta = taRef.current;
    if (!ta) return;
    const cs = getComputedStyle(ta);
    const probe = document.createElement("span");
    probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre;pointer-events:none";
    probe.style.font = `${cs.fontSize} ${cs.fontFamily}`;
    ta.parentElement?.appendChild(probe);
    const em = Number.parseFloat(cs.fontSize) || 1;
    setSticonEm(probe.getBoundingClientRect().width / em || 1);
    probe.remove();
  };
  useLayoutEffect(() => {
    measureSticonEm();
  }, []);
  useEffect(() => {
    // Web フォント読込完了後に再計測（フォールバック幅のまま固定されないように）
    document.fonts?.ready?.then(measureSticonEm);
  }, []);

  const replyMsg = replyToId ? messages.find((m) => m.id === replyToId) : null;
  const chat = chats.find((c) => c.id === chatId);
  // ブロック中の友だちには送信 UI を出さない
  const blocked = chat?.type === "friend" && blockedMids.includes(chatId);
  const locked = lockedChatMids.includes(chatId);

  // メンションピッカー表示時にグループメンバー未ロードなら自動取得
  useEffect(() => {
    if (!mentionPicker || !accountId || chat?.type !== "group" || chat?.members?.length) return;
    let cancelled = false;
    void api.line
      .chatMembers(accountId, chatId)
      .then(
        (res: {
          ok: boolean;
          members?: Array<{ mid: string; displayName: string; thumbnailUrl?: string }>;
        }) => {
          if (cancelled || !res.ok || !res.members) return;
          const members = res.members.map(
            (m: { mid: string; displayName: string; thumbnailUrl?: string }) =>
              mapMember(m.mid, m.displayName, m.thumbnailUrl),
          );
          useStore.setState((st) => ({
            chats: st.chats.map((c) => (c.id === chatId ? { ...c, members } : c)),
          }));
        },
      )
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [mentionPicker, chatId, accountId, chat?.members?.length]);
  // メンション候補（@ALL + メンバー名。LINE 準拠で最大20件）
  const mentionOptions = useMemo(() => {
    if (!mentionPicker || chat?.type !== "group") return [];
    const q = mentionPicker.query.toLowerCase();
    const opts: { mid?: string; all?: boolean; name: string }[] = [];
    // @ALL は常に先頭に固定（検索語に関わらず表示）
    opts.push({ all: true, name: "All" });
    for (const m of chat.members ?? []) {
      if (opts.length >= 20) break;
      const n = m.name || m.id;
      if (n.toLowerCase().includes(q)) opts.push({ mid: m.id, name: n });
    }
    return opts;
  }, [mentionPicker, chat]);
  const replyAuthor =
    replyMsg?.authorId === "me"
      ? self.name
      : (chat?.members?.find((m) => m.id === replyMsg?.authorId)?.name ?? "メンバー");

  useEffect(() => {
    if (replyToId) requestAnimationFrame(() => taRef.current?.focus());
  }, [replyToId]);

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setRecSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);

  useEffect(() => {
    if (!recording) return;
    let cancelled = false;
    audioChunksRef.current = [];

    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        streamRef.current = stream;
        const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : MediaRecorder.isTypeSupported("audio/webm")
            ? "audio/webm"
            : "";
        const recorder = mimeType
          ? new MediaRecorder(stream, { mimeType })
          : new MediaRecorder(stream);
        mediaRecorderRef.current = recorder;
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) audioChunksRef.current.push(e.data);
        };
        recorder.start(250);
      } catch {
        setRecording(false);
        setRecSeconds(0);
      }
    })();

    return () => {
      cancelled = true;
      mediaRecorderRef.current?.stop();
      mediaRecorderRef.current = null;
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    };
  }, [recording]);

  function stopRecording(sendIt: boolean) {
    const recorder = mediaRecorderRef.current;
    const seconds = recSeconds;

    const finish = (blob: Blob | null) => {
      if (sendIt && blob && blob.size > 0 && seconds > 0) {
        void sendAudio(chatId, seconds, blob);
      }
      setRecording(false);
      setRecSeconds(0);
      audioChunksRef.current = [];
    };

    if (!recorder || recorder.state === "inactive") {
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
      finish(null);
      return;
    }

    recorder.onstop = () => {
      const blob = new Blob(audioChunksRef.current, {
        type: recorder.mimeType || "audio/webm",
      });
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
      mediaRecorderRef.current = null;
      finish(blob);
    };
    recorder.stop();
  }

  function addPendingFiles(files: File[]) {
    const targets = files.filter(
      (file) => file.type.startsWith("image/") || file.type.startsWith("video/"),
    );
    if (targets.length === 0) return;
    setPendingMedia((prev) => [
      ...prev,
      ...targets.map((file) => ({
        id: `pending_media_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        file,
        url: URL.createObjectURL(file),
        kind: (file.type.startsWith("video/") ? "video" : "image") as "video" | "image",
      })),
    ]);
  }

  function removePendingMedia(id: string) {
    setPendingMedia((prev) => {
      const hit = prev.find((item) => item.id === id);
      if (hit) URL.revokeObjectURL(hit.url);
      return prev.filter((item) => item.id !== id);
    });
  }

  function clearPendingMedia() {
    setPendingMedia((prev) => {
      for (const item of prev) URL.revokeObjectURL(item.url);
      return [];
    });
  }

  async function sendPendingMedia() {
    if (sendingMediaBatch || pendingMedia.length === 0 || !accountId) return;
    setSendingMediaBatch(true);
    try {
      const highQuality = useStore.getState().settings.highQualityImages;
      const selected = [...pendingMedia];
      async function* prepareItems() {
        for (const item of selected) {
          const prepared =
            item.kind === "video"
              ? { blob: item.file, mime: item.file.type || "application/octet-stream" }
              : highQuality
                ? { blob: item.file, mime: item.file.type || "application/octet-stream" }
                : await compressImageFile(item.file);
          if (prepared.blob.size > 11_000_000) {
            throw new Error(
              prepared.blob === item.file
                ? `ファイルが大きすぎます: ${item.file.name}`
                : `画像が大きすぎます（圧縮後も 11MB 超）: ${item.file.name}`,
            );
          }
          const filename =
            item.kind === "image" && prepared.mime === "image/jpeg" && prepared.blob !== item.file
              ? `${(item.file.name || "image").replace(/\.[^.]+$/, "")}.jpg`
              : item.file.name || (item.kind === "video" ? "video.mp4" : "image.jpg");
          yield {
            body: prepared.blob,
            mimeType: prepared.mime,
            filename,
            mediaType: item.kind,
          };
        }
      }
      const res = await api.line.sendMediaBatch(accountId, chatId, prepareItems(), selected.length);
      if (!res.ok) {
        window.alert(res.error ?? "まとめて送信に失敗しました");
        return;
      }
      clearPendingMedia();
      await useStore.getState().refreshMessages(chatId, { force: true });
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    } finally {
      setSendingMediaBatch(false);
    }
  }

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, [draft]);

  function insertAtCursor(chunk: string): number {
    const ta = taRef.current;
    const current = useStore.getState().drafts[chatId] ?? "";
    const start = ta?.selectionStart ?? current.length;
    const end = ta?.selectionEnd ?? current.length;
    const next = current.slice(0, start) + chunk + current.slice(end);
    setDraft(chatId, next);
    requestAnimationFrame(() => {
      if (!ta) return;
      const pos = start + chunk.length;
      ta.focus();
      ta.setSelectionRange(pos, pos);
    });
    return start;
  }

  function insertLineEmoji(packageId: string, sticonId: string) {
    const text = useStore.getState().drafts[chatId] ?? "";
    const start = insertAtCursor(STICON_PLACEHOLDER);
    // 本文のプレースホルダ順 = リソース順。挿入位置より前のプレースホルダ数に合わせてリソースを差し込む
    const before = text.slice(0, start).split(STICON_PLACEHOLDER).length - 1;
    const prev = useStore.getState().draftSticons[chatId] ?? [];
    // 挿入後の本文に合わせて S/E を再計算する（範囲が無いと $ 文字が誤置換される fallback 経路に入るため）
    const next = recomputeSticonRanges(useStore.getState().drafts[chatId] ?? "", [
      ...prev.slice(0, before),
      { productId: packageId, sticonId },
      ...prev.slice(before),
    ]);
    setDraftSticons(chatId, next);
  }

  function send() {
    const state = useStore.getState();
    const text = state.drafts[chatId] ?? draft;
    if (!text.trim() && !text.includes(STICON_PLACEHOLDER)) return;
    const ranged = recomputeSticonRanges(text, state.draftSticons[chatId] ?? []);
    const sticonMeta = buildSticonMetadata(ranged) ?? {};
    const mentionMeta = buildMentionMetadata(state.draftMentions[chatId] ?? []);
    const meta = mentionMeta ? { ...sticonMeta, MENTION: mentionMeta } : sticonMeta;
    void sendMessage(chatId, text, {
      contentMetadata: Object.keys(meta).length ? meta : undefined,
      mute: muteNext || undefined,
    });
    setDraftSticons(chatId, []);
    setDraftMentions(chatId, []);
    setMentionPicker(null);
    setPicker(false);
    requestAnimationFrame(() => taRef.current?.focus());
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const composing = e.nativeEvent.isComposing || e.keyCode === 229;
    if (e.key === "Escape") {
      if (mentionPicker) {
        e.preventDefault();
        setMentionPicker(null);
        return;
      }
      if (replyToId) {
        e.preventDefault();
        setReplyTo(null);
        return;
      }
    }
    if (mentionPicker && mentionOptions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % mentionOptions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + mentionOptions.length) % mentionOptions.length);
        return;
      }
      if (
        (e.key === "Tab" || (e.key === "Enter" && isDesktopInteraction())) &&
        !composing
      ) {
        e.preventDefault();
        insertMention(mentionOptions[mentionIndex % mentionOptions.length]!);
        return;
      }
    }
    // Operation semantics are UA-driven. Layout continues to be width/media-query driven.
    // Mobile (Android/iPhone/iPad): Enter is always a newline.
    // Desktop (Windows/macOS/Linux): Enter sends, Shift+Enter inserts a newline.
    if (e.key === "Enter" && !e.shiftKey && isDesktopInteraction() && !composing) {
      e.preventDefault();
      if (!draft.trim() && pendingMedia.length > 0) {
        void sendPendingMedia();
        return;
      }
      send();
    }
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) {
      addPendingFiles(files);
      e.target.value = "";
    }
  }

  function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    // クリップボードに画像があれば優先して画像として送信する（テキスト貼り付けは従来通り）
    const items = e.clipboardData?.items;
    if (!items || items.length === 0) return;
    const files: File[] = [];
    for (const item of items) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      addPendingFiles(files);
    }
  }

  function onDraftChange(value: string, caret?: number) {
    const state = useStore.getState();
    const oldText = state.drafts[chatId] ?? "";
    setDraft(chatId, value);
    setDraftSticons(chatId, syncSticonsToText(value, state.draftSticons[chatId] ?? []));
    setDraftMentions(
      chatId,
      recomputeMentionsOnEdit(oldText, value, state.draftMentions[chatId] ?? []),
    );
    const trig = chat?.type === "group" ? detectMentionTrigger(value, caret ?? value.length) : null;
    setMentionPicker(trig);
    setMentionIndex(0);
  }

  function insertMention(opt: { mid?: string; all?: boolean; name: string }) {
    const state = useStore.getState();
    const ta = taRef.current;
    const text = state.drafts[chatId] ?? "";
    const start = mentionPicker?.start ?? ta?.selectionStart ?? text.length;
    const end = mentionPicker
      ? start + 1 + mentionPicker.query.length
      : (ta?.selectionStart ?? text.length);
    const label = `@${opt.name}`;
    const next = text.slice(0, start) + label + text.slice(end);
    setDraft(chatId, next);
    setDraftMentions(chatId, [
      ...recomputeMentionsOnEdit(text, next, state.draftMentions[chatId] ?? []),
      { S: start, E: start + label.length, mid: opt.mid, all: opt.all, name: opt.name },
    ]);
    setMentionPicker(null);
    setMentionIndex(0);
    requestAnimationFrame(() => {
      if (!ta) return;
      const pos = start + label.length;
      ta.focus();
      ta.setSelectionRange(pos, pos);
    });
  }

  // 下書き本文にプレースホルダが含まれる限りオーバーレイを有効化（メタデータ欠落時も生の ￼ を出さない）
  const overlaySegments = draft.includes(STICON_PLACEHOLDER)
    ? segmentTextWithSticon(draft, draftSticons)
    : null;

  return (
    <div
      className="relative px-3 pb-3 pt-1 md:px-5 md:pb-5"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        // スタンプ画像等のドロップでブラウザがナビゲート/URL挿入するのを防ぐ
        e.preventDefault();
        if (e.dataTransfer.types.includes("application/x-vyline-sticker")) return;
        const files = Array.from(e.dataTransfer.files ?? []).filter(
          (file) => file.type.startsWith("image/") || file.type.startsWith("video/"),
        );
        if (files.length > 0) {
          addPendingFiles(files);
        }
      }}
    >
      <input
        ref={fileRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        aria-hidden
        onChange={onFileChange}
      />
      {picker && (
        <StickerEmojiPanel
          accountId={accountId}
          onPickSticker={(packageId, stickerId, isPremium) => {
            void sendSticker(chatId, packageId, stickerId, isPremium);
            setPicker(false);
          }}
          onPickEmoji={(packageId, sticonId) => {
            insertLineEmoji(packageId, sticonId);
          }}
          onSendCombinationSticker={async (
            items: Array<{
              packageId: string;
              stickerId: string;
              x?: number;
              y?: number;
              size?: number;
            }>,
          ) => {
            await sendCombinationSticker(chatId, items);
            setPicker(false);
          }}
        />
      )}

      {replyMsg && (
        <div
          className="vy-fade-in mb-2 flex items-stretch gap-2 rounded-xl border border-[var(--vy-border)] bg-[var(--vy-surface)]"
          style={{ borderLeftWidth: 3, borderLeftColor: "var(--vy-accent)" }}
        >
          <button
            type="button"
            onClick={() => scrollToMessage(replyMsg.id)}
            className="min-w-0 flex-1 rounded-l-xl px-3 py-2 text-left transition-colors hover:bg-[var(--vy-surface-2)] focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)] focus-visible:outline-none"
          >
            <p className="text-xs font-semibold" style={{ color: "var(--vy-accent)" }}>
              {replyAuthor} への返信
            </p>
            <p className="truncate text-sm text-[var(--vy-text-dim)]">
              {replyPreviewText(replyMsg)}
            </p>
          </button>
          <button
            type="button"
            onClick={() => setReplyTo(null)}
            aria-label="返信をキャンセル"
            className="flex h-auto w-10 shrink-0 items-center justify-center rounded-r-xl text-[var(--vy-text-dim)] transition-colors hover:bg-[var(--vy-surface-2)] hover:text-[var(--vy-text)]"
          >
            <IconClose size={16} />
          </button>
        </div>
      )}

      {recording ? (
        <div className="vy-fade-in flex items-center gap-3 rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface-2)] px-3 py-2.5">
          <span
            className="flex h-3 w-3 animate-pulse rounded-full"
            style={{ background: "var(--vy-danger)" }}
            aria-hidden
          />
          <span className="text-sm font-medium">録音中</span>
          <span className="font-mono text-sm tabular-nums text-[var(--vy-text-dim)]">
            0:{recSeconds.toString().padStart(2, "0")}
          </span>
          <div className="flex flex-1 items-end gap-0.5" aria-hidden>
            {Array.from({ length: 28 }).map((_, i) => (
              <span
                key={i}
                className="w-1 rounded-full bg-[var(--vy-accent)] opacity-70"
                style={{ height: 6 + Math.abs(Math.sin(i * 0.9 + recSeconds)) * 18 }}
              />
            ))}
          </div>
          <IconButton label="録音をキャンセル" onClick={() => stopRecording(false)}>
            <IconClose size={20} />
          </IconButton>
          <button
            type="button"
            onClick={() => stopRecording(true)}
            aria-label="音声を送信"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[var(--vy-accent-contrast)] transition-transform hover:scale-105 active:scale-95 focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)] focus-visible:outline-none"
            style={{ background: "var(--vy-accent)" }}
          >
            <IconSend size={19} />
          </button>
        </div>
      ) : locked ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface-2)] px-4 py-3 text-sm text-[var(--vy-text-dim)]">
          ロック中のため操作できません
        </div>
      ) : blocked ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface-2)] px-4 py-3 text-sm text-[var(--vy-text-dim)]">
          ブロック中のため送信できません
        </div>
      ) : (
        <>
          {pendingMedia.length > 0 && (
            <div className="vy-fade-in mb-2 rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface)] p-2 shadow-sm">
              <div className="mb-2 flex items-center justify-between gap-2 px-1">
                <div className="text-xs font-medium text-[var(--vy-text-dim)]">
                  {pendingMedia.length} 件のメディアを待機中
                </div>
                <button
                  type="button"
                  onClick={clearPendingMedia}
                  className="text-xs text-[var(--vy-text-dim)] transition-colors hover:text-[var(--vy-text)]"
                >
                  クリア
                </button>
              </div>
              <div className="grid max-h-56 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4 md:grid-cols-5">
                {pendingMedia.map((item) => (
                  <div
                    key={item.id}
                    className="group relative overflow-hidden rounded-xl border border-[var(--vy-border)] bg-[var(--vy-surface-2)]"
                  >
                    {item.kind === "video" ? (
                      <video src={item.url} className="h-24 w-full object-cover" muted />
                    ) : (
                      <img src={item.url} alt="" className="h-24 w-full object-cover" />
                    )}
                    <button
                      type="button"
                      onClick={() => removePendingMedia(item.id)}
                      className="absolute right-1 top-1 rounded-full bg-black/55 p-1 text-white opacity-90 transition hover:bg-black/75"
                      aria-label="添付を削除"
                    >
                      <IconClose size={12} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={clearPendingMedia}
                  className="rounded-full border border-[var(--vy-border)] px-3 py-1 text-xs text-[var(--vy-text-dim)] transition-colors hover:bg-[var(--vy-surface-2)]"
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={() => void sendPendingMedia()}
                  disabled={sendingMediaBatch}
                  className="rounded-full bg-[var(--vy-accent)] px-4 py-1 text-xs font-semibold text-[var(--vy-accent-contrast)] disabled:opacity-60"
                >
                  {sendingMediaBatch ? "送信中…" : "まとめて送信"}
                </button>
              </div>
            </div>
          )}
          {mentionPicker && mentionOptions.length > 0 && (
            <div className="mb-1.5 max-h-52 overflow-y-auto rounded-xl border border-[var(--vy-border)] bg-[var(--vy-surface)] py-1 shadow-lg">
              <p className="px-3 py-1.5 text-[0.65rem] font-medium text-[var(--vy-text-dim)]">
                @でメンション
              </p>
              {mentionOptions.map((o, i) => (
                <button
                  key={o.all ? "@all" : o.mid}
                  type="button"
                  onClick={() => insertMention(o)}
                  onMouseEnter={() => setMentionIndex(i)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors",
                    i === mentionIndex % mentionOptions.length
                      ? "bg-[color-mix(in_oklab,var(--vy-accent)_15%,transparent)]"
                      : "hover:bg-[var(--vy-surface-2)]",
                  )}
                >
                  <span
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[0.6rem] font-bold"
                    style={{
                      background: o.all ? "#f5a623" : "#2aabee",
                      color: "#fff",
                    }}
                    aria-hidden
                  >
                    {o.all ? <IconAtSign size={12} /> : o.name.charAt(0).toUpperCase()}
                  </span>
                  <span className={cn("truncate", o.all && "font-semibold")}>
                    {o.all ? "@All" : o.name}
                  </span>
                </button>
              ))}
            </div>
          )}
          {sendingImage && <FloatNotice>アップロード中…</FloatNotice>}
          <div className="vy-input-row flex items-end gap-1.5 rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface-2)] px-2 py-1">
            <PlusMenu chatId={chatId} />
            <IconButton label="写真を添付" onClick={() => fileRef.current?.click()}>
              <IconPaperclip size={20} />
            </IconButton>
            <IconButton
              label="スタンプ・絵文字"
              active={picker}
              onClick={() => setPicker((p) => !p)}
            >
              <IconSmile size={20} />
            </IconButton>
            <IconButton
              label={
                muteNext
                  ? "ミュートメッセージ: 有効（通知なしで送信）"
                  : "ミュートメッセージ: 無効（クリックで有効化）"
              }
              active={muteNext}
              onClick={() => setMuteNext((m) => !m)}
            >
              <IconBellOff size={19} />
            </IconButton>
            {agentEnabled && draft.trim() && (
              <IconButton
                label="AIで文章を整える"
                active={agentOpen}
                onClick={() => setAgentOpen(true)}
              >
                <IconSpark size={19} />
              </IconButton>
            )}

            <div className="relative flex min-h-9 max-h-40 min-w-0 flex-1 items-center">
              {overlaySegments && (
                <div
                  aria-hidden
                  className="vy-input-text pointer-events-none absolute inset-0 overflow-hidden py-1.5 whitespace-pre-wrap break-words text-[var(--vy-text)]"
                  style={{ transform: `translateY(-${overlayScrollTop}px)` }}
                >
                  {overlaySegments.map((seg, i) =>
                    seg.type === "sticon" ? (
                      <img
                        key={i}
                        src={seg.url}
                        alt=""
                        className="inline-block"
                        style={{ width: `${sticonEm}em`, height: `${sticonEm}em` }}
                        draggable={false}
                      />
                    ) : (
                      <span key={i}>{seg.value.split(STICON_PLACEHOLDER).join("")}</span>
                    ),
                  )}
                </div>
              )}
              <textarea
                ref={taRef}
                rows={1}
                value={draft}
                onChange={(e) =>
                  onDraftChange(e.target.value, e.target.selectionStart ?? undefined)
                }
                onKeyDown={onKeyDown}
                onPaste={onPaste}
                onScroll={(e) => setOverlayScrollTop(e.currentTarget.scrollTop)}
                placeholder={
                  draft
                    ? undefined
                    : muteNext
                      ? "メッセージを入力（ミュート送信: 通知なし）"
                      : "メッセージを入力"
                }
                aria-label="メッセージを入力"
                className={cn(
                  "vy-scroll vy-input-text max-h-40 w-full resize-none bg-transparent py-1.5 leading-relaxed outline-none placeholder:text-[var(--vy-text-dim)]",
                  overlaySegments
                    ? "caret-[var(--vy-text)] text-transparent selection:bg-[color-mix(in_oklab,var(--vy-accent)_35%,transparent)]"
                    : "text-[var(--vy-text)]",
                )}
              />
            </div>

            {draft.trim() || draft.includes(STICON_PLACEHOLDER) ? (
              <button
                type="button"
                onClick={send}
                aria-label={muteNext ? "ミュート送信（通知なし）" : "送信"}
                title={
                  muteNext ? "ミュートメッセージとして送信（相手に通知されません）" : undefined
                }
                className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--vy-accent-contrast)] transition-transform hover:scale-105 active:scale-95 focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)] focus-visible:outline-none"
                style={{
                  background: muteNext
                    ? "color-mix(in oklab, var(--vy-accent) 80%, #6366f1)"
                    : "var(--vy-accent)",
                }}
              >
                <IconSend size={18} />
                {muteNext && (
                  <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-indigo-600 text-[9px] text-white shadow">
                    ✕
                  </span>
                )}
              </button>
            ) : (
              <IconButton label="音声メッセージを録音" onClick={() => setRecording(true)}>
                <IconMic size={20} />
              </IconButton>
            )}
          </div>
        </>
      )}
      {agentOpen && (
        <AgentIActionDialog
          title="AIで文章の構成・表現を整える"
          prompt=""
          sourceText={draft}
          onClose={() => setAgentOpen(false)}
          onApply={(text) => setDraft(chatId, text)}
        />
      )}
      <div className="mt-1 flex flex-wrap items-center gap-2 px-1 text-[0.65rem] text-[var(--vy-text-dim)]">
        {muteNext && (
          <span className="flex items-center gap-1 rounded-md bg-[color-mix(in_oklab,var(--vy-accent)_15%,transparent)] px-1.5 py-0.5 font-medium text-[var(--vy-accent)]">
            <IconBellOff size={12} />
            ミュート送信中（相手にプッシュ通知されません）
          </span>
        )}
        {draftSticons.length > 0 && <span>LINE絵文字 {draftSticons.length} 個を文中に挿入中</span>}
      </div>
    </div>
  );
}

function IconButton({
  children,
  label,
  onClick,
  active,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-[var(--vy-accent)] focus-visible:outline-none",
        active
          ? "text-[var(--vy-accent)]"
          : "text-[var(--vy-text-dim)] hover:bg-[color-mix(in_oklab,var(--vy-text)_10%,transparent)] hover:text-[var(--vy-text)]",
      )}
    >
      {children}
    </button>
  );
}
