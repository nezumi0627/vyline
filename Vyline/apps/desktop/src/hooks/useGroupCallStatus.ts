import { useEffect, useState } from "react";
import { api } from "@/api/client";
import { readActiveGroupCall } from "@/utils/callAllowlist";
import { startSerialPoll } from "@/lib/serialPoll";

/** One status lookup per open group, shared by its banner and history notices. */
export function useGroupCallStatus(
  accountId: string | null,
  chatId: string | undefined,
  eventId?: string,
) {
  const key = `${accountId}:${chatId}:${eventId}`;
  const [state, setState] = useState<{
    key: string;
    call: ReturnType<typeof readActiveGroupCall>;
  } | null>(null);
  useEffect(() => {
    if (!accountId || !chatId || !/^c[0-9a-f]{32}$/.test(chatId)) return;
    let disposed = false;
    const update = (call: ReturnType<typeof readActiveGroupCall>) => {
      if (disposed) return;
      setState((previous) =>
        previous?.key === key &&
        previous.call?.kind === call?.kind &&
        previous.call?.memberCount === call?.memberCount
          ? previous
          : { key, call },
      );
    };
    const refresh = async () => {
      try {
        const response = await api.line.groupCallStatus(accountId, chatId);
        update(readActiveGroupCall(response, chatId));
      } catch {
        update(null);
      }
      return undefined;
    };
    // The backend badge cache lasts 20 seconds. Join itself always uses a fresh lookup.
    const stop = startSerialPoll(refresh, { intervalMs: 25_000, pauseWhenHidden: true });
    return () => {
      disposed = true;
      stop();
    };
  }, [accountId, chatId, key]);
  return state?.key === key ? state.call : null;
}
