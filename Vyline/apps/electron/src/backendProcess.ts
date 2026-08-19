/**
 * backendProcess.ts — Vyline backend (Hono/Bun) の起動・監視・終了管理
 *
 * - 開発時: リポジトリ内の `Vyline/backend/src/index.ts` を `bun` で直接実行
 * - パッケージ後: electron-builder が `resources/backend-bin/` に同梱した
 *   プラットフォーム別スタンドアロン実行ファイル（`bun build --compile` 産物）を起動
 *
 * どちらのモードでも同じ Hono サーバーが同一プロセスモデルで動くため、
 * フロントは常に「同一オリジンの /api, /line, /auth, /debug, /cdn」を叩けばよい。
 */
import { type ChildProcessByStdio, spawn } from "node:child_process";
import type { Readable } from "node:stream";
import { existsSync, readdirSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";

export interface BackendHandle {
  readonly port: number;
  readonly url: string;
  stop(): Promise<void>;
}

/** 0 を bind して OS にあいているポートを割り当ててもらう */
export function findFreePort(preferred?: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", (err) => {
      if (preferred) {
        // 優先ポートが使用中なら OS 任せにフォールバック
        findFreePort().then(resolve, reject);
      } else {
        reject(err);
      }
    });
    server.listen({ port: preferred ?? 0, host: "127.0.0.1" }, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : preferred;
      server.close(() => resolve(port ?? 3001));
    });
  });
}

function backendBinaryName(): string {
  const plat = process.platform === "win32" ? "win32" : process.platform;
  const arch = process.arch;
  const ext = process.platform === "win32" ? ".exe" : "";
  return `vyline-backend-${plat}-${arch}${ext}`;
}

/** パッケージ済みリソース内のバックエンド実行ファイルを探す（arch フォールバック付き） */
function resolvePackagedBackendBinary(resourcesPath: string): string | null {
  const dir = join(resourcesPath, "backend-bin");
  const exact = join(dir, backendBinaryName());
  if (existsSync(exact)) return exact;
  if (!existsSync(dir)) return null;
  // universal mac ビルド等、完全一致が無ければ同一 OS の別 arch を探す
  const plat = process.platform === "win32" ? "win32" : process.platform;
  const candidates = readdirSync(dir).filter((f) => f.startsWith(`vyline-backend-${plat}-`));
  const first = candidates[0];
  return first ? join(dir, first) : null;
}

export interface StartBackendOptions {
  isDev: boolean;
  repoRoot: string;
  resourcesPath: string;
  dataDir: string;
  bunExecutable?: string;
  onLog?: (line: string) => void;
  onExit?: (code: number | null) => void;
}

export async function startBackend(opts: StartBackendOptions): Promise<BackendHandle> {
  const port = await findFreePort(3101);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(port),
    VYLINE_HOST: "127.0.0.1",
    VYLINE_DATA_DIR: opts.dataDir,
    NODE_ENV: opts.isDev ? "development" : "production",
  };

  let child: ChildProcessByStdio<null, Readable, Readable>;

  if (opts.isDev) {
    const backendDir = join(opts.repoRoot, "Vyline", "backend");
    const bun = opts.bunExecutable ?? "bun";
    child = spawn(bun, ["run", "src/index.ts"], {
      cwd: backendDir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } else {
    const bin = resolvePackagedBackendBinary(opts.resourcesPath);
    if (!bin) {
      throw new Error(
        `backend binary not found under ${join(opts.resourcesPath, "backend-bin")} — run "bun run build:backend" before packaging`,
      );
    }
    // フロントの静的ビルドも resources 側に同梱している
    env["VYLINE_STATIC_DIR"] = join(opts.resourcesPath, "frontend-dist");
    child = spawn(bin, [], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  child.stdout.on("data", (buf: Buffer) => opts.onLog?.(buf.toString()));
  child.stderr.on("data", (buf: Buffer) => opts.onLog?.(buf.toString()));
  child.on("exit", (code) => opts.onExit?.(code));

  const url = `http://127.0.0.1:${port}`;
  await waitForHealthy(url, 30_000);

  return {
    port,
    url,
    stop: () =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.killed) {
          resolve();
          return;
        }
        const timer = setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {
            /* noop */
          }
        }, 4_000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
        try {
          child.kill(process.platform === "win32" ? undefined : "SIGTERM");
        } catch {
          clearTimeout(timer);
          resolve();
        }
      }),
  };
}

async function waitForHealthy(baseUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/healthz`, { signal: AbortSignal.timeout(1_500) });
      if (res.ok) return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Vyline backend did not become healthy within ${timeoutMs}ms: ${String(lastErr)}`);
}
