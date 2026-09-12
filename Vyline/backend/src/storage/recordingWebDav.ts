import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { createReadStream } from "node:fs";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { RecordingError, RECORDING_MAX_BYTES } from "./callRecordingStore.js";

export type WebDavConnection = {
  path: string;
  username?: string;
  password?: string;
  allowPrivateNetwork?: boolean;
  allowInsecureHttp?: boolean;
};
function addressKind(ip: string): "public" | "private" | "blocked" {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    if (
      a === 0 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19))
    )
      return "blocked";
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      ? "private"
      : "public";
  }
  if (isIP(ip) !== 6) return "blocked";
  // Reject mapped/translated IPv4 and reserved IPv6 ranges, not just their textual aliases.
  const canonical = new URL(`http://[${ip}]/`).hostname.slice(1, -1).toLowerCase();
  const first = Number.parseInt(canonical.split(":")[0] || "0", 16);
  if (
    canonical.includes(".") ||
    first < 0x2000 ||
    first >= 0xfe00 ||
    (first >= 0x2000 && first <= 0x2002)
  )
    return "blocked";
  if (first >= 0xfc00 && first <= 0xfdff) return "private";
  return first >= 0x2003 && first < 0x4000 ? "public" : "blocked";
}
export async function validateWebDavUrl(target: WebDavConnection) {
  let url: URL;
  try {
    url = new URL(target.path);
  } catch {
    throw new RecordingError("WebDAVのURLが正しくありません");
  }
  if (
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    target.path.length > 2048 ||
    !["https:", "http:"].includes(url.protocol)
  )
    throw new RecordingError("認証情報・クエリーを含まないWebDAVのURLを入力してください");
  if (url.protocol === "http:" && !(target.allowInsecureHttp && target.allowPrivateNetwork))
    throw new RecordingError("WebDAVはHTTPSを使用してください。LANのHTTPは明示的な許可が必要です");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const addresses = isIP(host)
    ? [{ address: host }]
    : await Promise.race([
        lookup(host, { all: true }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new RecordingError("WebDAVの名前解決がタイムアウトしました")),
            5000,
          );
        }),
      ]).finally(() => clearTimeout(timer));
  if (
    !addresses.length ||
    addresses.some(({ address }) => {
      const kind = addressKind(address);
      return (
        kind === "blocked" ||
        (kind === "private" && !target.allowPrivateNetwork) ||
        (url.protocol === "http:" && kind !== "private")
      );
    })
  )
    throw new RecordingError(
      "このWebDAV接続先は許可されていません。LANの場合は専用の許可設定を確認してください",
    );
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
  return { url, ip: addresses[0]!.address, host };
}

/** DNS is validated once then the socket connects to that exact IP. TLS still verifies the original hostname. */
export async function webDavRequest(
  target: WebDavConnection,
  method: string,
  suffix = "",
  options: {
    file?: string;
    bytes?: number;
    range?: string;
    body?: string;
    destination?: string;
  } = {},
): Promise<IncomingMessage> {
  const { url, ip, host } = await validateWebDavUrl(target);
  for (const name of [suffix, options.destination ?? ""]) {
    if (
      name &&
      (!/^(?:[a-z0-9-]+\/)*[a-z0-9.-]*\/?$/.test(name) ||
        name.split("/").some((part) => part === "." || part === ".."))
    )
      throw new RecordingError("WebDAV保存名が正しくありません");
  }
  const headers: Record<string, string> = { Host: url.host, "Accept-Encoding": "identity" };
  if (target.username || target.password)
    headers.Authorization = `Basic ${Buffer.from(`${target.username ?? ""}:${target.password ?? ""}`).toString("base64")}`;
  if (method === "PROPFIND") headers.Depth = "0";
  if (method === "PUT") {
    headers["If-None-Match"] = "*";
    headers["Content-Type"] = "application/octet-stream";
  }
  if (method === "MOVE" && options.destination) {
    headers.Destination = new URL(options.destination, url).href;
    headers.Overwrite = "F";
  }
  if (options.bytes !== undefined) headers["Content-Length"] = String(options.bytes);
  if (options.range) headers.Range = options.range;
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      {
        hostname: ip,
        servername: host,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname + suffix,
        method,
        headers,
        agent: false,
      },
      (response) => {
        response.once("close", () => clearTimeout(deadline));
        if ((response.statusCode ?? 0) >= 300 && (response.statusCode ?? 0) < 400) {
          response.destroy();
          reject(new RecordingError("WebDAVのリダイレクトは許可されていません"));
        } else resolve(response);
      },
    );
    const deadline = setTimeout(
      () => request.destroy(new Error("WebDAV transfer deadline")),
      20 * 60_000,
    );
    request.setTimeout(30_000, () => request.destroy(new Error("WebDAV idle timeout")));
    request.once("error", () => {
      clearTimeout(deadline);
      reject(
        new RecordingError("WebDAVへ接続できませんでした。URL・認証・証明書を確認してください"),
      );
    });
    if (options.file) {
      const source = createReadStream(options.file, { highWaterMark: 64 * 1024 });
      source.once("error", (error) => request.destroy(error));
      request.once("close", () => source.destroy());
      source.pipe(request);
    } else request.end(options.body);
  });
}
async function consume(response: IncomingMessage, limit = 64 * 1024) {
  let bytes = 0;
  try {
    for await (const chunk of response) {
      bytes += Buffer.byteLength(chunk);
      if (bytes > limit) throw new RecordingError("WebDAVの応答が大きすぎます");
    }
  } finally {
    response.destroy();
  }
}
function remoteName(owner: string, id: string, extension: string) {
  if (!/^[0-9a-f-]{36}$/.test(id) || !["webm", "mp4"].includes(extension))
    throw new RecordingError("WebDAV保存名が正しくありません");
  return `vyline-recordings/${createHash("sha256").update(owner).digest("hex")}/${id}.${extension}`;
}
async function hashStream(stream: AsyncIterable<Uint8Array>, maxBytes: number) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of stream) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw new RecordingError("WebDAVのファイルサイズが一致しません");
    hash.update(chunk);
  }
  if (bytes !== maxBytes) throw new RecordingError("WebDAVのファイルサイズが一致しません");
  return hash.digest("hex");
}
export async function testWebDavConnection(target: WebDavConnection) {
  const response = await webDavRequest(target, "PROPFIND");
  const status = response.statusCode;
  await consume(response);
  if (status !== 200 && status !== 207)
    throw new RecordingError(`WebDAVの接続確認に失敗しました（HTTP ${status}）`);
}
export async function uploadWebDavRecording(
  target: WebDavConnection,
  owner: string,
  id: string,
  extension: string,
  file: string,
  bytes: number,
) {
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > RECORDING_MAX_BYTES)
    throw new RecordingError("録画サイズが正しくありません");
  const name = remoteName(owner, id, extension);
  const staging = `${name}.partial`;
  for (const directory of ["vyline-recordings/", name.slice(0, name.lastIndexOf("/") + 1)]) {
    const response = await webDavRequest(target, "MKCOL", directory);
    const status = response.statusCode;
    await consume(response);
    if (status !== 201 && status !== 405)
      throw new RecordingError(`WebDAVに保存フォルダーを作成できません（HTTP ${status}）`);
  }
  const existing = await webDavRequest(target, "GET", name);
  if (existing.statusCode === 200) {
    await verifyFile(existing, file, bytes);
    await deleteObject(target, staging);
    return;
  }
  const existingStatus = existing.statusCode;
  await consume(existing);
  if (existingStatus !== 404)
    throw new RecordingError(`WebDAVの保存先を確認できません（HTTP ${existingStatus}）`);
  // Only this recording's reserved staging object is replaced. The final name is never overwritten.
  await deleteObject(target, staging);
  const response = await webDavRequest(target, "PUT", staging, { file, bytes });
  const status = response.statusCode;
  await consume(response);
  if (status !== 201 && status !== 204)
    throw new RecordingError(
      `WebDAVに転送できません（HTTP ${status}）。サーバー内の記録は保持されています`,
    );
  await verifyFile(await webDavRequest(target, "GET", staging), file, bytes);
  const moved = await webDavRequest(target, "MOVE", staging, { destination: name });
  const movedStatus = moved.statusCode;
  await consume(moved);
  if (movedStatus !== 201 && movedStatus !== 204 && movedStatus !== 412)
    throw new RecordingError(
      `WebDAVの保存を確定できません（HTTP ${movedStatus}）。MOVE対応を確認してください`,
    );
  await verifyFile(await webDavRequest(target, "GET", name), file, bytes);
  await deleteObject(target, staging);
}
async function verifyFile(verify: IncomingMessage, file: string, bytes: number) {
  try {
    if (verify.statusCode !== 200) throw new RecordingError("WebDAVの保存結果を読み戻せません");
    const local = createReadStream(file, { highWaterMark: 64 * 1024 });
    try {
      const [localHash, remoteHash] = await Promise.all([
        hashStream(local, bytes),
        hashStream(verify, bytes),
      ]);
      if (remoteHash !== localHash)
        throw new RecordingError(
          "WebDAVの保存内容が一致しません。サーバー内の記録は保持されています",
        );
    } finally {
      local.destroy();
    }
  } finally {
    verify.destroy();
  }
}
export async function readWebDavRecording(
  target: WebDavConnection,
  owner: string,
  id: string,
  extension: string,
  range?: string,
) {
  return webDavRequest(target, "GET", remoteName(owner, id, extension), range ? { range } : {});
}
export async function deleteWebDavRecording(
  target: WebDavConnection,
  owner: string,
  id: string,
  extension: string,
) {
  const name = remoteName(owner, id, extension);
  await deleteObject(target, `${name}.partial`);
  await deleteObject(target, name);
}
async function deleteObject(target: WebDavConnection, name: string) {
  const response = await webDavRequest(target, "DELETE", name);
  const status = response.statusCode;
  await consume(response);
  if (status !== 200 && status !== 204 && status !== 404)
    throw new RecordingError(`WebDAVから削除できません（HTTP ${status}）`);
}
