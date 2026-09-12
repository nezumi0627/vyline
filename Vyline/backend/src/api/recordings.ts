import { Hono } from "hono";
import { Readable } from "node:stream";
import { statfs } from "node:fs/promises";
import * as service from "../service/callRecordingService.js";
import {
  getCallRecordingStore,
  RecordingError,
  RECORDING_CHUNK_BYTES,
} from "../storage/callRecordingStore.js";
import { getRecordingSettings } from "../storage/recordingSettings.js";
import { readWebDavRecording, testWebDavConnection } from "../storage/recordingWebDav.js";
import { parseMediaByteRange } from "./mediaByteRange.js";

async function boundedBody(request: Request, limit: number): Promise<Uint8Array> {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
    await request.body?.cancel();
    throw new RecordingError("送信データが大きすぎます", 413);
  }
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const buffer = new Uint8Array(limit);
  let count = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RecordingError("送信がタイムアウトしました", 409)), 15_000);
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      if (count + value.length > limit) throw new RecordingError("送信データが大きすぎます", 413);
      buffer.set(value, count);
      count += value.length;
    }
    return buffer.subarray(0, count);
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}
async function jsonBody<T>(request: Request): Promise<T> {
  const bytes = await boundedBody(request, 16 * 1024);
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new RecordingError("JSON形式の入力が正しくありません");
  }
}
let receiving = 0;
let mutating = 0;
export function createRecordingRouter(operations = service) {
  const router = new Hono();
  router.use("*", async (c, next) => {
    const body = ["POST", "PUT", "PATCH"].includes(c.req.method);
    const mutation = body || c.req.method === "DELETE";
    if ((body && receiving >= 4) || (mutation && mutating >= 16)) {
      await c.req.raw.body?.cancel();
      return c.json({ ok: false, error: "記録データを処理中です。再試行してください" }, 429);
    }
    if (body) receiving++;
    if (mutation) mutating++;
    try {
      await operations.initializeCallRecordings();
      await next();
    } finally {
      if (body) receiving--;
      if (mutation) mutating--;
    }
  });
  router.onError((error, c) => {
    if (error instanceof RecordingError)
      return c.json({ ok: false, error: error.message }, error.status);
    if (error.name === "MediaStorageCapacityError")
      return c.json(
        { ok: false, error: "保存先の空き容量が不足しています。既存データは保持されています" },
        507,
      );
    return c.json(
      {
        ok: false,
        error: "通話記録を処理できませんでした。保存先とサーバーの状態を確認してください",
      },
      500,
    );
  });
  router.get("/", (c) =>
    c.json({
      ok: true,
      ...getCallRecordingStore().list(c.req.param("accountId")!, c.req.query("cursor")),
    }),
  );
  router.get("/settings", async (c) => {
    const settings = getRecordingSettings();
    const roots = await Promise.all(
      settings.roots.map(async (path) => {
        try {
          const info = await statfs(path);
          return { path, available: true, freeBytes: Number(info.bavail) * Number(info.bsize) };
        } catch {
          return { path, available: false, freeBytes: 0 };
        }
      }),
    );
    return c.json({
      ok: true,
      preferences: settings.get(c.req.param("accountId")!),
      targets: settings.targets(c.req.param("accountId")!),
      roots,
      credentialProtection:
        process.platform === "win32" ? "Windows DPAPI" : "サーバー内の所有者専用ファイル（0600）",
    });
  });
  router.get("/paths", async (c) =>
    c.json({
      ok: true,
      ...(await getRecordingSettings().suggestPaths(c.req.query("prefix") ?? "")),
    }),
  );
  router.put("/settings", async (c) =>
    c.json({
      ok: true,
      preferences: getRecordingSettings().save(
        c.req.param("accountId")!,
        await jsonBody(c.req.raw),
      ),
    }),
  );
  router.post("/targets", async (c) =>
    c.json(
      {
        ok: true,
        target: await getRecordingSettings().addTarget(
          c.req.param("accountId")!,
          await jsonBody(c.req.raw),
        ),
      },
      201,
    ),
  );
  router.post("/targets/:targetId/test", async (c) => {
    const owner = c.req.param("accountId")!;
    const id = c.req.param("targetId");
    const settings = getRecordingSettings();
    if (settings.target(owner, id).kind === "local") await settings.localDirectory(owner, id);
    else await testWebDavConnection(await settings.connection(owner, id));
    return c.json({ ok: true });
  });
  router.delete("/targets/:targetId", async (c) => {
    const owner = c.req.param("accountId")!;
    await getRecordingSettings().removeTarget(owner, c.req.param("targetId"));
    return c.json({ ok: true });
  });
  router.post("/start", async (c) =>
    c.json(
      {
        ok: true,
        recording: await operations.startCallRecording(
          c.req.param("accountId")!,
          await jsonBody(c.req.raw),
        ),
      },
      201,
    ),
  );
  router.put("/:id/chunks", async (c) => {
    const offset = c.req.header("x-recording-offset");
    if (!offset || !/^(0|[1-9]\d{0,15})$/.test(offset))
      throw new RecordingError("記録の送信位置が正しくありません");
    return c.json({
      ok: true,
      recording: await operations.appendCallRecording(
        c.req.param("accountId")!,
        c.req.param("id"),
        Number(offset),
        await boundedBody(c.req.raw, RECORDING_CHUNK_BYTES),
      ),
    });
  });
  router.post("/:id/finish", async (c) => {
    const input = await jsonBody<{ durationMs: number; interrupted?: boolean }>(c.req.raw);
    if (input.interrupted !== undefined && typeof input.interrupted !== "boolean")
      throw new RecordingError("記録の終了状態が正しくありません");
    return c.json({
      ok: true,
      recording: await operations.finishCallRecording(
        c.req.param("accountId")!,
        c.req.param("id"),
        input.durationMs,
        input.interrupted,
      ),
    });
  });
  router.post("/:id/retry", (c) =>
    c.json(
      {
        ok: true,
        recording: operations.requestCallRecordingTransfer(
          c.req.param("accountId")!,
          c.req.param("id"),
        ),
      },
      202,
    ),
  );
  router.get("/:id", (c) =>
    c.json({
      ok: true,
      recording: getCallRecordingStore().get(c.req.param("accountId")!, c.req.param("id")),
    }),
  );
  router.delete("/:id", async (c) => {
    await operations.removeCallRecording(c.req.param("accountId")!, c.req.param("id"));
    return c.json({ ok: true });
  });
  router.on(["GET", "HEAD"], "/:id/file", async (c) => {
    const owner = c.req.param("accountId")!;
    const id = c.req.param("id")!;
    const store = getCallRecordingStore();
    const row = store.get(owner, id);
    const remote = row.transfer === "complete";
    const local = remote ? null : await store.checkedFile(owner, id);
    const size = local?.size ?? row.bytes;
    const range = parseMediaByteRange(c.req.header("range"), size);
    const extension = row.mimeType.includes("mp4") ? "mp4" : "webm";
    const headers: Record<string, string> = {
      "Content-Type": row.mimeType,
      "Cache-Control": "private, no-store",
      "Accept-Ranges": "bytes",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `${c.req.query("download") === "1" ? "attachment" : "inline"}; filename="vyline-call-${new Date(row.createdAt).toISOString().slice(0, 10)}-${id}.${extension}"`,
    };
    if (typeof range === "string")
      return new Response(null, {
        status: 416,
        headers: { ...headers, "Content-Range": `bytes */${size}` },
      });
    const start = range?.start ?? 0;
    const end = range?.end ?? size - 1;
    const length = end - start + 1;
    headers["Content-Length"] = String(length);
    if (range) headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
    if (c.req.method === "HEAD") return new Response(null, { status: range ? 206 : 200, headers });
    if (local)
      return new Response(Bun.file(local.path).slice(start, end + 1), {
        status: range ? 206 : 200,
        headers,
      });
    const response = await readWebDavRecording(
      await getRecordingSettings().connection(owner, row.targetId!),
      owner,
      id,
      extension,
      range ? `bytes=${start}-${end}` : undefined,
    );
    if (
      response.statusCode !== (range ? 206 : 200) ||
      (range && response.headers["content-range"] !== headers["Content-Range"]) ||
      (response.headers["content-length"] !== undefined &&
        Number(response.headers["content-length"]) !== length)
    ) {
      response.destroy();
      throw new RecordingError("WebDAVから記録の指定範囲を取得できません", 409);
    }
    let read = 0;
    const bounded = (Readable.toWeb(response) as ReadableStream<Uint8Array>).pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          read += chunk.length;
          if (read > length) throw new Error("recording size mismatch");
          controller.enqueue(chunk);
        },
        flush() {
          if (read !== length) throw new Error("recording ended early");
        },
      }),
    );
    return new Response(bounded, { status: range ? 206 : 200, headers });
  });
  return router;
}
export const recordingRouter = createRecordingRouter();
