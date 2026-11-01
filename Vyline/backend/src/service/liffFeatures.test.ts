import { expect, spyOn, test } from "bun:test";
import * as clientManager from "../line/clientManager.js";

const MID = "u11111111111111111111111111111111";

function fakeClient(label: string, calls: string[]) {
  return {
    base: { profile: { mid: MID } },
    liff: {
      issueView: async (request: { liffId: string; chatMid?: string }) => {
        calls.push(`${label}:${request.liffId}:${request.chatMid ?? ""}`);
        return { accessToken: `access-${label}`, idToken: `id-${label}` };
      },
    },
  } as never;
}

test("LIFF cache and inflight work are scoped to the VylineClient session", async () => {
  const calls: string[] = [];
  const clients = [
    fakeClient("cache-first", calls),
    fakeClient("cache-second", calls),
    fakeClient("inflight-first", calls),
    fakeClient("inflight-second", calls),
  ];
  const getClient = spyOn(clientManager, "getClient").mockImplementation(() => clients.shift());

  try {
    const liff = await import(`./liffFeatures.ts?session-cache=${crypto.randomUUID()}`);

    await liff.liffWarm("main", "poll", "c-shared-cache");
    await liff.liffWarm("main", "poll", "c-shared-cache");
    await Promise.all([
      liff.liffWarm("main", "schedule", "c-shared-inflight"),
      liff.liffWarm("main", "schedule", "c-shared-inflight"),
    ]);

    expect(calls.map((entry) => entry.split(":", 1)[0])).toEqual([
      "cache-first",
      "cache-second",
      "inflight-first",
      "inflight-second",
    ]);
  } finally {
    getClient.mockRestore();
  }
});

test("sticker LIFF credentials are scoped to the VylineClient session", async () => {
  const calls: string[] = [];
  const clients = [fakeClient("sticker-first", calls), fakeClient("sticker-second", calls)];
  const getClient = spyOn(clientManager, "getClient").mockImplementation(() => clients.shift());
  const authorizations: Array<string | null> = [];
  const fetch = spyOn(globalThis, "fetch").mockImplementation((async (_input, init) => {
    authorizations.push(new Headers(init?.headers).get("authorization"));
    return new Response("[]", { status: 200 });
  }) as typeof globalThis.fetch);

  try {
    const liff = await import(`./liffFeatures.ts?sticker-session=${crypto.randomUUID()}`);

    await liff.checkStickerGiftEligibility("main");
    await liff.checkStickerGiftEligibility("main");

    expect(calls.map((entry) => entry.split(":", 1)[0])).toEqual([
      "sticker-first",
      "sticker-second",
    ]);
    expect(authorizations).toEqual(["Bearer access-sticker-first", "Bearer access-sticker-second"]);
  } finally {
    fetch.mockRestore();
    getClient.mockRestore();
  }
});
