import { expect, test } from "bun:test";
import { canStartCall, readCallParticipants, readActiveGroupCall } from "./callAllowlist";

test("group voice and video entries accept only real group IDs", () => {
  expect(canStartCall(`c${"1".repeat(32)}`, "voice")).toBe(true);
  expect(canStartCall(`c${"1".repeat(32)}`, "video")).toBe(true);
  expect(canStartCall("c-invalid", "voice")).toBe(false);
  expect(canStartCall("c-invalid", "video")).toBe(false);
  expect(canStartCall(`r${"1".repeat(32)}`, "video")).toBe(false);
  expect(canStartCall(`u${"1".repeat(32)}`, "video")).toBe(true);
});

test("group-call badges accept only active status for the requested room", () => {
  const chatMid = `c${"1".repeat(32)}`;
  const member = `u${"2".repeat(32)}`;
  const status = { ok: true, online: true, chatMid, mediaType: "VIDEO", memberMids: [member] };
  expect(readActiveGroupCall(status, chatMid)).toEqual({ memberCount: 1, kind: "video" });
  expect(readActiveGroupCall({ ...status, mediaType: "AUDIO" }, chatMid)?.kind).toBe("voice");
  expect(readActiveGroupCall({ ...status, mediaType: "2" }, chatMid)?.kind).toBe("video");
  expect(readActiveGroupCall({ ...status, mediaType: "1" }, chatMid)?.kind).toBe("voice");
  for (const invalid of [
    null,
    {},
    { ...status, ok: false },
    { ...status, online: false },
    { ...status, chatMid: `c${"3".repeat(32)}` },
    { ...status, memberMids: [member, member] },
    { ...status, memberMids: ["bad"] },
    { ...status, memberMids: new Array(513).fill(member) },
    { ...status, mediaType: "LIVE" },
  ]) {
    expect(readActiveGroupCall(invalid, chatMid)).toBeNull();
  }
});

test("call participant updates accept bounded valid rosters and explicit empty updates", () => {
  const participant = { mid: `u${"1".repeat(32)}`, hasAudioStream: true, hasVideoStream: false };
  expect(readCallParticipants([participant])).toEqual([participant]);
  expect(readCallParticipants([])).toEqual([]);
  for (const invalid of [
    undefined,
    {},
    [participant, participant],
    [{ ...participant, mid: "u-bad" }],
    [{ ...participant, hasVideoStream: "yes" }],
    new Array(513).fill(participant),
  ]) {
    expect(readCallParticipants(invalid)).toBeUndefined();
  }
});
