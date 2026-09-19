import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export function safePathComponent(value: string, fallback = "unknown"): string {
  const normalized = value
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 96);
  return normalized || fallback;
}

export async function writeTextAtomic(path: string, content: string, mode = 0o600): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = join(
    dirname(path),
    `.${safePathComponent(path.split(/[\\/]/).pop() ?? "data")}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    await writeFile(temp, content, { encoding: "utf8", mode });
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await writeTextAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}
