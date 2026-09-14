import { afterAll, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm, readFile, cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JsonSchemaType } from "@modelcontextprotocol/sdk/validation/types.js";

const previousDir = process.env.VYLINE_DATA_DIR;
const previousEnabled = process.env.VYLINE_CHATGPT_ENABLED;
const directory = await mkdtemp(join(tmpdir(), "vyline-plugin-"));
process.env.VYLINE_DATA_DIR = directory;
process.env.VYLINE_CHATGPT_ENABLED = "true";
const { executeTool, listTools } = await import("./tools.js");
const { routeTools, routeRequest } = await import("./catalog.js");
const { chatgptRouter } = await import("./router.js");
const { lineRouter } = await import("../api/line.js");
const manager = await import("../line/clientManager.js");
const line = await import("../service/lineService.js");
const store = await import("../storage/chatStoreSqlite.js");
const { createToken, revokeToken } = await import("../storage/apiTokenStore.js");
const { allowedUploadUrl, readBounded, readMediaSlice } = await import("./uploads.js");
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = await import(
  "@modelcontextprotocol/sdk/client/streamableHttp.js"
);
const { AjvJsonSchemaValidator } = await import(
  "@modelcontextprotocol/sdk/validation/ajv-provider.js"
);
const peer = "u11111111111111111111111111111111";
const token = {
  name: "test",
  accountIds: ["a"],
  scopes: ["read", "write"],
  createdAt: "2026-09-14",
};
const online = spyOn(manager, "listAccounts").mockReturnValue(["a", "b"]);

afterAll(async () => {
  online.mockRestore();
  await store.closeAccountChatDb("a");
  await store.closeAccountChatDb("b");
  if (previousDir === undefined) Reflect.deleteProperty(process.env, "VYLINE_DATA_DIR");
  else process.env.VYLINE_DATA_DIR = previousDir;
  if (previousEnabled === undefined) Reflect.deleteProperty(process.env, "VYLINE_CHATGPT_ENABLED");
  else process.env.VYLINE_CHATGPT_ENABLED = previousEnabled;
  await rm(directory, { recursive: true, force: true });
});

test("every advertised route exists and every input schema compiles", () => {
  const validator = new AjvJsonSchemaValidator();
  const tools = listTools(token);
  expect(tools.length).toBeGreaterThan(80);
  expect(new Set(tools.map((t) => t.name)).size).toBe(tools.length);
  for (const tool of tools) validator.getValidator(tool.inputSchema as JsonSchemaType);
  for (const tool of routeTools) {
    expect(lineRouter.routes.some((r) => r.method === tool.method && r.path === tool.path)).toBe(
      true,
    );
    for (const param of tool.path.matchAll(/:([A-Za-z]+)/g))
      expect(tool.schema.shape[param[1]!]).toBeDefined();
  }
});
test("account and scope guards run before LINE, including GET mutations", async () => {
  const request = spyOn(lineRouter, "fetch").mockImplementation(() => Response.json({ ok: true }));
  try {
    for (const name of ["send_message", "get_profile", "close_poll", "delete_poll"]) {
      const args =
        name === "send_message"
          ? { accountId: "b", chatMid: peer, text: "x" }
          : name.endsWith("poll")
            ? { accountId: "b", chatMid: peer, questionId: "p1" }
            : { accountId: "b" };
      expect((await executeTool(token, name, args)).isError).toBe(true);
      expect(
        (await executeTool({ ...token, scopes: ["read"] }, name, { ...args, accountId: "a" }))
          .isError,
      ).toBe(name !== "get_profile");
    }
    expect(request).toHaveBeenCalledTimes(1);
    expect((await executeTool(token, "get_profile", { accountId: "a/../b" })).isError).toBe(true);
    expect(
      (
        await executeTool(token, "send_message", {
          accountId: "a",
          chatMid: peer,
          text: "x",
          body: { accountId: "b" },
        })
      ).isError,
    ).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
  } finally {
    request.mockRestore();
  }
});
test("write tools preserve actual BFF bodies and successful results remove key material", async () => {
  const send = spyOn(line, "sendMessage").mockImplementation(
    async (account, chat, text) =>
      ({
        id: "10",
        account,
        chat,
        text,
        contentMetadata: { keyMaterial: "SECRET", STKID: "1" },
      }) as never,
  );
  try {
    const response = await executeTool(token, "send_message", {
      accountId: "a",
      chatMid: peer,
      text: "test",
      relatedMessageId: "1",
    });
    expect(response.isError).toBe(false);
    expect(send).toHaveBeenCalledWith("a", peer, "test", { relatedMessageId: "1" });
    expect(JSON.stringify(response)).not.toContain("SECRET");
    expect(JSON.stringify(response)).toContain("STKID");
  } finally {
    send.mockRestore();
  }
  const unlike = routeTools.find((t) => t.name === "unlike_note")!;
  const req = routeRequest(
    unlike,
    unlike.schema.parse({ accountId: "a", homeId: peer, postId: "12" }),
  );
  expect(new URL(req.url).searchParams.get("homeId")).toBe(peer);
});
test("recent history defaults to 15 and uses account-bound time+ID pagination", async () => {
  const history = spyOn(line, "fetchMessages").mockResolvedValue(
    Array.from({ length: 15 }, (_, i) => ({
      id: String(30 - i),
      createdTime: 1000,
      from: peer,
      to: peer,
      text: "x",
      contentType: "NONE",
      isMyMessage: false,
    })),
  );
  try {
    const first = await executeTool(token, "get_messages", { accountId: "a", chatMid: peer });
    expect(history.mock.calls[0]?.slice(0, 3)).toEqual(["a", peer, 15]);
    const data = first.structuredContent?.data as { nextCursor: string };
    expect(data.nextCursor).toBeString();
    await executeTool(token, "get_messages", {
      accountId: "a",
      chatMid: peer,
      cursor: data.nextCursor,
    });
    expect(history.mock.calls[1]?.[3]).toMatchObject({
      beforeMessageId: "16",
      beforeDeliveredTime: 1000,
    });
    expect(
      (
        await executeTool({ ...token, accountIds: ["a", "b"] }, "get_messages", {
          accountId: "b",
          chatMid: peer,
          cursor: data.nextCursor,
        })
      ).isError,
    ).toBe(true);
    expect(history).toHaveBeenCalledTimes(2);
  } finally {
    history.mockRestore();
  }
});
test("stored history and missed calls stay isolated, paginate ties and honor time bounds", async () => {
  const make = (id: string, result: string) => ({
    id,
    chatMid: peer,
    savedAt: new Date().toISOString(),
    from: peer,
    to: peer,
    createdTime: 1000,
    text: id,
    contentType: "CALL",
    isMyMessage: false,
    contentMetadata: { RESULT: result },
  });
  await store.upsertMessages("a", peer, [
    make("10", "CANCELED"),
    make("9", "SUCCESS"),
    make("8", "FAIL"),
  ]);
  await store.upsertMessages("b", peer, [make("99", "CANCELED")]);
  const first = await executeTool(token, "get_missed_calls", { accountId: "a", limit: 2 });
  const data = first.structuredContent?.data as { messages: { id: string }[]; nextCursor: string };
  expect(data.messages.map((m) => m.id)).toEqual(["10"]);
  const next = await executeTool(token, "get_missed_calls", {
    accountId: "a",
    limit: 2,
    cursor: data.nextCursor,
  });
  expect((next.structuredContent?.data as typeof data).messages.map((m) => m.id)).toEqual(["8"]);
  const empty = await executeTool(token, "search_messages", { accountId: "a", fromTime: 1001 });
  expect((empty.structuredContent?.data as typeof data).messages).toEqual([]);
});
test("image upload uses binary BFF contract and download returns native MCP image", async () => {
  const png = Buffer.from("89504e470d0a1a0a", "hex");
  const fetch = spyOn(lineRouter, "fetch").mockImplementation(async (request) => {
    const r = request as Request;
    if (r.method === "POST") {
      expect(r.headers.get("x-vyline-chat-mid")).toBe(peer);
      expect(r.headers.get("x-vyline-media-filename")).toBe("test.png");
      expect(Buffer.from(await r.arrayBuffer())).toEqual(png);
      return Response.json({ ok: true });
    }
    return new Response(png, {
      headers: { "content-type": "image/png", "content-range": "bytes 0-7/8" },
    });
  });
  try {
    expect(
      (
        await executeTool(token, "send_image", {
          accountId: "a",
          chatMid: peer,
          source: { dataBase64: png.toString("base64") },
          mimeType: "image/png",
          filename: "test.png",
        })
      ).isError,
    ).toBe(false);
    expect(
      (
        await executeTool(token, "download_media", {
          accountId: "a",
          chatMid: peer,
          messageId: "10",
        })
      ).content[0]?.type,
    ).toBe("image");
  } finally {
    fetch.mockRestore();
  }
});
test("upload rejects private/untrusted URLs and bounded reads refuse oversized streams", async () => {
  for (const url of [
    "http://127.0.0.1/",
    "https://localhost/",
    "https://example.com/",
    "https://files.oaiusercontent.com@127.0.0.1/",
    "https://files.oaiusercontent.com:444/",
  ])
    expect(() => allowedUploadUrl(url)).toThrow();
  await expect(readBounded(new Response("12345"), 4)).rejects.toThrow();
});
test("media pagination handles both Range and full-body upstreams without skipping bytes", async () => {
  const first = await readMediaSlice(new Response("abcdef"), 0, 3);
  expect(first.bytes.toString()).toBe("abc");
  expect(first.more).toBe(true);
  const next = await readMediaSlice(new Response("abcdef"), 3, 3);
  expect(next.bytes.toString()).toBe("def");
  expect(next.more).toBe(false);
  const ranged = await readMediaSlice(
    new Response("def", { status: 206, headers: { "content-range": "bytes 3-5/6" } }),
    3,
    3,
  );
  expect(ranged.bytes.toString()).toBe("def");
  expect(ranged.more).toBe(false);
});
test("server-wide operations remain discoverable but require explicit admin scope", async () => {
  const request = spyOn(lineRouter, "fetch").mockImplementation(() => Response.json({ ok: true }));
  try {
    expect(listTools(token).some((t) => t.name === "set_server_proxy")).toBe(true);
    const args = { accountId: "a", enabled: false, url: "" };
    expect((await executeTool(token, "set_server_proxy", args)).isError).toBe(true);
    expect(request).not.toHaveBeenCalled();
    expect(
      (
        await executeTool(
          { ...token, scopes: ["read", "write", "admin"] },
          "set_server_proxy",
          args,
        )
      ).isError,
    ).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
  } finally {
    request.mockRestore();
  }
});
test("parallel friend lookups for identical names use their own account clients", async () => {
  const clients = spyOn(manager, "getClient").mockImplementation(
    (account) =>
      ({
        fetchUsers: async () => [
          {
            mid: account === "a" ? peer : "u22222222222222222222222222222222",
            raw: { targetProfileDetail: { profileName: "同名の友人" } },
          },
        ],
      }) as never,
  );
  try {
    const [a, b] = await Promise.all([
      executeTool(token, "list_friends", { accountId: "a", query: "同名" }),
      executeTool({ ...token, accountIds: ["b"] }, "list_friends", {
        accountId: "b",
        query: "同名",
      }),
    ]);
    expect(JSON.stringify(a)).toContain(peer);
    expect(JSON.stringify(a)).not.toContain("u22222222222222222222222222222222");
    expect(JSON.stringify(b)).not.toContain(peer);
    expect(JSON.stringify(b)).toContain("u22222222222222222222222222222222");
  } finally {
    clients.mockRestore();
  }
});
test("container supervisor terminates the sibling process on failure and handles spawn errors", async () => {
  const { supervise } = await import("./supervisor.js");
  const start = Date.now();
  expect(
    await supervise([
      [process.execPath, "-e", "setTimeout(() => process.exit(7), 30)"],
      [process.execPath, "-e", "setInterval(() => {}, 1000)"],
    ]),
  ).toBe(7);
  await expect(
    supervise([
      [process.execPath, "-e", "setInterval(() => {}, 1000)"],
      ["vyline-test-nonexistent-binary"],
    ]),
  ).rejects.toThrow();
  expect(Date.now() - start).toBeLessThan(5000);
});
test("real SDK client initializes, lists tools, calls tools and observes token revocation", async () => {
  const created = await createToken("plugin", ["a"], ["read", "write"]);
  const host = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (r) => chatgptRouter.fetch(r) });
  const client = new Client({ name: "plugin-test", version: "1" });
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${host.port}/mcp`),
    { requestInit: { headers: { authorization: `Bearer ${created.token}` } } },
  );
  try {
    expect((await fetch(`http://127.0.0.1:${host.port}/mcp`)).status).toBe(401);
    // SDK 1.30 declares the implementation's optional sessionId wider than Transport.
    await client.connect(transport as Transport);
    expect((await client.listTools()).tools.some((t) => t.name === "send_message")).toBe(true);
    const result = await client.callTool({ name: "list_accounts", arguments: {} });
    expect(JSON.stringify(result)).toContain('"accountId":"a"');
    expect(JSON.stringify(result)).not.toContain('"accountId":"b"');
    await revokeToken(created.token!);
    await expect(client.listTools()).rejects.toThrow();
  } finally {
    await client.close();
    host.stop(true);
  }
});

test("deployment setup creates and rotates scoped grants without printing secrets; plugin binding uses the registered app ID", async () => {
  const cliDir = join(directory, "cli");
  const env = { ...process.env, VYLINE_DATA_DIR: cliDir };
  const run = async (args: string[]) => {
    const child = Bun.spawn([process.execPath, ...args], { env, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(code, stderr).toBe(0);
    return stdout;
  };
  await run([
    "-e",
    `const { saveToken } = await import(${JSON.stringify(new URL("../storage/tokenStore.ts", import.meta.url).href)}); await saveToken("demo", "synthetic-test-credential", { displayName: "Demo" });`,
  ]);
  const setup = fileURLToPath(new URL("./setup.ts", import.meta.url));
  const args = [
    setup,
    "--accounts",
    "demo",
    "--tunnel-id",
    "tunnel_0123456789abcdef0123456789abcdef",
    "--server-admin",
  ];
  const stdout = await run(args);
  const first = await readFile(join(cliDir, "chatgpt", "authorization"), "utf8");
  expect(stdout).not.toContain(first.slice(7));
  expect(stdout).not.toContain("synthetic-test-credential");
  expect(JSON.parse(stdout).scopes).toEqual(["read", "write", "admin"]);
  await run(args);
  const second = await readFile(join(cliDir, "chatgpt", "authorization"), "utf8");
  expect(second).not.toBe(first);
  const grants = JSON.parse(await readFile(join(cliDir, "api-tokens.json"), "utf8"));
  expect(grants).toHaveLength(1);
  expect(grants[0].accountIds).toEqual(["demo"]);
  const profile = Bun.YAML.parse(
    await readFile(join(cliDir, "chatgpt", "tunnel.yaml"), "utf8"),
  ) as { mcp: { extra_headers: { Authorization: string } } };
  expect(profile.mcp.extra_headers.Authorization).toBe("file:/app/data/chatgpt/authorization");
  await run([setup, "--revoke"]);
  expect(JSON.parse(await readFile(join(cliDir, "api-tokens.json"), "utf8"))).toEqual([]);

  const plugin = fileURLToPath(new URL("../../../integrations/vyline-chatgpt/", import.meta.url));
  const copy = join(directory, "vyline-chatgpt");
  await cp(plugin, copy, { recursive: true });
  await run([join(copy, "bind-plugin.ts"), "plugin_asdk_app_test"]);
  expect(JSON.parse(await readFile(join(copy, ".app.json"), "utf8"))).toEqual({
    apps: { vyline: { id: "plugin_asdk_app_test" } },
  });
  expect(
    JSON.parse(await readFile(join(copy, ".codex-plugin", "plugin.json"), "utf8")),
  ).toHaveProperty("apps", "./.app.json");
});
