import { Container } from "@cloudflare/containers";

interface Env {
  VYLINE_CONTAINER: DurableObjectNamespace<VylineContainer>;
  AWS_ACCESS_KEY_ID: string;
  AWS_SECRET_ACCESS_KEY: string;
  R2_ACCOUNT_ID: string;
  R2_BUCKET_NAME: string;
}

export class VylineContainer extends Container<Env> {
  defaultPort = 3001;
  sleepAfter = "30m";
  enableInternet = true;
  envVars: Record<string, string> = {
    AWS_ACCESS_KEY_ID: this.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: this.env.AWS_SECRET_ACCESS_KEY,
    R2_ACCOUNT_ID: this.env.R2_ACCOUNT_ID,
    R2_BUCKET_NAME: this.env.R2_BUCKET_NAME,
    NODE_ENV: "production",
    PORT: "3001",
    VYLINE_HOST: "0.0.0.0",
    VYLINE_LAN_ACCESS: "false",
    VYLINE_DISABLE_WATCH: "1",
    VYLINE_DATA_DIR: "/mnt/vyline/data",
    // Object-backed FUSE storage must not use SQLite WAL sidecar files.
    VYLINE_SQLITE_JOURNAL_MODE: "DELETE",
    VYLINE_SQLITE_SYNCHRONOUS: "FULL",
    VYLINE_STORAGE_DIR: "/mnt/vyline/storage",
    VYLINE_CDN_CACHE_DIR: "/mnt/vyline/storage/cache/cdn-cache",
    VYLINE_ICON_CACHE_DIR: "/mnt/vyline/storage/cache/icons",
    VYLINE_MEDIA_STORAGE_DIR: "/mnt/vyline/storage/saved-media",
  };
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return env.VYLINE_CONTAINER.getByName("vyline").fetch(request);
  },
} satisfies ExportedHandler<Env>;
