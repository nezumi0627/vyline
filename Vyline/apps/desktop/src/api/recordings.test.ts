import { expect, test } from "bun:test";
import { recordingClient } from "./recordings";

test("recording requests keep proxy cookies while binding the original owner and installation", async () => {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const previousFetch = globalThis.fetch;
  const installationA = "11111111-1111-4111-8111-111111111111";
  const installationB = "22222222-2222-4222-8222-222222222222";
  const data = new Map<string, string>([
    ["vyline:subdevice-session", "synthetic-owner-a"],
    ["vyline:subdevice-installation-id", installationA],
  ]);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
    },
  });
  const requests: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init: init! });
    return Response.json({ ok: true, items: [], nextCursor: null, recording: { bytes: 3 } });
  }) as typeof fetch;
  try {
    const client = recordingClient("owner-a");
    data.set("vyline:subdevice-session", "synthetic-owner-b");
    data.set("vyline:subdevice-installation-id", installationB);
    await client.list();
    await client.append("id", 0, new Blob(["abc"]));
    expect(requests[0]!.url).toBe("/api/line/owner-a/recordings");
    expect(requests[1]!.url).toBe("/api/line/owner-a/recordings/id/chunks");
    for (const request of requests) {
      expect(new Headers(request.init.headers).get("authorization")).toBe(
        "Bearer synthetic-owner-a",
      );
      expect(new Headers(request.init.headers).get("x-vyline-installation-id")).toBe(installationA);
      expect(request.init.credentials).toBe("same-origin");
    }
    data.delete("vyline:subdevice-session");
    const signedOut = recordingClient("owner-a");
    data.set("vyline:subdevice-session", "synthetic-owner-b");
    await signedOut.list();
    expect(new Headers(requests[2]!.init.headers).get("authorization")).toBeNull();
    expect(new Headers(requests[2]!.init.headers).get("x-vyline-installation-id")).toBe(
      installationB,
    );
    expect(requests[2]!.init.credentials).toBe("same-origin");

    Reflect.deleteProperty(globalThis, "localStorage");
    const withoutInstallation = recordingClient("owner-a");
    await withoutInstallation.list();
    expect(new Headers(requests[3]!.init.headers).get("authorization")).toBeNull();
    expect(new Headers(requests[3]!.init.headers).get("x-vyline-installation-id")).toBeNull();
    expect(requests[3]!.init.credentials).toBe("same-origin");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
