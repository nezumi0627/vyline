// Run as a regular Bun process: isolates Bun 1.4 Windows test-runner/socket lifetime faults.
import { strict as assert } from "node:assert";
import { networkInterfaces, tmpdir } from "node:os";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  webDavRequest,
  uploadWebDavRecording,
  readWebDavRecording,
  deleteWebDavRecording,
} from "./recordingWebDav.js";

const ip = Object.values(networkInterfaces())
  .flat()
  .find((entry) => entry?.family === "IPv4" && !entry.internal)?.address;
if (!ip) throw new Error("The isolated LAN stub needs a local IPv4 interface");
const objects = new Map<string, Buffer>();
const paths: string[] = [];
let redirect = false;
let interruptPut = false;
const server = Bun.serve({
  hostname: ip,
  port: 0,
  async fetch(req) {
    const path = new URL(req.url).pathname;
    paths.push(`${req.method} ${path}`);
    if (
      req.headers.get("authorization") !==
      `Basic ${Buffer.from("fixture:secret").toString("base64")}`
    )
      return new Response(null, { status: 401 });
    if (redirect)
      return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } });
    if (req.method === "MKCOL") return new Response(null, { status: 201 });
    if (req.method === "PUT") {
      const data = Buffer.from(await req.arrayBuffer());
      if (objects.has(path)) return new Response(null, { status: 412 });
      if (interruptPut) {
        interruptPut = false;
        objects.set(path, Buffer.from("partial upload"));
        return new Response(null, { status: 503 });
      }
      objects.set(path, data);
      return new Response(null, { status: 201 });
    }
    if (req.method === "GET") {
      const bytes = objects.get(path);
      if (!bytes) return new Response(null, { status: 404 });
      if (req.headers.get("range") === "bytes=1-3")
        return new Response(new Uint8Array(bytes.subarray(1, 4)), {
          status: 206,
          headers: { "content-length": "3", "content-range": `bytes 1-3/${bytes.length}` },
        });
      return new Response(new Uint8Array(bytes), {
        headers: { "content-length": String(bytes.length) },
      });
    }
    if (req.method === "MOVE") {
      const destination = new URL(String(req.headers.get("destination"))).pathname;
      if (
        req.headers.get("overwrite") !== "F" ||
        !destination.startsWith("/owned-fixture/vyline-recordings/")
      )
        return new Response(null, { status: 400 });
      if (objects.has(destination)) return new Response(null, { status: 412 });
      const bytes = objects.get(path);
      if (!bytes) return new Response(null, { status: 404 });
      objects.set(destination, bytes);
      objects.delete(path);
      return new Response(null, { status: 201 });
    }
    if (req.method === "DELETE") {
      objects.delete(path);
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 207 });
  },
});
const port = server.port;
const target = {
  path: `http://${ip}:${port}/owned-fixture/`,
  username: "fixture",
  password: "secret",
  allowPrivateNetwork: true,
  allowInsecureHttp: true,
};
const root = await mkdtemp(join(tmpdir(), "vyline-dav-"));
const file = join(root, "synthetic.webm");
const data = Buffer.alloc(128 * 1024, 67);
await writeFile(file, data);
const id = "11111111-1111-4111-8111-111111111111";
try {
  await uploadWebDavRecording(target, "owner", id, "webm", file, data.length);
  assert.deepEqual([...objects.values()][0], data);
  const range = await readWebDavRecording(target, "owner", id, "webm", "bytes=1-3");
  assert.equal(range.statusCode, 206);
  assert.equal(range.headers["content-range"], `bytes 1-3/${data.length}`);
  const chunks: Buffer[] = [];
  for await (const chunk of range) chunks.push(Buffer.from(chunk));
  assert.deepEqual(Buffer.concat(chunks), data.subarray(1, 4));
  await uploadWebDavRecording(target, "owner", id, "webm", file, data.length);
  objects.set([...objects.keys()][0]!, Buffer.alloc(data.length, 68));
  await assert.rejects(() => uploadWebDavRecording(target, "owner", id, "webm", file, data.length));
  redirect = true;
  await assert.rejects(() => webDavRequest(target, "PROPFIND"));
  redirect = false;
  await deleteWebDavRecording(target, "owner", id, "webm");
  assert.equal(objects.size, 0);
  interruptPut = true;
  await assert.rejects(() => uploadWebDavRecording(target, "owner", id, "webm", file, data.length));
  assert.equal([...objects.values()][0]?.toString(), "partial upload");
  await uploadWebDavRecording(target, "owner", id, "webm", file, data.length);
  assert.equal(objects.size, 1);
  assert.deepEqual([...objects.values()][0], data);
  assert.equal([...objects.keys()][0]?.endsWith(".webm"), true);
  await deleteWebDavRecording(target, "owner", id, "webm");
  assert.equal(
    paths.every((p) => p.includes("/owned-fixture/")),
    true,
  );
} finally {
  await server.stop(true);
  await rm(root, { recursive: true, force: true });
}

console.log("PASS: WebDAV upload, Range, verify, retry, partial failure, MOVE and owned deletion");
