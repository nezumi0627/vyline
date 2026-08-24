import { Hono } from "hono";
import { networkInterfaces } from "node:os";
import {
  authenticateSubdevice,
  completePairing,
  createPairing,
  getPairing,
  listSubdevices,
  removeSubdevice,
  setSubdeviceBlocked,
  type Subdevice,
} from "../storage/subdeviceStore.js";

export const subdeviceRouter = new Hono();

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function isLanAccessEnabled() {
  return process.env.VYLINE_LAN_ACCESS === "true";
}

function getLanHost(): string | null {
  const configured = process.env.VYLINE_PUBLIC_HOST?.trim();
  if (configured) return configured;

  for (const addresses of Object.values(networkInterfaces())) {
    const address = addresses?.find((entry) => entry.family === "IPv4" && !entry.internal);
    if (address?.address) return address.address;
  }
  return null;
}

/** localhost で開いたPC画面からでも、LAN上で開けるQR URLを作る。 */
export function buildPairingUrl(origin: string | undefined, token: string): string | undefined {
  if (!origin) return undefined;

  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (LOOPBACK_HOSTS.has(url.hostname)) {
      // Vite/backend が loopback 待受のままでは、LAN IP の QR を発行しても
      // スマホからページ/APIへ到達できない。壊れたQRを返さずUI側で案内する。
      if (!isLanAccessEnabled()) return undefined;
      const lanHost = getLanHost();
      if (!lanHost) return undefined;
      url.hostname = lanHost;
    }
    url.pathname = "/subdevice";
    url.search = `?pairing=${encodeURIComponent(token)}`;
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

function bearer(c: { req: { header(name: string): string | undefined } }) {
  const value = c.req.header("authorization") ?? "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

subdeviceRouter.post("/pairing", async (c) => {
  const body = await c.req
    .json<{ accountId?: string; origin?: string }>()
    .catch((): { accountId?: string; origin?: string } => ({}));
  if (!body.accountId) return c.json({ ok: false, error: "accountId required" }, 400);
  const pairing = await createPairing(body.accountId);
  const pairingUrl = buildPairingUrl(body.origin, pairing.token);
  return c.json({
    ok: true,
    ...pairing,
    pairingUrl,
    lanAccessRequired:
      Boolean(body.origin) &&
      (() => {
        try {
          return LOOPBACK_HOSTS.has(new URL(body.origin!).hostname) && !isLanAccessEnabled();
        } catch {
          return false;
        }
      })(),
  });
});

subdeviceRouter.get("/pairing/:token", async (c) => {
  const pairing = await getPairing(c.req.param("token"));
  return pairing
    ? c.json({ ok: true, expiresAt: pairing.expiresAt })
    : c.json({ ok: false, error: "pairing expired" }, 410);
});

subdeviceRouter.post("/pairing/:token/complete", async (c) => {
  const body = await c.req
    .json<{ name?: string; platform?: Subdevice["platform"] }>()
    .catch((): { name?: string; platform?: Subdevice["platform"] } => ({}));
  const platform = ["ios", "android", "web", "unknown"].includes(body.platform ?? "")
    ? body.platform!
    : "unknown";
  const result = await completePairing(c.req.param("token"), body.name ?? "", platform);
  return result
    ? c.json({ ok: true, ...result })
    : c.json({ ok: false, error: "pairing expired or already used" }, 410);
});

subdeviceRouter.get("/", async (c) => c.json({ ok: true, devices: await listSubdevices() }));

subdeviceRouter.post("/heartbeat", async (c) => {
  const device = await authenticateSubdevice(bearer(c));
  return device ? c.json({ ok: true, device }) : c.json({ ok: false, error: "unauthorized" }, 401);
});

subdeviceRouter.delete("/:id", async (c) => {
  const ok = await removeSubdevice(c.req.param("id"));
  return c.json({ ok, error: ok ? undefined : "device not found" }, ok ? 200 : 404);
});

subdeviceRouter.post("/:id/block", async (c) => {
  const ok = await setSubdeviceBlocked(c.req.param("id"), true);
  return c.json({ ok, error: ok ? undefined : "device not found" }, ok ? 200 : 404);
});

subdeviceRouter.delete("/:id/block", async (c) => {
  const ok = await setSubdeviceBlocked(c.req.param("id"), false);
  return c.json({ ok, error: ok ? undefined : "device not found" }, ok ? 200 : 404);
});
