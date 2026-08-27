import { networkInterfaces } from "node:os";
import { logger } from "./logger.js";

const TAILSCALE_LOG_INTERVAL_MS = 30_000;
let lastLoggedIp: string | null = null;

async function tryTailscaleCli(): Promise<string | null> {
  try {
    const proc = Bun.spawn({
      cmd: ["tailscale", "ip", "-4"],
      stdout: "pipe",
      stderr: "pipe",
      timeout: 2000,
    });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    const ip = out.trim().split(/\s+/)[0]?.trim() ?? "";
    if (/^100\.\d+\.\d+\.\d+$/.test(ip)) return ip;
  } catch {
    /* tailscale CLI not available */
  }
  return null;
}

function tailscaleIpFromInterfaces(): string | null {
  try {
    const nets = networkInterfaces();
    for (const addrs of Object.values(nets)) {
      if (!addrs) continue;
      for (const a of addrs) {
        if (a.family === "IPv4" && /^100\.\d+\.\d+\.\d+$/.test(a.address)) {
          // tailscale CGNAT range is 100.64/10, heuristic good enough
          return a.address;
        }
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

export async function detectTailscaleIp(): Promise<string | null> {
  const cli = await tryTailscaleCli();
  if (cli) return cli;
  return tailscaleIpFromInterfaces();
}

export function startTailscaleWatcher(port: number): void {
  const checkAndLog = async () => {
    const ip = await detectTailscaleIp();
    if (ip && ip !== lastLoggedIp) {
      lastLoggedIp = ip;
      logger.info(
        { tailscaleIp: ip, url: `http://${ip}:${port}`, port },
        "Tailscale detected — Vyline accessible via Tailscale",
      );
    } else if (!ip && lastLoggedIp) {
      lastLoggedIp = null;
      logger.info("Tailscale no longer detected");
    }
  };

  void checkAndLog();
  setInterval(() => void checkAndLog(), TAILSCALE_LOG_INTERVAL_MS);
}
