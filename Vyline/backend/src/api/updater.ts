import { Hono } from "hono";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OWNER = "nezumi0627";
const REPO = "Vyline";
const RELEASE_API = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`;
const MAX_INSTALLER_BYTES = 150 * 1024 * 1024;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function isLoopbackHost(value: string): boolean {
  let hostname: string;
  try {
    hostname = (value.includes("://") ? new URL(value) : new URL(`http://${value}`)).hostname
      .replace(/^\[|\]$/g, "")
      .toLowerCase();
  } catch {
    return false;
  }
  return (
    hostname === "localhost" ||
    hostname === "::1" ||
    (isIP(hostname) === 4 && hostname.split(".")[0] === "127")
  );
}

export function isAllowedLoopbackRequest(origin: string | undefined, host: string): boolean {
  if (!origin || !isLoopbackHost(origin) || !isLoopbackHost(host)) return false;
  try {
    const parsed = new URL(origin);
    return /^https?:$/.test(parsed.protocol) && parsed.host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

export function isLocalInstallerRuntime(
  nodeEnv: string | undefined,
  host: string | undefined,
  lanAccess: string | undefined,
): boolean {
  const bindHost = lanAccess === "true" ? "" : (host ?? "127.0.0.1");
  return nodeEnv === "production" && Boolean(bindHost && isLoopbackHost(bindHost));
}

export const updaterRouter = new Hono();
updaterRouter.get("/capability", (c) =>
  c.json({
    ok: true,
    canLaunchInstaller:
      process.platform === "win32" &&
      isLocalInstallerRuntime(
        process.env.NODE_ENV,
        process.env.VYLINE_HOST,
        process.env.VYLINE_LAN_ACCESS,
      ),
  }),
);

updaterRouter.post("/launch", async (c) => {
  if (
    !isLocalInstallerRuntime(
      process.env.NODE_ENV,
      process.env.VYLINE_HOST,
      process.env.VYLINE_LAN_ACCESS,
    )
  )
    return c.json({ ok: false, error: "local installer launch is disabled" }, 403);
  const origin = c.req.header("origin");
  const host = c.req.header("host") ?? "";
  if (!isAllowedLoopbackRequest(origin, host)) {
    return c.json({ ok: false, error: "loopback browser request required" }, 403);
  }
  if (process.platform !== "win32")
    return c.json(
      { ok: false, error: "interactive installer launch is supported on Windows only" },
      501,
    );

  const body = await c.req.json<{ version?: unknown }>().catch(() => null);
  if (!body || typeof body.version !== "string" || !VERSION.test(body.version)) {
    return c.json({ ok: false, error: "invalid release version" }, 400);
  }

  try {
    const releaseResponse = await fetch(RELEASE_API, {
      headers: { Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!releaseResponse.ok) throw new Error("GitHub release lookup failed");
    const release = (await releaseResponse.json()) as {
      tag_name?: string;
      assets?: Array<{
        name?: string;
        browser_download_url?: string;
        digest?: string;
        size?: number;
      }>;
    };
    const tag = release.tag_name?.replace(/^v/i, "");
    if (tag !== body.version)
      return c.json({ ok: false, error: "release changed; check again" }, 409);
    const assetName = `VylineSetup-${tag}.exe`;
    const asset = release.assets?.find((item) => item.name === assetName);
    const expectedDigest = asset?.digest?.match(/^sha256:([\da-f]{64})$/i)?.[1]?.toLowerCase();
    const downloadUrl = asset?.browser_download_url;
    const expectedPath = `/${OWNER}/${REPO}/releases/download/v${tag}/${assetName}`;
    const url = downloadUrl ? new URL(downloadUrl) : null;
    if (
      !asset ||
      !expectedDigest ||
      !url ||
      url.protocol !== "https:" ||
      url.hostname !== "github.com" ||
      url.username !== "" ||
      url.password !== "" ||
      url.port !== "" ||
      url.search !== "" ||
      url.hash !== "" ||
      url.pathname.toLowerCase() !== expectedPath.toLowerCase()
    ) {
      throw new Error("official installer or SHA-256 digest is unavailable");
    }
    if ((asset.size ?? 0) > MAX_INSTALLER_BYTES) throw new Error("installer exceeds size limit");
    const download = await fetch(url, { signal: AbortSignal.timeout(120_000), redirect: "follow" });
    if (!download.ok) throw new Error("installer download failed");
    const contentLength = Number(download.headers.get("content-length") ?? 0);
    if (contentLength > MAX_INSTALLER_BYTES) throw new Error("installer exceeds size limit");
    if (!download.body) throw new Error("installer response is empty");
    const reader = download.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_INSTALLER_BYTES) {
        await reader.cancel();
        throw new Error("installer exceeds size limit");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_INSTALLER_BYTES)
      throw new Error("installer size is invalid");
    const actualDigest = createHash("sha256").update(bytes).digest("hex");
    if (actualDigest !== expectedDigest) throw new Error("installer SHA-256 verification failed");

    const directory = join(tmpdir(), `vyline-update-${randomUUID()}`);
    await mkdir(directory, { recursive: false });
    const installer = join(directory, assetName);
    await writeFile(installer, bytes, { flag: "wx", mode: 0o700 });
    Bun.spawn([installer], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
      windowsHide: false,
      detached: true,
    });
    return c.json({ ok: true, launched: true }, 202);
  } catch (error) {
    return c.json(
      { ok: false, error: error instanceof Error ? error.message : "installer launch failed" },
      502,
    );
  }
});
