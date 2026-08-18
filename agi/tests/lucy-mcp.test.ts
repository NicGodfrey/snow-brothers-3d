import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { startServer } from "../src/http/server.ts";
import { createPlane } from "../src/plane.ts";

function encode(message: object): Buffer {
  const json = JSON.stringify(message);
  return Buffer.from(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
}

async function withMcp(
  env: Record<string, string>,
  fn: (send: (msg: object) => Promise<unknown>) => Promise<void>,
): Promise<void> {
  const child = spawn(process.execPath, ["scripts/lucy-mcp.mjs"], {
    cwd: dirname(fileURLToPath(new URL("..", import.meta.url))),
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buf = Buffer.alloc(0);
  const pending: Array<(value: unknown) => void> = [];
  child.stdout.on("data", (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);
    while (true) {
      const headerEnd = buf.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const header = buf.subarray(0, headerEnd).toString("utf8");
      const match = header.match(/content-length:\s*(\d+)/i);
      if (!match) {
        buf = buf.subarray(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const start = headerEnd + 4;
      if (buf.length < start + length) return;
      const body = JSON.parse(buf.subarray(start, start + length).toString("utf8"));
      buf = buf.subarray(start + length);
      pending.shift()?.(body);
    }
  });
  const send = (msg: object): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("mcp timeout")), 8000);
      pending.push((value) => {
        clearTimeout(timer);
        resolve(value);
      });
      child.stdin.write(encode(msg));
    });
  try {
    await fn(send);
  } finally {
    child.kill("SIGTERM");
  }
}

test("lucy MCP initialize and tools/list", async () => {
  await withMcp({}, async (send) => {
    const init = (await send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test" } },
    })) as { result?: { serverInfo?: { name?: string } } };
    assert.equal(init.result?.serverInfo?.name, "lucy04");
    const listed = (await send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    })) as { result?: { tools?: { name: string }[] } };
    const names = (listed.result?.tools ?? []).map((t) => t.name);
    assert.deepEqual(names, ["ask_lucy", "lucy_pool", "lucy_transcript"]);
  });
});

test("lucy MCP ask_lucy pins lucy04 on the mock plane", async () => {
  const plane = createPlane({
    transport: "mock",
    port: 0,
    bind: "127.0.0.1",
    apiKey: undefined,
    lucyMockDelayMs: 0,
    streamHeartbeatMs: 0,
    lucyPool: "official",
    lucyFulfill: "official",
  });
  const server = await startServer(plane);
  try {
    await withMcp(
      { AGI_URL: server.url, LUCY_TARGET: "lucy04", LUCY_CONVERSATION_ID: "mcp-test" },
      async (send) => {
        await send({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test" } },
        });
        const asked = (await send({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "ask_lucy",
            arguments: { question: "Reply with LIVE OK" },
          },
        })) as { result?: { content?: { text?: string }[]; isError?: boolean } };
        assert.equal(asked.result?.isError, false);
        const text = asked.result?.content?.[0]?.text ?? "";
        assert.match(text, /lucy: lucy04/);
        assert.match(text, /LIVE OK/);
        const pool = (await send({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "lucy_pool", arguments: {} },
        })) as { result?: { content?: { text?: string }[] } };
        assert.match(pool.result?.content?.[0]?.text ?? "", /official/);
      },
    );
  } finally {
    await server.close();
  }
});
