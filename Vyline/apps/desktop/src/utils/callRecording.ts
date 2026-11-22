import type { CallRecording } from "@vyline/types";
import { RecordingRequestError, type recordingClient } from "../api/recordings";
import type { ActiveCall } from "./callAllowlist";

const CHUNK_BYTES = 512 * 1024;
const QUEUE_BYTES = 8 * 1024 ** 2;
const TAIL_RESERVE = 4 * 1024 ** 2;
type RecordingProgress = { state: "recording" | "saving"; startedAt: number; bytes: number };
type RecordingResult = { recording?: CallRecording; error?: string; segmentLimit: boolean };

export function recordingHasOtherParticipant(call: ActiveCall | null, selfMid?: string): boolean {
  if (call?.state !== "in-call" || !call.sessionId) return false;
  if (!call.to.startsWith("c")) return true;
  return (
    /^u[0-9a-f]{32}$/.test(selfMid ?? "") && !!call.participants?.some((p) => p.mid !== selfMid)
  );
}

/** Each blob is discarded after its bounded slices are ACKed. Never builds a whole-call Blob. */
export function recordAndUpload(
  recorder: MediaRecorder,
  row: CallRecording,
  client: Pick<ReturnType<typeof recordingClient>, "append" | "finish">,
  onProgress: (progress: RecordingProgress) => void,
  release: () => void,
) {
  const startedAt = performance.now();
  const controller = new AbortController();
  const queue: Blob[] = [];
  let queuedBytes = 0;
  let receivedBytes = 0;
  let offset = 0;
  let stopped = false;
  let stopping = false;
  let pumping = false;
  let discard = false;
  let error: string | undefined;
  let segmentLimit = false;
  let durationMs = 0;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let resolve!: (result: RecordingResult) => void;
  const finished = new Promise<RecordingResult>((done) => {
    resolve = done;
  });
  const progress = () =>
    onProgress({ state: stopping ? "saving" : "recording", startedAt, bytes: offset });
  async function retry<T>(work: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      controller.signal.throwIfAborted();
      try {
        return await work();
      } catch (failure) {
        if (
          attempt >= 2 ||
          (failure instanceof RecordingRequestError && failure.status === 507) ||
          !(failure instanceof RecordingRequestError) ||
          (failure.status !== 0 && ![408, 429].includes(failure.status) && failure.status < 500)
        )
          throw failure;
        await new Promise((done) => setTimeout(done, (attempt + 1) * 500));
      }
    }
  }
  function stop() {
    if (stopping) return;
    stopping = true;
    durationMs = Math.round(performance.now() - startedAt);
    deadline = setTimeout(() => controller.abort(), 90_000);
    progress();
    if (recorder.state !== "inactive") recorder.stop();
  }
  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      while (queue.length) {
        const data = queue[0]!;
        for (let start = 0; start < data.size; start += CHUNK_BYTES) {
          const slice = data.slice(start, start + CHUNK_BYTES);
          const ack = await retry(() => client.append(row.id, offset, slice, controller.signal));
          if (ack.bytes !== offset + slice.size) throw new Error("記録の保存位置を確認できません");
          offset = ack.bytes;
          progress();
        }
        queue.shift();
        queuedBytes -= data.size;
      }
    } catch (failure) {
      error ??= failure instanceof Error ? failure.message : "記録の保存に失敗しました";
      discard = true;
      queue.length = 0;
      queuedBytes = 0;
      stop();
    } finally {
      pumping = false;
    }
    if (!stopped) return;
    let recording: CallRecording | undefined;
    try {
      recording = await retry(() => client.finish(row.id, durationMs, !!error, controller.signal));
      if (recording.state !== "ready" || recording.error)
        error ??= recording.error ?? "記録が中断されました。設定の通話記録を確認してください";
    } catch {
      error ??= "記録の保存完了を確認できません。設定の通話記録を確認してください";
    }
    clearTimeout(deadline);
    resolve({ recording, error, segmentLimit });
  }
  recorder.addEventListener("dataavailable", (event) => {
    const data = event.data;
    if (discard || !data.size) return;
    if (queuedBytes + data.size > QUEUE_BYTES || receivedBytes + data.size > row.maxBytes) {
      error =
        queuedBytes + data.size > QUEUE_BYTES
          ? "送信待ちの記録が上限を超えたため停止しました"
          : "記録の保存容量に達したため停止しました";
      discard = true;
      stop();
      return;
    }
    queue.push(data);
    queuedBytes += data.size;
    receivedBytes += data.size;
    if (!stopping && receivedBytes >= row.maxBytes - TAIL_RESERVE) {
      segmentLimit = true;
      stop();
    }
    void pump();
  });
  recorder.addEventListener("error", () => {
    error = "ブラウザーで記録が中断されました";
    stop();
  });
  recorder.addEventListener(
    "stop",
    () => {
      stop();
      stopped = true;
      release();
      void pump();
    },
    { once: true },
  );
  try {
    recorder.start(1000);
    progress();
  } catch {
    error = "ブラウザーで記録を開始できませんでした";
    stopping = stopped = true;
    release();
    void pump();
  }
  return { stop, finished };
}
