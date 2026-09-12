import type { CallRecording, RecordingKind } from "@vyline/types";
import type { CallSessionSnapshot } from "../call/callManager.js";
import {
  getCallRecordingStore,
  RecordingError,
  RECORDING_IDLE_MS,
  RECORDING_MAX_BYTES,
} from "../storage/callRecordingStore.js";
import { getRecordingSettings } from "../storage/recordingSettings.js";
import { deleteWebDavRecording, uploadWebDavRecording } from "../storage/recordingWebDav.js";

let initialization: Promise<void> | undefined;
const ownerLocks = new Map<string, Promise<void>>();
async function withOwnerLock<T>(owner: string, work: () => Promise<T>): Promise<T> {
  const previous = ownerLocks.get(owner) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  ownerLocks.set(owner, current);
  await previous;
  try {
    return await work();
  } finally {
    release();
    if (ownerLocks.get(owner) === current) ownerLocks.delete(owner);
  }
}
export function initializeCallRecordings() {
  return (initialization ??= getCallRecordingStore().recover());
}
type StartInput = {
  sessionId: string;
  title: string;
  kind: RecordingKind;
  mimeType: string;
  consentAccepted: boolean;
};
async function getCallSnapshot(id: string) {
  return (await import("../call/callManager.js")).getCallSnapshot(id);
}
export async function startCallRecording(
  owner: string,
  input: StartInput,
  lookup: (
    id: string,
  ) => CallSessionSnapshot | null | Promise<CallSessionSnapshot | null> = getCallSnapshot,
) {
  await initializeCallRecordings();
  if (!input || typeof input.sessionId !== "string" || input.consentAccepted !== true)
    throw new RecordingError("記録する相手の同意について確認してください");
  return withOwnerLock(owner, async () => {
    const call = await lookup(input.sessionId);
    if (!call || call.accountId !== owner || call.state !== "in-call")
      throw new RecordingError("接続中の通話が見つかりません", 409);
    const preferences = getRecordingSettings().get(owner);
    const target = preferences.targetId
      ? getRecordingSettings().target(owner, preferences.targetId)
      : null;
    const directory =
      target?.kind === "local"
        ? await getRecordingSettings().localDirectory(owner, target.id)
        : undefined;
    const maxBytes = RECORDING_MAX_BYTES;
    const current = await lookup(input.sessionId);
    if (!current || current.accountId !== owner || current.state !== "in-call")
      throw new RecordingError("通話は既に終了しています", 409);
    return getCallRecordingStore().create(
      owner,
      { ...input, chatMid: call.to, retentionDays: preferences.retentionDays },
      maxBytes,
      target ? { id: target.id, ...(directory ? { directory } : {}) } : undefined,
    );
  });
}
export async function appendCallRecording(
  owner: string,
  id: string,
  offset: number,
  bytes: Uint8Array,
) {
  await initializeCallRecordings();
  const row = getCallRecordingStore().get(owner, id);
  const call = await getCallSnapshot(row.sessionId);
  return getCallRecordingStore().append(
    owner,
    id,
    offset,
    bytes,
    call?.accountId === owner && call.state === "in-call",
  );
}
let transferring = false;
export function requestCallRecordingTransfer(owner: string, id: string) {
  const row = getCallRecordingStore().get(owner, id);
  if (!row.transfer || row.transfer === "complete" || row.state === "recording" || !row.bytes)
    throw new RecordingError("再送できる記録がありません", 409);
  if (transferring)
    throw new RecordingError("別の記録を転送中です。しばらくしてから再試行してください", 429);
  void retryCallRecordingTransfer(owner, id).catch(() => {});
  return { ...row, transfer: "pending" as const };
}
export async function retryCallRecordingTransfer(owner: string, id: string) {
  if (transferring)
    throw new RecordingError("別の記録を転送中です。しばらくしてから再試行してください", 429);
  transferring = true;
  try {
    return await getCallRecordingStore().transfer(owner, id, async (path, row) => {
      const connection = await getRecordingSettings().connection(owner, row.targetId!);
      await uploadWebDavRecording(
        connection,
        owner,
        id,
        row.mimeType.includes("mp4") ? "mp4" : "webm",
        path,
        row.bytes,
      );
    });
  } finally {
    transferring = false;
  }
}
export async function finishCallRecording(
  owner: string,
  id: string,
  durationMs: number,
  interrupted = false,
) {
  const row = await getCallRecordingStore().finish(owner, id, durationMs, interrupted);
  if (row.transfer === "pending" && row.bytes)
    void retryCallRecordingTransfer(owner, id).catch(() => {});
  return row;
}
export async function removeCallRecording(owner: string, id: string) {
  return getCallRecordingStore().remove(owner, id, async (row) => {
    await deleteWebDavRecording(
      await getRecordingSettings().connection(owner, row.targetId!),
      owner,
      id,
      row.mimeType.includes("mp4") ? "mp4" : "webm",
    );
  });
}
let maintenanceRunning = false;
export async function maintainCallRecordings() {
  if (maintenanceRunning) return;
  maintenanceRunning = true;
  try {
    await initializeCallRecordings();
    const store = getCallRecordingStore();
    await store.recover(Date.now() - RECORDING_IDLE_MS);
    const expired = store.db
      .query(
        "SELECT owner, id FROM recordings WHERE state != 'recording' AND json_extract(data, '$.expiresAt') <= ? LIMIT 50",
      )
      .all(Date.now()) as { owner: string; id: string }[];
    for (const row of expired) await removeCallRecording(row.owner, row.id).catch(() => {});
    const pending = store.db
      .query(
        "SELECT owner, id FROM recordings WHERE state != 'recording' AND json_extract(data, '$.bytes') > 0 AND json_extract(data, '$.transfer') = 'pending' LIMIT 1",
      )
      .get() as { owner: string; id: string } | null;
    if (pending) await retryCallRecordingTransfer(pending.owner, pending.id).catch(() => {});
  } finally {
    maintenanceRunning = false;
  }
}
export type { CallRecording };
