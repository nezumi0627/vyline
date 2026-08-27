import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isIP } from "node:net";

const execFileAsync = promisify(execFile);
const TAILSCALE_IPV4 = /^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.(?:\d{1,3})\.(?:\d{1,3})$/;

function validTailscaleIp(value: string): boolean {
  return isIP(value) === 4 && TAILSCALE_IPV4.test(value);
}

export async function discoverTailscaleIps(): Promise<string[]> {
  try {
    const result = await execFileAsync("tailscale", ["ip", "-4"], {
      timeout: 1_500,
      windowsHide: true,
      maxBuffer: 16 * 1024,
    });
    return [...new Set(result.stdout.split(/\s+/).filter(validTailscaleIp))];
  } catch {
    return [];
  }
}

export async function discoverTailscaleUrls(port: number): Promise<string[]> {
  const ips = await discoverTailscaleIps();
  return ips.map((ip) => `http://${ip}:${port}`);
}

export function startTailscaleMonitor(
  port: number,
  onChange: (urls: string[]) => void,
  intervalMs = 10_000,
): () => void {
  let previous = "";
  let stopped = false;

  const check = async () => {
    const urls = await discoverTailscaleUrls(port);
    if (stopped) return;
    const next = urls.join("\n");
    if (next === previous) return;
    previous = next;
    onChange(urls);
  };

  void check();
  const timer = setInterval(() => void check(), intervalMs);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
