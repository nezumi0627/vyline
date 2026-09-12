import type { CallRecording, RecordingKind } from "@vyline/types";
import { RecordingRequestError, type recordingClient } from "../api/recordings";
import type { ActiveCall } from "./callAllowlist";

export const RECORDING_CONSENT =
  "相手全員の同意を得てから記録してください。LINE側には録音・録画中の通知が表示されません。記録を有効にしますか？";
const CHUNK_BYTES = 512 * 1024;
const QUEUE_BYTES = 8 * 1024 ** 2;
const TAIL_RESERVE = 4 * 1024 ** 2;
export type RecordingProgress = { state: "recording" | "saving"; startedAt: number; bytes: number };
export type RecordingResult = { recording?: CallRecording; error?: string; segmentLimit: boolean };

export function recordingHasOtherParticipant(call: ActiveCall | null, selfMid?: string): boolean {
  if (call?.state !== "in-call" || !call.sessionId) return false;
  if (!call.to.startsWith("c")) return true;
  return (
    /^u[0-9a-f]{32}$/.test(selfMid ?? "") && !!call.participants?.some((p) => p.mid !== selfMid)
  );
}
export function recordingMime(kind: RecordingKind): string {
  if (typeof MediaRecorder === "undefined")
    throw new Error("このブラウザーは通話記録に対応していません");
  const candidates =
    kind === "audio"
      ? ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]
      : ["video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];
  const mime = candidates.find((item) => MediaRecorder.isTypeSupported(item));
  if (!mime) throw new Error("このブラウザーには対応する記録形式がありません");
  return mime;
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

export type RecordingTile = { name: string; image?: HTMLCanvasElement | HTMLVideoElement | null };
export function recordingStream(
  audio: { stream: MediaStream; release: () => void },
  kind: RecordingKind,
  tiles: () => RecordingTile[],
) {
  if (kind === "audio") return audio;
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context || !canvas.captureStream) {
    audio.release();
    throw new Error("このブラウザーは映像の記録に対応していません");
  }
  const draw = () => {
    context.fillStyle = "#101820";
    context.fillRect(0, 0, 1280, 720);
    const sources = tiles();
    const columns = Math.max(1, Math.ceil(Math.sqrt((sources.length * 16) / 9)));
    const rows = Math.max(1, Math.ceil(sources.length / columns));
    const width = 1280 / columns;
    const height = 720 / rows;
    sources.forEach(({ name, image }, index) => {
      const x = (index % columns) * width;
      const y = Math.floor(index / columns) * height;
      const iw = image instanceof HTMLVideoElement ? image.videoWidth : (image?.width ?? 0);
      const ih = image instanceof HTMLVideoElement ? image.videoHeight : (image?.height ?? 0);
      if (image && iw && ih) {
        const scale = Math.min((width - 8) / iw, (height - 32) / ih);
        try {
          context.drawImage(
            image,
            x + (width - iw * scale) / 2,
            y + (height - 32 - ih * scale) / 2,
            iw * scale,
            ih * scale,
          );
        } catch {
          /* A video may briefly have no frame while switching cameras. */
        }
      }
      context.fillStyle = "#fff";
      context.font = "18px sans-serif";
      context.fillText(name, x + 8, y + height - 10, Math.max(1, width - 16));
    });
  };
  draw();
  const video = canvas.captureStream(15);
  const timer = setInterval(draw, 1000 / 15);
  return {
    stream: new MediaStream([...audio.stream.getAudioTracks(), ...video.getVideoTracks()]),
    release() {
      clearInterval(timer);
      video.getTracks().forEach((track) => track.stop());
      audio.release();
    },
  };
}
