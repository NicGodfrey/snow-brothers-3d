#!/usr/bin/env node
/**
 * Claude Code MCP (stdio) adapter for official lucy slots.
 * Default target is lucy04. Speaks MCP, not Anthropic /v1/messages.
 */
const base = (process.env.AGI_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const token = process.env.AGI_CONTROL_TOKEN ?? "";
const defaultTarget = process.env.LUCY_TARGET ?? "lucy04";
const defaultConversation =
  process.env.LUCY_CONVERSATION_ID ?? "claude-code-lucy04";

const TOOLS = [
  {
    name: "ask_lucy",
    description:
      "Ask official Cursor Cloud Agent lucy (default lucy04) a question through the AGI control plane. Use this whenever the user wants lucy04 or an official lucy reply. Not an Anthropic Messages API.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "User question" },
        conversationId: {
          type: "string",
          description: `Pin the same lucy across turns. Default ${defaultConversation}`,
        },
        target: {
          type: "string",
          description: `Official lucy name. Default ${defaultTarget}`,
        },
        fast: {
          type: "boolean",
          description: "true = no tools (simple chat). false = allow tools.",
        },
      },
      required: ["question"],
    },
  },
  {
    name: "lucy_pool",
    description: "Show idle/busy official lucy slots and whether lucy04 is free.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "lucy_transcript",
    description: "Read the stored conversation turns for a lucy conversationId.",
    inputSchema: {
      type: "object",
      properties: {
        conversationId: {
          type: "string",
          description: `Default ${defaultConversation}`,
        },
      },
    },
  },
];

async function handle(message) {
  if (!message || message.jsonrpc !== "2.0") return;
  if (message.method && message.id === undefined) return;
  if (message.id === undefined) return;

  try {
    if (message.method === "initialize") {
      write({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "lucy04", version: "1.0.0" },
        },
      });
      return;
    }
    if (message.method === "ping") {
      write({ jsonrpc: "2.0", id: message.id, result: {} });
      return;
    }
    if (message.method === "tools/list") {
      write({ jsonrpc: "2.0", id: message.id, result: { tools: TOOLS } });
      return;
    }
    if (message.method === "tools/call") {
      const name = String(message.params?.name ?? "");
      const args = message.params?.arguments ?? {};
      const text = await callTool(name, args);
      write({
        jsonrpc: "2.0",
        id: message.id,
        result: { content: [{ type: "text", text }], isError: false },
      });
      return;
    }
    write({
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32601, message: `Unknown method ${message.method}` },
    });
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (message.method === "tools/call") {
      write({
        jsonrpc: "2.0",
        id: message.id,
        result: { content: [{ type: "text", text }], isError: true },
      });
      return;
    }
    write({
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32000, message: text },
    });
  }
}

async function callTool(name, args) {
  if (name === "lucy_pool") {
    const body = await agi("GET", "/v1/lucy/pool");
    return JSON.stringify(body, null, 2);
  }
  if (name === "lucy_transcript") {
    const id = String(args.conversationId ?? defaultConversation);
    const body = await agi("GET", `/v1/lucy/conversations/${encodeURIComponent(id)}`);
    return JSON.stringify(body, null, 2);
  }
  if (name !== "ask_lucy") throw new Error(`Unknown tool ${name}`);
  const question = String(args.question ?? "").trim();
  if (!question) throw new Error("question is required");
  const body = await agi("POST", "/v1/lucy/ask", {
    question,
    stream: false,
    pool: "official",
    target: String(args.target ?? defaultTarget),
    conversationId: String(args.conversationId ?? defaultConversation),
    ...(typeof args.fast === "boolean" ? { fast: args.fast } : {}),
  });
  return [
    `lucy: ${body.lucyName ?? defaultTarget}`,
    `status: ${body.status}`,
    `latency: ${body.latency ?? "?"}`,
    `runId: ${body.runId ?? ""}`,
    `conversationId: ${body.conversationId ?? ""}`,
    "",
    body.answer || body.error || JSON.stringify(body),
  ].join("\n");
}

async function agi(method, path, body) {
  const headers = { accept: "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { error: text.slice(0, 400) };
  }
  if (!res.ok) {
    const err = parsed.error ?? parsed;
    throw new Error(
      typeof err === "string" ? err : err.message ?? `HTTP ${res.status} ${path}`,
    );
  }
  return parsed;
}

function write(message) {
  const json = JSON.stringify(message);
  const payload = Buffer.from(json, "utf8");
  process.stdout.write(`Content-Length: ${payload.length}\r\n\r\n`);
  process.stdout.write(payload);
}

let buf = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
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
    const body = buf.subarray(start, start + length).toString("utf8");
    buf = buf.subarray(start + length);
    void handle(JSON.parse(body));
  }
});
process.stdin.on("end", () => process.exit(0));
process.stdin.resume();
