/**
 * hooks/useMessageActions.ts
 *
 * メッセージ送信・送信取り消し・下書き。
 */

import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client.js";
import type { Message } from "../types/index.js";
import { useDraftStore } from "../stores/draftStore.js";

interface UseMessageActionsOptions {
  accountId: string | null;
  selectedChatMid: string;
  reloadMessages: (chatMid: string) => Promise<void>;
}

export function useMessageActions({
  accountId,
  selectedChatMid,
  reloadMessages,
}: UseMessageActionsOptions) {
  const getDraft = useDraftStore((s) => s.getDraft);
  const setDraft = useDraftStore((s) => s.setDraft);
  const clearDraft = useDraftStore((s) => s.clearDraft);

  const [messageText, setMessageTextState] = useState("");
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // チャット切替で下書きを復元
  useEffect(() => {
    setReplyTo(null);
    setSendError(null);
    setMessageTextState(getDraft(selectedChatMid));
  }, [selectedChatMid, getDraft]);

  const setMessageText = useCallback(
    (text: string) => {
      setMessageTextState(text);
      if (selectedChatMid) setDraft(selectedChatMid, text);
    },
    [selectedChatMid, setDraft],
  );

  const send = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!accountId || !selectedChatMid || !messageText.trim()) return;

      const text = messageText.trim();
      const relatedMessageId = replyTo?.id;

      setMessageTextState("");
      clearDraft(selectedChatMid);
      setSendError(null);
      setSending(true);

      try {
        const res = await api.line.send(accountId, selectedChatMid, text, {
          relatedMessageId,
        });
        if (res.ok) {
          setReplyTo(null);
          await reloadMessages(selectedChatMid);
        } else {
          setSendError(res.error ?? "送信に失敗しました");
          setMessageTextState(text);
          setDraft(selectedChatMid, text);
        }
      } finally {
        setSending(false);
      }
    },
    [accountId, selectedChatMid, messageText, replyTo, reloadMessages, clearDraft, setDraft],
  );

  const unsend = useCallback(
    async (message: Message) => {
      if (!accountId) return;
      const ok = window.confirm("このメッセージを送信取り消ししますか？");
      if (!ok) return;

      const res = await api.line.unsend(accountId, message.id);
      if (!res.ok) {
        window.alert(`送信取り消しエラー\n${res.error ?? "unknown"}`);
        return;
      }
      if (selectedChatMid) await reloadMessages(selectedChatMid);
    },
    [accountId, selectedChatMid, reloadMessages],
  );

  const sendFile = useCallback(
    async (file: File) => {
      if (!accountId || !selectedChatMid || sending) return;
      setSendError(null);
      setSending(true);
      try {
        const res = await api.line.sendMedia(accountId, selectedChatMid, file, {
          mimeType: file.type || "application/octet-stream",
          filename: file.name || "file",
        });
        if (res.ok) {
          await reloadMessages(selectedChatMid);
        } else {
          setSendError(res.error ?? "画像送信に失敗しました");
        }
      } catch (err) {
        setSendError(err instanceof Error ? err.message : String(err));
      } finally {
        setSending(false);
      }
    },
    [accountId, selectedChatMid, sending, reloadMessages],
  );

  return {
    messageText,
    setMessageText,
    replyTo,
    setReplyTo,
    sending,
    sendError,
    send,
    sendFile,
    unsend,
  };
}
