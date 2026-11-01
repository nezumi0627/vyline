import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const backendTarget =
  process.env.VYLINE_BACKEND_URL ??
  `http://127.0.0.1:${process.env.VYLINE_BACKEND_PORT ?? process.env.PORT ?? 3001}`;

function proxyConfig(ws = false) {
  return {
    target: backendTarget,
    ...(ws ? { ws: true } : {}),
    configure(proxy: {
      on: (
        event: string,
        handler: (
          proxyReq: { setHeader: (name: string, value: string) => void },
          req: { socket: { remoteAddress?: string } },
        ) => void,
      ) => void;
    }) {
      proxy.on("proxyReq", (proxyReq, req) => {
        if (req.socket.remoteAddress) {
          proxyReq.setHeader("x-vyline-proxy-client-address", req.socket.remoteAddress);
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      "@vyline/types": resolve(__dirname, "../../packages/types/src/index.ts"),
    },
  },
  server: {
    host: process.env.VYLINE_LAN_ACCESS === "true" ? "0.0.0.0" : "127.0.0.1",
    // Frontend and backend use separate ports. Vite picks the next free port by default.
    port: process.env.VITE_PORT ? Number(process.env.VITE_PORT) : 5173,
    proxy: {
      // Same-origin proxies also carry the real client address so LAN auth does not trust Vite as localhost.
      "/api": {
        ...proxyConfig(true),
        rewrite: (path) => path.replace(/^\/api/, ""),
        timeout: 60_000,
      },
      "/line": proxyConfig(true),
    },
  },
});
