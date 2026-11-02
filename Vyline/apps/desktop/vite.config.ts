import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

function buildCommitSha(): string {
  const configured = process.env.VYLINE_COMMIT_SHA?.trim();
  if (configured && /^[\da-f]{7,40}$/i.test(configured)) return configured;
  try {
    return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
      cwd: resolve(__dirname, "../../.."),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

export default defineConfig({
  define: {
    __VYLINE_COMMIT_SHA__: JSON.stringify(buildCommitSha()),
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      "@vyline/types": resolve(__dirname, "../../packages/types/src/index.ts"),
    },
  },
  server: {
    host: process.env.VYLINE_LAN_ACCESS === "true" ? "0.0.0.0" : "127.0.0.1",
    // preview_start (autoPort) は PORT 環境変数で空きポートを渡す。未設定なら通常どおり 5173
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
    proxy: {
      // backend へのプロキシ (CORS 回避)。backend は /api 付きの BFF ルートを
      // 正本として公開するため、ここで prefix を削ると設定・引継ぎ・診断 API が 404 になる。
      "/api": {
        target: process.env.VYLINE_BACKEND_URL ?? "http://127.0.0.1:3001",
        timeout: 60_000,
      },
    },
  },
});
