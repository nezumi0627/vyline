export function shouldRestartMicTrack(track: { muted: boolean; readyState: string }): boolean {
  return track.muted || track.readyState !== "live";
}

export function ensureRunningAudioContext<T extends { state: string; resume(): Promise<void> }>(
  current: T | null,
  create: () => T,
): T {
  const context = !current || current.state === "closed" ? create() : current;
  if (context.state !== "running") void context.resume().catch(() => undefined);
  return context;
}

export function splitPcm16Frames(
  input: Int16Array<ArrayBufferLike>,
  remainder: Int16Array<ArrayBufferLike>,
  frameSamples: number,
): { frames: Int16Array<ArrayBuffer>[]; remainder: Int16Array<ArrayBuffer> } {
  if (!Number.isInteger(frameSamples) || frameSamples <= 0) {
    throw new Error("frameSamples must be a positive integer");
  }

  const samples =
    remainder.length === 0
      ? input
      : (() => {
          const merged = new Int16Array(remainder.length + input.length);
          merged.set(remainder);
          merged.set(input, remainder.length);
          return merged;
        })();
  const frames: Int16Array<ArrayBuffer>[] = [];
  let offset = 0;
  while (offset + frameSamples <= samples.length) {
    frames.push(samples.slice(offset, offset + frameSamples));
    offset += frameSamples;
  }
  return { frames, remainder: samples.slice(offset) };
}

/** 1ch 16-bit PCM の線形補間リサンプリング */
export function resampleLinearPcm16(
  samples: Int16Array<ArrayBufferLike>,
  fromRate: number,
  toRate: number,
): Int16Array<ArrayBuffer> {
  if (fromRate === toRate || samples.length === 0) {
    return samples instanceof Int16Array && samples.buffer instanceof ArrayBuffer
      ? (samples as Int16Array<ArrayBuffer>)
      : new Int16Array(samples);
  }
  const ratio = toRate / fromRate;
  const outLength = Math.round(samples.length * ratio);
  const out = new Int16Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const srcIndex = i / ratio;
    const i0 = Math.floor(srcIndex);
    const t = srcIndex - i0;
    const a = samples[i0] ?? 0;
    const b = samples[i0 + 1] ?? a;
    out[i] = Math.round(a + (b - a) * t);
  }
  return out;
}

export interface AudioJitterBufferOptions {
  sampleRate?: number;
  /** プリバッファ目標ミリ秒（デフォルト 80ms） */
  prebufferMs?: number;
  /** 最大許容バッファミリ秒（デフォルト 240ms） */
  maxBufferMs?: number;
}

/** 受信 PCM をシームレスに再生するためのジッターバッファ */
export class AudioJitterBuffer {
  private buffer: Float32Array;
  private head = 0;
  private tail = 0;
  private count = 0;
  private readonly capacity: number;
  private readonly prebufferSamples: number;
  private readonly maxSamples: number;
  private playing = false;
  private lastSample = 0;

  constructor(opts: AudioJitterBufferOptions = {}) {
    const rate = opts.sampleRate ?? 48000;
    const prebufferMs = opts.prebufferMs ?? 80;
    const maxBufferMs = opts.maxBufferMs ?? 240;
    this.prebufferSamples = Math.floor((rate * prebufferMs) / 1000);
    this.maxSamples = Math.floor((rate * maxBufferMs) / 1000);
    this.capacity = this.maxSamples * 2;
    this.buffer = new Float32Array(this.capacity);
  }

  get bufferedSamples(): number {
    return this.count;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  pushPcm16(samples: Int16Array<ArrayBufferLike>): void {
    if (samples.length === 0) return;
    let inputOffset = 0;
    const overflow = Math.max(0, this.count + samples.length - this.maxSamples);
    const bufferedDrop = Math.min(this.count, overflow);
    this.head = (this.head + bufferedDrop) % this.capacity;
    this.count -= bufferedDrop;
    inputOffset = Math.min(samples.length, overflow - bufferedDrop);

    for (let i = inputOffset; i < samples.length; i++) {
      if (this.count >= this.capacity) break;
      const s = samples[i] ?? 0;
      this.buffer[this.tail] = s / 0x8000;
      this.tail = (this.tail + 1) % this.capacity;
      this.count++;
    }

    if (!this.playing && this.count >= this.prebufferSamples) {
      this.playing = true;
    }
  }

  read(output: Float32Array): number {
    if (!this.playing) {
      output.fill(0);
      this.lastSample = 0;
      return 0;
    }

    let written = 0;
    const toRead = output.length;
    while (written < toRead && this.count > 0) {
      const sample = this.buffer[this.head]!;
      output[written++] = sample;
      this.lastSample = sample;
      this.head = (this.head + 1) % this.capacity;
      this.count--;
    }

    if (written < toRead) {
      this.playing = false;
      const fadeLen = Math.min(64, toRead - written);
      for (let i = 0; i < fadeLen; i++) {
        const factor = 1 - (i + 1) / fadeLen;
        output[written + i] = this.lastSample * factor;
      }
      for (let i = written + fadeLen; i < toRead; i++) {
        output[i] = 0;
      }
      this.lastSample = 0;
    }

    return written;
  }

  clear(): void {
    this.head = 0;
    this.tail = 0;
    this.count = 0;
    this.playing = false;
    this.lastSample = 0;
  }
}
