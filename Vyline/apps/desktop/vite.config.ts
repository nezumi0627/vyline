import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

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
    // preview_start (autoPort) は PORT 環境変数で空きポートを渡す。未設定なら通常どおり 5173
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
    proxy: {
      // backend へのプロキシ (CORS 回避)
      "/api": {
        target: "http://127.0.0.1:3001",
        rewrite: (path) => path.replace(/^\/api/, ""),
        timeout: 60_000,
      },
    },
  },
});
