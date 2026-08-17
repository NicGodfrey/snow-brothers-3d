#!/usr/bin/env node
/**
 * Remote SSE client for POST /v1/lucy/ask.
 * Large files: node scripts/lucy-chat.mjs --file prompt.txt
 */
const base = (process.env.AGI_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const token = process.env.AGI_CONTROL_TOKEN;
const args = process.argv.slice(2);
const fileIdx = args.indexOf("--file");
const poolIdx = args.indexOf("--pool");
const targetIdx = args.indexOf("--target");
const conversationIdx = args.indexOf("--conversation");

let question = args.filter((a, i) => {
  if (a.startsWith("--")) return false;
  if (i > 0 && args[i - 1]?.startsWith("--")) return false;
  return true;
}).join(" ");

if (fileIdx !== -1) {
  const { readFileSync } = await import("node:fs");
  const path = args[fileIdx + 1];
  if (!path) {
    console.error("usage: lucy-chat.mjs --file <path>");
    process.exit(1);
  }
  question = readFileSync(path, "utf8");
}

if (!question.trim()) {
  console.error("usage: lucy-chat.mjs <question> | --file <path>");
  process.exit(1);
}

const headers = { "content-type": "application/json", accept: "text/event-stream" };
if (token) headers.authorization = `Bearer ${token}`;

const body = {
  question,
  pool: poolIdx === -1 ? undefined : args[poolIdx + 1],
  target: targetIdx === -1 ? undefined : args[targetIdx + 1],
  conversationId: conversationIdx === -1 ? undefined : args[conversationIdx + 1],
};

const res = await fetch(`${base}/v1/lucy/ask`, {
  method: "POST",
  headers,
  body: JSON.stringify(body),
});

if (!res.ok || !res.body) {
  console.error(await res.text());
  process.exit(1);
}

const decoder = new TextDecoder();
let buf = "";
for await (const chunk of res.body) {
  buf += decoder.decode(chunk, { stream: true });
  let idx;
  while ((idx = buf.indexOf("\n\n")) !== -1) {
    const raw = buf.slice(0, idx);
    buf = buf.slice(idx + 2);
    let event = "message";
    const data = [];
    for (const line of raw.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    const payload = data.join("\n");
    if (event === "delta") {
      try {
        process.stdout.write(JSON.parse(payload).text ?? "");
      } catch {
        process.stdout.write(payload);
      }
    } else if (event === "error") {
      console.error(`\n[${event}] ${payload}`);
    } else if (event === "meta" || event === "done" || event === "result") {
      if (process.env.AGI_LUCY_VERBOSE) console.error(`\n[${event}] ${payload}`);
    }
  }
}
process.stdout.write("\n");
