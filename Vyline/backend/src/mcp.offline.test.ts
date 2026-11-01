import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";

test("stdio MCP exposes only read-only Vyline tools and lists accounts offline", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "vyline-mcp-offline-"));
  const proc = Bun.spawn([process.execPath, "src/mcp.ts"], {
    cwd: join(import.meta.dir, ".."),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      NODE_ENV: "test",
      VYLINE_DATA_DIR: dataDir,
      VYLINE_MCP: "1",
    },
  });
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buffered = "";

  const readMessage = async (): Promise<Record<string, any>> => {
    while (!buffered.includes("\n")) {
      const { done, value } = await reader.read();
      if (done) throw new Error("MCP process closed stdout before replying");
      buffered += decoder.decode(value, { stream: true });
    }
    const newline = buffered.indexOf("\n");
    const line = buffered.slice(0, newline);
    buffered = buffered.slice(newline + 1);
    return JSON.parse(line) as Record<string, any>;
  };

  const send = async (message: unknown) => {
    proc.stdin.write(`${JSON.stringify(message)}\n`);
    await proc.stdin.flush();
  };

  try {
    await send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "offline-test", version: "1.0.0" },
      },
    });
    const initialized = await readMessage();
    expect(initialized.id).toBe(1);
    expect(initialized.result.serverInfo.name).toBe("vyline");
    await send({ jsonrpc: "2.0", method: "notifications/initialized" });
    await send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const toolList = await readMessage();
    const tools = toolList.result.tools as Array<{ name: string }>;
    expect(tools.map((tool) => tool.name)).toEqual([
      "list_accounts",
      "get_profile",
      "get_contact_profile",
      "list_chats",
      "get_chat_history",
      "get_read_receipts",
    ]);
    expect(tools.some((tool) => /send|mark.?read|revoke/i.test(tool.name))).toBe(false);

    await send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "list_accounts", arguments: {} },
    });
    const accountResult = await readMessage();
    expect(accountResult.result.content[0].text).toBe("[]");
    expect(proc.exitCode).toBeNull();
  } finally {
    proc.kill();
    await proc.exited;
    await rm(dataDir, { recursive: true, force: true });
  }
});
