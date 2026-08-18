import assert from "node:assert/strict";
import { test } from "node:test";
import { assertBindAuth } from "../src/http/bind.ts";
import { startServer } from "../src/http/server.ts";
import { AgiError } from "../src/errors.ts";
import { createPlane } from "../src/plane.ts";
import { parseSseText } from "../src/sse.ts";
import { loadConfig } from "../src/config.ts";

function plane(overrides: Parameters<typeof createPlane>[0] = {}) {
  return createPlane({
    transport: "mock",
    port: 0,
    bind: "127.0.0.1",
    apiKey: undefined,
    lucyMockDelayMs: 0,
    streamHeartbeatMs: 0,
    ...overrides,
  });
}

async function serve(overrides: Parameters<typeof createPlane>[0] = {}) {
  const control = plane(overrides);
  const server = await startServer(control);
  return { control, server };
}

test("health reports the lucy pool and remote ask streams tokens", async () => {
  const { server } = await serve();
  try {
    const health = await fetch(`${server.url}/health`);
    assert.equal(health.status, 200);
    const body = (await health.json()) as {
      lucy: { copies: { idle: number; total: number }; streamIdleTimeoutMs: number };
    };
    assert.equal(body.lucy.copies.total, 11);
    assert.equal(body.lucy.copies.idle, 11);
    assert.equal(body.lucy.streamIdleTimeoutMs, 300_000);

    const ask = await fetch(`${server.url}/v1/lucy/ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "Reply with ready." }),
    });
    assert.equal(ask.status, 200);
    assert.match(ask.headers.get("content-type") ?? "", /text\/event-stream/);
    const events = parseSseText(await ask.text());
    const names = events.map((e) => e.event);
    assert.ok(names.includes("meta"));
    assert.ok(names.includes("delta"));
    assert.ok(names.includes("result"));
    assert.ok(names.includes("done"));
    const meta = JSON.parse(events.find((e) => e.event === "meta")!.data) as {
      lucy: { name: string };
    };
    assert.match(meta.lucy.name, /^(lucy|lucy-copy-\d+)$/);
  } finally {
    await server.close();
  }
});

test("large single-shot question is accepted; oversized body is rejected", async () => {
  const { server } = await serve({ maxBodyBytes: 8_000 });
  try {
    const large = await fetch(`${server.url}/v1/lucy/ask`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        question: `Q${"x".repeat(4_000)}`,
        stream: false,
      }),
    });
    assert.equal(large.status, 200);
    const job = (await large.json()) as { status: string; answer: string };
    assert.equal(job.status, "succeeded");
    assert.ok(job.answer.length > 0);

    const huge = await fetch(`${server.url}/v1/lucy/ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "y".repeat(20_000) }),
    });
    assert.equal(huge.status, 413);
    const err = (await huge.json()) as { error: { code: string } };
    assert.equal(err.error.code, "payload_too_large");
  } finally {
    await server.close();
  }
});

test("stream idle timeout aborts when no model tokens arrive", async () => {
  const { server } = await serve({
    lucyFulfill: "queue",
    streamIdleTimeoutMs: 60,
    streamHeartbeatMs: 15,
  });
  try {
    const started = Date.now();
    const ask = await fetch(`${server.url}/v1/lucy/ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "wait for stall" }),
    });
    const text = await ask.text();
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= 40, `stalled too fast: ${elapsed}ms`);
    assert.ok(elapsed < 800, `stalled too slow: ${elapsed}ms`);
    const events = parseSseText(text);
    const error = events.find((e) => e.event === "error");
    assert.ok(error);
    assert.match(error.data, /stream_idle_timeout/);
    const done = JSON.parse(events.find((e) => e.event === "done")!.data) as {
      status: string;
    };
    assert.equal(done.status, "aborted");
    const heartbeats = events.filter((e) => e.event === "heartbeat");
    assert.ok(heartbeats.length >= 1);
  } finally {
    await server.close();
  }
});

test("token inject resets the stall timer and can complete the job", async () => {
  const { server } = await serve({
    lucyFulfill: "queue",
    streamIdleTimeoutMs: 80,
    streamHeartbeatMs: 0,
  });
  try {
    const askP = fetch(`${server.url}/v1/lucy/ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "stream me" }),
    });
    await sleep(35);
    const pending = await fetch(`${server.url}/v1/lucy/pending`);
    const listed = (await pending.json()) as { items: { id: string }[] };
    assert.equal(listed.items.length, 1);
    const id = listed.items[0]!.id;
    await fetch(`${server.url}/v1/lucy/jobs/${id}/tokens`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "hello " }),
    });
    await sleep(35);
    await fetch(`${server.url}/v1/lucy/jobs/${id}/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "hello world" }),
    });
    const events = parseSseText(await (await askP).text());
    assert.equal(
      JSON.parse(events.find((e) => e.event === "done")!.data).status,
      "succeeded",
    );
    assert.ok(events.some((e) => e.event === "delta"));
  } finally {
    await server.close();
  }
});

test("conversationId pins the same lucy across turns", async () => {
  const { server } = await serve();
  try {
    const first = await fetch(`${server.url}/v1/lucy/ask`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        question: "remember ALPHA",
        stream: false,
        conversationId: "conv-pin",
        target: "lucy-copy-03",
      }),
    });
    const a = (await first.json()) as { lucyName: string; conversationId: string };
    assert.equal(a.lucyName, "lucy-copy-03");
    const second = await fetch(`${server.url}/v1/lucy/ask`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        question: "what did I say?",
        stream: false,
        conversationId: "conv-pin",
      }),
    });
    const b = (await second.json()) as { lucyName: string };
    assert.equal(b.lucyName, "lucy-copy-03");
  } finally {
    await server.close();
  }
});

test("official stream retries after stream_unavailable", async () => {
  const { control, server } = await serve({
    lucyPool: "official",
    lucyFulfill: "official",
  });
  try {
    (control.transport as import("../src/cursor/mock.ts").MockCursorClient).streamUnavailableOnce =
      true;
    const ask = await fetch(`${server.url}/v1/lucy/ask`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        question: "LIVE OK",
        stream: false,
        pool: "official",
      }),
    });
    assert.equal(ask.status, 200);
    const job = (await ask.json()) as { status: string; answer: string };
    assert.equal(job.status, "succeeded");
    assert.match(job.answer, /LIVE OK/);
  } finally {
    await server.close();
  }
});

test("busy official lucy failsover to another idle slot", async () => {
  const { control, server } = await serve({
    lucyPool: "official",
    lucyFulfill: "official",
  });
  try {
    const busyId = control.registry.get("lucy02").agentId!;
    (control.transport as import("../src/cursor/mock.ts").MockCursorClient).busyIds.add(
      busyId,
    );
    const ask = await fetch(`${server.url}/v1/lucy/ask`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        question: "failover please",
        stream: false,
        pool: "official",
        target: "lucy02",
        failover: true,
      }),
    });
    assert.equal(ask.status, 200);
    const job = (await ask.json()) as { status: string; lucyName: string };
    assert.equal(job.status, "succeeded");
    assert.notEqual(job.lucyName, "lucy02");
  } finally {
    await server.close();
  }
});

test("lucy cancel, artifacts, and usage hang off the official job", async () => {
  const { control, server } = await serve({
    lucyPool: "official",
    lucyFulfill: "official",
  });
  try {
    const transport = control.transport as import("../src/cursor/mock.ts").MockCursorClient;
    transport.autoFinish = false;
    transport.holdStream = true;
    transport.latencyMs = 0;
    const askP = fetch(`${server.url}/v1/lucy/ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        question: "cancel me",
        pool: "official",
        conversationId: "conv-cancel",
      }),
    });
    await sleep(20);
    const jobs = (await (await fetch(`${server.url}/v1/lucy/jobs`)).json()) as {
      items: { id: string }[];
    };
    const id = jobs.items[0]!.id;
    const artifacts = await fetch(`${server.url}/v1/lucy/jobs/${id}/artifacts`);
    assert.equal(artifacts.status, 200);
    const usage = await fetch(`${server.url}/v1/lucy/jobs/${id}/usage`);
    assert.equal(usage.status, 200);
    const cancel = await fetch(`${server.url}/v1/lucy/jobs/${id}/cancel`, {
      method: "POST",
    });
    assert.equal(cancel.status, 200);
    const events = parseSseText(await (await askP).text());
    assert.ok(events.some((e) => e.event === "error"));
    const listed = await fetch(`${server.url}/v1/lucy/conversations`);
    const convos = (await listed.json()) as { items: { id: string }[] };
    assert.ok(convos.items.some((c) => c.id === "conv-cancel"));
  } finally {
    await server.close();
  }
});

test("lucy conversation transcript and tool_call events", async () => {
  const { control, server } = await serve({
    lucyPool: "official",
    lucyFulfill: "official",
  });
  try {
    (control.transport as import("../src/cursor/mock.ts").MockCursorClient).streamToolCall =
      true;
    const ask = await fetch(`${server.url}/v1/lucy/ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        question: "read the readme",
        pool: "official",
        conversationId: "conv-tools",
      }),
    });
    const events = parseSseText(await ask.text());
    assert.ok(events.some((e) => e.event === "tool_call"));
    const transcript = await fetch(`${server.url}/v1/lucy/conversations/conv-tools`);
    assert.equal(transcript.status, 200);
    const body = (await transcript.json()) as {
      items: { role: string; text: string }[];
    };
    assert.ok(body.items.some((t) => t.role === "user"));
    assert.ok(body.items.some((t) => t.role === "assistant"));
  } finally {
    await server.close();
  }
});

test("official simple ask skips the old 800ms attach delay", async () => {
  const { server } = await serve({
    lucyPool: "official",
    lucyFulfill: "official",
  });
  try {
    const started = Date.now();
    const ask = await fetch(`${server.url}/v1/lucy/ask`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        question: "LIVE OK",
        stream: false,
        pool: "official",
      }),
    });
    const elapsed = Date.now() - started;
    assert.equal(ask.status, 200);
    const job = (await ask.json()) as {
      status: string;
      latency: string;
      answer: string;
    };
    assert.equal(job.status, "succeeded");
    assert.equal(job.latency, "fast");
    assert.match(job.answer, /LIVE OK/);
    assert.ok(elapsed < 300, `simple official ask too slow: ${elapsed}ms`);
  } finally {
    await server.close();
  }
});

test("official pool streams through createRun + streamRun", async () => {
  const { server } = await serve({
    lucyPool: "official",
    lucyFulfill: "official",
  });
  try {
    const ask = await fetch(`${server.url}/v1/lucy/ask`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        question: "LIVE OK",
        stream: false,
        pool: "official",
      }),
    });
    assert.equal(ask.status, 200);
    const job = (await ask.json()) as {
      status: string;
      kind: string;
      fulfill: string;
      lucyName: string;
      answer: string;
    };
    assert.equal(job.status, "succeeded");
    assert.equal(job.kind, "official");
    assert.equal(job.fulfill, "official");
    assert.match(job.lucyName, /^lucy\d+$/);
    assert.match(job.answer, /LIVE OK/);
  } finally {
    await server.close();
  }
});

test("remote bind without a control token is rejected", () => {
  assert.throws(
    () => assertBindAuth({ bind: "0.0.0.0", controlToken: undefined }),
    (err: unknown) => err instanceof AgiError && err.code === "remote_auth_required",
  );
  assertBindAuth({ bind: "127.0.0.1", controlToken: undefined });
  assertBindAuth({ bind: "0.0.0.0", controlToken: "secret" });
});

test("bearer token is required when configured", async () => {
  const { server } = await serve({ controlToken: "secret-token" });
  try {
    const denied = await fetch(`${server.url}/v1/lucy/pool`);
    assert.equal(denied.status, 401);
    const ok = await fetch(`${server.url}/v1/lucy/pool`, {
      headers: { authorization: "Bearer secret-token" },
    });
    assert.equal(ok.status, 200);
  } finally {
    await server.close();
  }
});

test("CLAUDE_STREAM_IDLE_TIMEOUT_MS is accepted as an alias", () => {
  const prev = process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS;
  const agi = process.env.AGI_STREAM_IDLE_TIMEOUT_MS;
  process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS = "300000";
  delete process.env.AGI_STREAM_IDLE_TIMEOUT_MS;
  try {
    assert.equal(loadConfig().streamIdleTimeoutMs, 300_000);
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS;
    else process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS = prev;
    if (agi === undefined) delete process.env.AGI_STREAM_IDLE_TIMEOUT_MS;
    else process.env.AGI_STREAM_IDLE_TIMEOUT_MS = agi;
  }
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
