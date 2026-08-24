import { existsSync } from "node:fs";
import { mkdir, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface IosBackupDevice {
  udid: string;
  name: string;
  iOSVersion: string;
  deviceType: string;
  encrypted: boolean;
  passcodeSet: boolean;
  backupRoot: string;
  modifiedAt: string;
}

export interface IosBackupProgress {
  stage: string;
  current: number;
  total: number;
  message: string;
  file?: string;
}

export interface IosBackupSession {
  id: string;
  status: "pending" | "running" | "completed" | "failed";
  progress: IosBackupProgress | null;
  result: {
    extracted: { lineFiles: number; databases: number };
    parsed: { chats: number; totalMessages: number };
  } | null;
  error: string | null;
  startedAt: number;
  completedAt: number | null;
}

const sessions = new Map<string, IosBackupSession>();

function backupRoots(): string[] {
  const configured = process.env.IOS_BACKUP_ROOT?.trim();
  if (configured) return [configured];
  const home = homedir();
  return [
    join(
      process.env.APPDATA ?? join(home, "AppData", "Roaming"),
      "Apple Computer",
      "MobileSync",
      "Backup",
    ),
    join(home, "Apple", "MobileSync", "Backup"),
    join(home, "Library", "Application Support", "MobileSync", "Backup"),
  ];
}

async function findBackups(): Promise<IosBackupDevice[]> {
  const devices: IosBackupDevice[] = [];
  for (const root of backupRoots()) {
    if (!existsSync(root)) continue;
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const backupRoot = join(root, entry.name);
      if (
        !existsSync(join(backupRoot, "Manifest.plist")) ||
        !existsSync(join(backupRoot, "Manifest.db"))
      ) {
        continue;
      }
      const info = await stat(backupRoot);
      devices.push({
        udid: entry.name,
        name: entry.name,
        iOSVersion: "不明（復元時に確認）",
        deviceType: "iPhone / iPad",
        encrypted: true,
        passcodeSet: true,
        backupRoot: root,
        modifiedAt: info.mtime.toISOString(),
      });
    }
  }
  return devices.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

export async function listIosBackups(): Promise<IosBackupDevice[]> {
  return findBackups();
}

export async function startIosBackupRestore(
  udid: string,
  password: string,
): Promise<IosBackupSession> {
  if (!password) throw new Error("暗号化バックアップのパスワードが必要です");
  const device = (await findBackups()).find((item) => item.udid === udid);
  if (!device) throw new Error("指定された iOS バックアップが見つかりません");

  const id = `ios-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const session: IosBackupSession = {
    id,
    status: "pending",
    progress: null,
    result: null,
    error: null,
    startedAt: Date.now(),
    completedAt: null,
  };
  sessions.set(id, session);
  void runRestore(session, device, password);
  return session;
}

export function getIosBackupSession(id: string): IosBackupSession | null {
  return sessions.get(id) ?? null;
}

async function runRestore(
  session: IosBackupSession,
  device: IosBackupDevice,
  password: string,
): Promise<void> {
  session.status = "running";
  try {
    const packagePath = join(
      dirname(fileURLToPath(import.meta.url)),
      "../../../packages/ios-backup/dist/index.js",
    );
    const backup = (await import(packagePath)) as {
      extractAndParseLineHistory: (
        root: string,
        udid: string,
        password: string,
        outputDir: string,
        onProgress: (stage: string, current: number, total: number, message: string) => void,
      ) => Promise<{
        extracted: { lineFiles: unknown[]; databases: unknown[] };
        parsed: { chats: unknown[]; messages: Map<string, unknown[]> };
      }>;
    };
    const outputDir = join(
      dirname(fileURLToPath(import.meta.url)),
      "../../../data/ios-backup",
      session.id,
    );
    await mkdir(outputDir, { recursive: true });
    const result = await backup.extractAndParseLineHistory(
      device.backupRoot,
      device.udid,
      password,
      outputDir,
      (stage, current, total, message) => {
        session.progress = { stage, current, total, message };
      },
    );
    session.result = {
      extracted: {
        lineFiles: result.extracted.lineFiles.length,
        databases: result.extracted.databases.length,
      },
      parsed: {
        chats: result.parsed.chats.length,
        totalMessages: Array.from(result.parsed.messages.values()).reduce(
          (sum, messages) => sum + messages.length,
          0,
        ),
      },
    };
    session.status = "completed";
    session.completedAt = Date.now();
  } catch (error) {
    session.status = "failed";
    session.error = error instanceof Error ? error.message : "iOSバックアップの解析に失敗しました";
    session.completedAt = Date.now();
  }
}
