import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const WORKSPACE_ROOT = resolve(__dirname, "../../..");

export default defineConfig(({ mode }) => {
  // The shared .env lives at the repository root, outside Vite's project root.
  const env = loadEnv(mode, WORKSPACE_ROOT, "");
  const lanAccess = (process.env.VYLINE_LAN_ACCESS ?? env.VYLINE_LAN_ACCESS) === "true";
  const backendUrl =
    process.env.VYLINE_BACKEND_URL ?? env.VYLINE_BACKEND_URL ?? "http://127.0.0.1:3001";

  return {
    plugins: [react()],
    resolve: {
      alias: {
        "@": resolve(__dirname, "src"),
        "@vyline/types": resolve(__dirname, "../../packages/types/src/index.ts"),
      },
    },
    server: {
      host: lanAccess ? "0.0.0.0" : "127.0.0.1",
      // preview_start (autoPort) は PORT 環境変数で空きポートを渡す。未設定なら通常どおり 5173
      port: Number(process.env.PORT ?? env.PORT ?? 5173),
      proxy: {
        // backend へのプロキシ (CORS 回避)
        "/api": {
          target: backendUrl,
          rewrite: (path) => path.replace(/^\/api/, ""),
          timeout: 60_000,
          configure: (proxy) => {
            // Backend requestIP() sees Vite's loopback socket. Preserve the
            // browser peer so LAN mode can enforce subdevice authentication.
            proxy.on("proxyReq", (proxyReq, req) => {
              proxyReq.setHeader("x-vyline-proxy-client-address", req.socket.remoteAddress ?? "");
            });
          },
        },
      },
    },
  };
});
