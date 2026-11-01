import { describe, expect, test } from "bun:test";
import {
  AudioJitterBuffer,
  ensureRunningAudioContext,
  shouldRestartMicTrack,
  splitPcm16Frames,
  resampleLinearPcm16,
} from "./callAudio";

describe("call microphone framing", () => {
  test("preserves ScriptProcessor leftovers across 20 ms Opus frames", () => {
    const firstInput = Int16Array.from({ length: 4096 }, (_, index) => index);
    const first = splitPcm16Frames(firstInput, new Int16Array(0), 960);

    expect(first.frames).toHaveLength(4);
    expect(first.frames.every((frame) => frame.length === 960)).toBe(true);
    expect(first.frames[3]?.[959]).toBe(3839);
    expect(Array.from(first.remainder)).toEqual(Array.from({ length: 256 }, (_, i) => 3840 + i));

    const secondInput = Int16Array.from({ length: 4096 }, (_, index) => 4096 + index);
    const second = splitPcm16Frames(secondInput, first.remainder, 960);

    expect(second.frames).toHaveLength(4);
    expect(second.frames[0]?.[0]).toBe(3840);
    expect(second.frames[0]?.[255]).toBe(4095);
    expect(second.frames[0]?.[256]).toBe(4096);
    expect(second.frames[3]?.[959]).toBe(7679);
    expect(Array.from(second.remainder)).toEqual(Array.from({ length: 512 }, (_, i) => 7680 + i));
  });

  test("restarts a muted or ended microphone track, but not a healthy live track", () => {
    expect(shouldRestartMicTrack({ muted: false, readyState: "live" })).toBe(false);
    expect(shouldRestartMicTrack({ muted: true, readyState: "live" })).toBe(true);
    expect(shouldRestartMicTrack({ muted: false, readyState: "ended" })).toBe(true);
  });

  test("resamples 16-bit PCM linearly between rates", () => {
    const input = new Int16Array([0, 1000, 2000, 3000]);
    // 44.1k -> 48k: ratio ~ 1.088
    const resampled = resampleLinearPcm16(input, 44100, 48000);
    expect(resampled.length).toBe(4);
    expect(resampled[0]).toBe(0);

    // 2:1 upsampling
    const up = resampleLinearPcm16(new Int16Array([0, 1000]), 1000, 2000);
    expect(up.length).toBe(4);
    expect(up[0]).toBe(0);
    expect(up[1]).toBe(500);
    expect(up[2]).toBe(1000);

    // Identity
    const same = resampleLinearPcm16(input, 48000, 48000);
    expect(same).toBe(input);
  });

  test("AudioJitterBuffer prebuffers, streams continuously, and handles underrun with fade", () => {
    // rate=1000, prebuffer=50ms (50 samples), max=200ms (200 samples)
    const jb = new AudioJitterBuffer({ sampleRate: 1000, prebufferMs: 50, maxBufferMs: 200 });

    const out = new Float32Array(20);

    // 1. 蓄積が prebuffer (50) 未満のときは read は 0 を返す（無音）
    jb.pushPcm16(new Int16Array(30).fill(16384));
    expect(jb.isPlaying).toBe(false);
    const read1 = jb.read(out);
    expect(read1).toBe(0);
    expect(out[0]).toBe(0);

    // 2. prebuffer (計 60 samples >= 50) に達したら playing 開始
    jb.pushPcm16(new Int16Array(30).fill(16384));
    expect(jb.isPlaying).toBe(true);

    // 3. 20 samples 読み出し (16384 / 32768 = 0.5)
    const read2 = jb.read(out);
    expect(read2).toBe(20);
    expect(out[0]).toBeCloseTo(0.5, 4);
    expect(out[19]).toBeCloseTo(0.5, 4);
    expect(jb.bufferedSamples).toBe(40);

    // 4. 残り 40 samples を 20 samples ずつ読む
    jb.read(out);
    expect(jb.bufferedSamples).toBe(20);
    jb.read(out);
    expect(jb.bufferedSamples).toBe(0);

    // 5. 次の読み出しでアンダーラン発生:
    // 直前のサンプル (0.5) からフェードアウトし、playing = false になる
    const readUnder = jb.read(out);
    expect(readUnder).toBe(0); // 0個しか本データなし
    expect(jb.isPlaying).toBe(false);
    expect(out[0]).toBeLessThan(0.5); // フェードアウト開始
    expect(out[19]).toBe(0);
  });

  test("AudioJitterBuffer drops only samples beyond its maximum", () => {
    const jb = new AudioJitterBuffer({ sampleRate: 1000, prebufferMs: 50, maxBufferMs: 200 });
    jb.pushPcm16(new Int16Array(190).fill(100));
    jb.pushPcm16(new Int16Array(30).fill(200));

    expect(jb.bufferedSamples).toBe(200);
  });

  test("audio context is created or resumed while handling a user gesture", () => {
    let resumes = 0;
    const suspended = {
      state: "suspended",
      resume: async () => {
        resumes++;
      },
    };
    expect(ensureRunningAudioContext(suspended, () => suspended)).toBe(suspended);
    expect(resumes).toBe(1);

    const running = { state: "running", resume: async () => undefined };
    let creates = 0;
    expect(
      ensureRunningAudioContext(null, () => {
        creates++;
        return running;
      }),
    ).toBe(running);
    expect(creates).toBe(1);
  });
});
