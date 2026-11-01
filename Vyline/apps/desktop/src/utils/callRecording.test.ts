import { expect, test } from "bun:test";
import type { CallRecording } from "@vyline/types";
import { RecordingRequestError } from "../api/recordings";
import { recordAndUpload, recordingHasOtherParticipant } from "./callRecording";

class Recorder extends EventTarget {
  state = "inactive";
  start() {
    this.state = "recording";
  }
  emit(data: Blob) {
    this.dispatchEvent(Object.assign(new Event("dataavailable"), { data }));
  }
  stop() {
    this.state = "inactive";
    queueMicrotask(() => {
      this.emit(new Blob(["tail"]));
      this.dispatchEvent(new Event("stop"));
    });
  }
}
const row = { id: "fixture", maxBytes: 16 * 1024 ** 2 } as CallRecording;
test("recording writes bounded ordered chunks, flushes the stop event and releases capture before upload completes", async () => {
  const recorder = new Recorder();
  const stored: number[] = [];
  let released = false;
  let unpause!: () => void;
  const pause = new Promise<void>((resolve) => {
    unpause = resolve;
  });
  const upload = recordAndUpload(
    recorder as unknown as MediaRecorder,
    row,
    {
      async append(_id, offset, data) {
        await pause;
        expect(data.size).toBeLessThanOrEqual(512 * 1024);
        expect(offset).toBe(stored.length);
        for (const byte of new Uint8Array(await data.arrayBuffer())) stored.push(byte);
        return { ...row, bytes: stored.length };
      },
      async finish(_id, _duration, interrupted) {
        expect(interrupted).toBe(false);
        return { ...row, bytes: stored.length, state: "ready" };
      },
    },
    () => {},
    () => {
      released = true;
    },
  );
  recorder.emit(new Blob([new Uint8Array(600_000).fill(7)]));
  upload.stop();
  await Promise.resolve();
  expect(released).toBe(true);
  unpause();
  const result = await upload.finished;
  expect(result.recording?.bytes).toBe(600_004);
  expect(new TextDecoder().decode(new Uint8Array(stored.slice(-4)))).toBe("tail");
  expect(result.error).toBeUndefined();
});
test("overflow stops capture, keeps only the accepted prefix and marks it interrupted", async () => {
  const recorder = new Recorder();
  let bytes = 0;
  const upload = recordAndUpload(
    recorder as unknown as MediaRecorder,
    row,
    {
      async append(_id, _offset, data) {
        bytes += data.size;
        return { ...row, bytes };
      },
      async finish(_id, _duration, interrupted) {
        expect(interrupted).toBe(true);
        return { ...row, bytes, state: "interrupted" };
      },
    },
    () => {},
    () => {},
  );
  recorder.emit(new Blob(["head"]));
  await Promise.resolve();
  recorder.emit(new Blob([new Uint8Array(8 * 1024 ** 2 + 1)]));
  const result = await upload.finished;
  expect(bytes).toBe(4);
  expect(result.error).toContain("送信待ち");
});
test("automatic group recording waits for a valid self identity and another participant", () => {
  const self = `u${"1".repeat(32)}`;
  const other = `u${"2".repeat(32)}`;
  const call = {
    sessionId: "test",
    state: "in-call",
    kind: "voice",
    to: `c${"3".repeat(32)}`,
  } as const;
  expect(recordingHasOtherParticipant(call, self)).toBe(false);
  expect(
    recordingHasOtherParticipant(
      { ...call, participants: [{ mid: self, hasAudioStream: true, hasVideoStream: false }] },
      self,
    ),
  ).toBe(false);
  const active = {
    ...call,
    participants: [{ mid: other, hasAudioStream: true, hasVideoStream: false }],
  };
  expect(recordingHasOtherParticipant(active, undefined)).toBe(false);
  expect(recordingHasOtherParticipant(active, self)).toBe(true);
  expect(recordingHasOtherParticipant({ ...active, state: "ended" }, self)).toBe(false);
  expect(recordingHasOtherParticipant({ ...call, to: other }, self)).toBe(true);
});

test("partly ACKed blobs are not double-counted against file capacity when the final blob arrives", async () => {
  class DelayedStopRecorder extends Recorder {
    stop() {
      this.state = "inactive";
    }
  }
  const recorder = new DelayedStopRecorder();
  const MiB = 1024 ** 2;
  let bytes = 0;
  let unblock!: () => void;
  let firstDone!: () => void;
  let halfway!: () => void;
  const first = new Promise<void>((resolve) => {
    firstDone = resolve;
  });
  const middle = new Promise<void>((resolve) => {
    halfway = resolve;
  });
  const wait = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  const upload = recordAndUpload(
    recorder as unknown as MediaRecorder,
    row,
    {
      async append(_id, offset, data) {
        if (offset === 11 * MiB) {
          halfway();
          await wait;
        }
        bytes = offset + data.size;
        if (bytes === 7 * MiB) firstDone();
        return { ...row, bytes };
      },
      async finish(_id, _duration, interrupted) {
        return { ...row, bytes, state: interrupted ? "interrupted" : "ready" };
      },
    },
    () => {},
    () => {},
  );
  recorder.emit(new Blob([new Uint8Array(7 * MiB)]));
  await first;
  await Promise.resolve();
  await Promise.resolve();
  recorder.emit(new Blob([new Uint8Array(6 * MiB)]));
  await middle;
  recorder.emit(new Blob([new Uint8Array(2 * MiB)]));
  recorder.dispatchEvent(new Event("stop"));
  unblock();
  const result = await upload.finished;
  expect(result.error).toBeUndefined();
  expect(result.recording?.bytes).toBe(15 * MiB);
});
test("server-side interrupted completion is not presented as a successful recording", async () => {
  const recorder = new Recorder();
  const upload = recordAndUpload(
    recorder as unknown as MediaRecorder,
    row,
    {
      async append(_id, _offset, data) {
        return { ...row, bytes: data.size };
      },
      async finish() {
        return { ...row, state: "interrupted", error: "保存済みデータの一部が欠けています" };
      },
    },
    () => {},
    () => {},
  );
  upload.stop();
  expect((await upload.finished).error).toBe("保存済みデータの一部が欠けています");
});

test("temporary upload errors have three attempts; quota and conflicting offsets do not retry", async () => {
  for (const status of [429, 507, 409]) {
    const recorder = new Recorder();
    let attempts = 0;
    const upload = recordAndUpload(
      recorder as unknown as MediaRecorder,
      row,
      {
        async append() {
          attempts++;
          throw new RecordingRequestError("fixture upload failure", status);
        },
        async finish() {
          return { ...row, state: "interrupted" };
        },
      },
      () => {},
      () => {},
    );
    recorder.emit(new Blob(["head"]));
    const result = await upload.finished;
    expect(result.error).toBe("fixture upload failure");
    expect(attempts).toBe(status === 429 ? 3 : 1);
  }
});
