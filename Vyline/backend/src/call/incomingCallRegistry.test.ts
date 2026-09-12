import { describe, expect, test } from "bun:test";
import {
  clearIncomingCalls,
  finishIncomingCall,
  normalizeIncomingCall,
  rememberIncomingCall,
  resetIncomingCalls,
} from "./incomingCallRegistry.js";

describe("incoming call operation mapping", () => {
  test("uses param1 as the incoming direct-chat/caller MID", () => {
    expect(
      normalizeIncomingCall({
        param1: "u-caller",
        param2: "u-not-the-caller",
        param3: "VIDEO",
      }),
    ).toEqual({
      callMid: "u-caller",
      chatMid: "u-caller",
      callerMid: "u-caller",
      callType: "video",
      receivedAt: expect.any(Number),
    });
  });

  test("keeps compatibility with operations whose param1 is already a chat MID", () => {
    expect(
      normalizeIncomingCall({
        param1: "u-caller",
        param3: "AUDIO",
      }),
    ).toEqual({
      callMid: "u-caller",
      chatMid: "u-caller",
      callerMid: "u-caller",
      callType: "audio",
      receivedAt: expect.any(Number),
    });
  });

  test("preserves a valid operation createdTime for stale-call filtering", () => {
    const createdTime = Date.now() - 90_001;
    expect(
      normalizeIncomingCall({
        param1: "u-caller",
        param3: "AUDIO",
        createdTime: BigInt(createdTime),
      })?.receivedAt,
    ).toBe(createdTime);
  });

  test("decodes Android/Desktop incoming VoIP route JSON from param3", () => {
    const incoming = normalizeIncomingCall({
      param1: "u-caller",
      param3: JSON.stringify({
        k: "CV",
        h: "203.0.113.10",
        hv6: "2001:db8::10",
        n: "synthetic-token",
        p: 40000,
        vp: 40001,
        vfz: "jpdc",
        vtz: "jpod",
        vc: JSON.stringify({ mpkey: "synthetic-mpkey" }),
        vs: "synthetic-session",
        vt: "udp",
        stnpk: "synthetic-public-key",
        caps: JSON.stringify(["audio", "video"]),
        stv: true,
      }),
    });

    expect(incoming).not.toBeNull();
    expect(incoming?.callType).toBe("video");
    expect(incoming?.communicationId).toBe("synthetic-session");
    expect(incoming?.route).toMatchObject({
      fromToken: "synthetic-token",
      voipAddress: "203.0.113.10",
      voipAddress6: "2001:db8::10",
      voipUdpPort: 40000,
      voipTcpPort: 40001,
      fromZone: "jpdc",
      toZone: "jpod",
      commParam: JSON.stringify({ mpkey: "synthetic-mpkey" }),
      stid: "synthetic-session",
      tunneling: "udp",
      stnpk: "synthetic-public-key",
      capabilities: ["audio", "video"],
      switchableToVideo: true,
    });
  });

  test("does not invent a route when legacy param3 is only a call kind", () => {
    expect(
      normalizeIncomingCall({
        param1: "ccall-legacy",
        param2: "u-caller",
        param3: "VIDEO",
      })?.route,
    ).toBeUndefined();
  });

  test("resolves cancel/end operations by callMid after the incoming event", () => {
    clearIncomingCalls("acct-call-test");
    const incoming = normalizeIncomingCall({
      param1: "ccall-2",
      param2: "u-peer",
      param3: "AUDIO",
    });
    expect(incoming).not.toBeNull();
    rememberIncomingCall("acct-call-test", incoming!);

    expect(finishIncomingCall("acct-call-test", "ccall-2")).toEqual(incoming);
    expect(finishIncomingCall("acct-call-test", "ccall-2")).toBeNull();
  });

  test("falls back to the caller/chat MID when a cancel event carries a different callMid", () => {
    clearIncomingCalls("acct-call-fallback");
    const incoming = normalizeIncomingCall({
      param1: "r-call-token",
      param2: "u-peer",
      param3: "AUDIO",
    });
    expect(incoming).not.toBeNull();
    rememberIncomingCall("acct-call-fallback", incoming!);

    expect(finishIncomingCall("acct-call-fallback", "u-peer", "u-peer")).toEqual(incoming);
    expect(finishIncomingCall("acct-call-fallback", "r-call-token")).toBeNull();
  });

  test("rejects the same or an older revision after the call has ended", () => {
    const accountId = "acct-call-revision-replay";
    const incoming = normalizeIncomingCall({
      param1: "r-call-revision",
      param2: "u-peer",
      param3: "AUDIO",
    })!;
    resetIncomingCalls(accountId);

    expect(rememberIncomingCall(accountId, incoming, 100n)).toBe(true);
    expect(finishIncomingCall(accountId, incoming.callMid)).toEqual(incoming);
    expect(rememberIncomingCall(accountId, incoming, 100n)).toBe(false);
    expect(rememberIncomingCall(accountId, incoming, 99n)).toBe(false);
    expect(finishIncomingCall(accountId, incoming.callMid)).toBeNull();

    resetIncomingCalls(accountId);
  });

  test("allows a newer revision redial and reset forgets the previous identity", () => {
    const accountId = "acct-call-revision-redial";
    const incoming = normalizeIncomingCall({
      param1: "r-call-redial",
      param2: "u-peer",
      param3: "AUDIO",
    })!;
    resetIncomingCalls(accountId);

    expect(rememberIncomingCall(accountId, incoming, 100n)).toBe(true);
    expect(finishIncomingCall(accountId, incoming.callMid)).toEqual(incoming);
    expect(rememberIncomingCall(accountId, incoming, 101n)).toBe(true);
    expect(finishIncomingCall(accountId, incoming.callMid)).toEqual(incoming);

    resetIncomingCalls(accountId);
    expect(rememberIncomingCall(accountId, incoming, 100n)).toBe(true);
    resetIncomingCalls(accountId);
  });
});
