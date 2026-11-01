import { expect, test } from "bun:test";
import { createDirectCallSession } from "./sessionFactory.js";

test("createDirectCallSession forwards the requested call type and prepares codecs", async () => {
  const calls: unknown[] = [];
  const route = {
    fromToken: "token",
    callFlowType: 1,
    voipAddress: "127.0.0.1",
    voipUdpPort: 443,
    voipTcpPort: 443,
    fromZone: "",
    toZone: "",
    fakeCall: false,
    ringbackTone: "",
    toMid: "u-peer",
    tunneling: "",
    commParam: "{}",
    stid: "session",
    encFromMid: "",
    encToMid: "",
    switchableToVideo: false,
    voipAddress6: "",
    w2pGw: "",
    drCall: false,
    stnpk: "",
  };
  const session = {} as never;
  const client = {
    base: {
      deviceDetails: {
        device: "DESKTOPWIN",
        appVersion: "test",
        systemName: "Windows",
        systemVersion: "1",
      },
      profile: { mid: "u-self" },
    },
    call: {
      async acquireRoute(input: unknown) {
        calls.push(input);
        return route;
      },
      setCodecFactory() {},
      startSession() {
        return session;
      },
    },
  } as never;
  const result = await createDirectCallSession(client, { to: "u-peer", kind: "VIDEO" });
  expect(calls).toEqual([{ to: "u-peer", callType: "VIDEO", fromEnvInfo: { devname: "Windows" } }]);
  expect(result.session).toBe(session);
  expect(result.transportKind).toBe("andromeda");
});
