import { Hono } from "hono";
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

function bearer(c: { req: { header(name: string): string | undefined } }) {
  const value = c.req.header("authorization") ?? "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

subdeviceRouter.post("/pairing", async (c) => {
  const body = await c.req.json<{ accountId?: string }>().catch((): { accountId?: string } => ({}));
  if (!body.accountId) return c.json({ ok: false, error: "accountId required" }, 400);
  const pairing = await createPairing(body.accountId);
  return c.json({ ok: true, ...pairing });
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
