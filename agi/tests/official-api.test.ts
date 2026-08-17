import assert from "node:assert/strict";
import { test } from "node:test";
import { MockCursorClient } from "../src/cursor/mock.ts";
import { startServer } from "../src/http/server.ts";
import { createPlane } from "../src/plane.ts";
import { parseSseText } from "../src/sse.ts";

async function serve() {
  const plane = createPlane({
    transport: "mock",
    port: 0,
    bind: "127.0.0.1",
    apiKey: undefined,
    lucyMockDelayMs: 0,
    streamHeartbeatMs: 0,
  });
  const server = await startServer(plane);
  return { plane, server };
}

test("official metadata, agent lifecycle, runs, usage, and artifacts", async () => {
  const { plane, server } = await serve();
  try {
    const caps = await fetch(`${server.url}/v1/capabilities`);
    assert.equal(caps.status, 200);
    const body = (await caps.json()) as {
      officialCoverage: string;
      official: Record<string, string>;
      extra120: Record<string, string>;
    };
    assert.equal(body.officialCoverage, "120%");
    assert.ok(body.official["GET /v0/private-workers/pending-requests"]);
    assert.ok(body.extra120["GET /v1/agents/:id/conversation"]);

    const me = await fetch(`${server.url}/v1/me`);
    assert.equal(me.status, 200);
    const models = await fetch(`${server.url}/v1/models`);
    assert.equal(models.status, 200);
    const repos = await fetch(`${server.url}/v1/repositories`);
    assert.equal(repos.status, 200);

    const created = await fetch(`${server.url}/v1/agents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "demo",
        prompt: { text: "hello official" },
        skipReviewerRequest: true,
        customSubagents: [
          { name: "reviewer", description: "review", prompt: "review" },
        ],
      }),
    });
    assert.equal(created.status, 200);
    const createdBody = (await created.json()) as {
      agent: { id: string };
      run: { id: string };
    };
    const id = createdBody.agent.id;
    assert.equal(
      (plane.transport as MockCursorClient).lastCreate?.skipReviewerRequest,
      true,
    );

    const listed = await fetch(`${server.url}/v1/agents`);
    const items = (await listed.json()) as { items: { id: string }[] };
    assert.ok(items.items.some((a) => a.id === id));

    const one = await fetch(`${server.url}/v1/agents/${id}`);
    assert.equal(one.status, 200);

    const run = await fetch(`${server.url}/v1/agents/${id}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: {
          text: "follow up",
          images: [{ url: "https://example.com/a.png", mimeType: "image/png" }],
        },
        mode: "agent",
      }),
    });
    assert.equal(run.status, 200);
    const runBody = (await run.json()) as { run: { id: string } };
    assert.ok(runBody.run.id);
    assert.equal(
      (plane.transport as MockCursorClient).lastRun?.images?.length,
      1,
    );

    const usage = await fetch(`${server.url}/v1/agents/${id}/usage`);
    assert.equal(usage.status, 200);
    const artifacts = await fetch(`${server.url}/v1/agents/${id}/artifacts`);
    assert.equal(artifacts.status, 200);
    const download = await fetch(
      `${server.url}/v1/agents/${id}/artifacts/download?path=artifacts/upload.txt`,
    );
    assert.equal(download.status, 200);

    const convo = await fetch(`${server.url}/v1/agents/${id}/conversation`);
    assert.equal(convo.status, 200);
    const convoBody = (await convo.json()) as { items: { runId: string }[] };
    assert.ok(convoBody.items.length >= 1);

    const waited = await fetch(
      `${server.url}/v1/agents/${id}/runs/${runBody.run.id}/wait`,
    );
    assert.equal(waited.status, 200);

    const archive = await fetch(`${server.url}/v1/agents/${id}/archive`, {
      method: "POST",
    });
    assert.equal(archive.status, 200);
    const hidden = await fetch(
      `${server.url}/v1/agents?includeArchived=false`,
    );
    const hiddenBody = (await hidden.json()) as { items: { id: string }[] };
    assert.ok(!hiddenBody.items.some((a) => a.id === id));
    const unarchive = await fetch(`${server.url}/v1/agents/${id}/unarchive`, {
      method: "POST",
    });
    assert.equal(unarchive.status, 200);
    const unarchiveBody = (await unarchive.json()) as { id: string };
    assert.equal(unarchiveBody.id, id);

    const workers = await fetch(`${server.url}/v0/private-workers`);
    assert.equal(workers.status, 200);
    const pending = await fetch(
      `${server.url}/v0/private-workers/pending-requests`,
    );
    assert.equal(pending.status, 200);
    const pendingBody = (await pending.json()) as { requests: unknown[] };
    assert.ok(Array.isArray(pendingBody.requests));
    const claim = await fetch(`${server.url}/v0/private-workers/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bcId: "bc-1", workerId: "pw_1" }),
    });
    assert.equal(claim.status, 200);
    const claimBody = (await claim.json()) as { bcId: string; workerId: string };
    assert.equal(claimBody.bcId, "bc-1");
    const pools = await fetch(`${server.url}/v0/private-workers/pools`);
    assert.equal(pools.status, 200);
    const gone = await fetch(`${server.url}/v0/private-workers/pools`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: "team", poolName: "sandbox" }),
    });
    assert.equal(gone.status, 200);
    const goneBody = (await gone.json()) as { deregistered: boolean };
    assert.equal(goneBody.deregistered, true);

    const removed = await fetch(`${server.url}/v1/agents/${id}`, {
      method: "DELETE",
    });
    assert.equal(removed.status, 200);
  } finally {
    await server.close();
  }
});

test("official stream can be cancelled", async () => {
  const { plane, server } = await serve();
  try {
    const id = plane.registry.get("lucy02").agentId!;
    const transport = plane.transport as MockCursorClient;
    transport.latencyMs = 0;
    transport.autoFinish = false;
    const run = await plane.transport.createRun(id, "slow");
    const cancel = await fetch(
      `${server.url}/v1/agents/${id}/runs/${run.id}/cancel`,
      { method: "POST" },
    );
    assert.equal(cancel.status, 200);
    const got = await plane.transport.getRun(id, run.id);
    assert.equal(got.status, "CANCELLED");
  } finally {
    await server.close();
  }
});

test("official stream honors Last-Event-ID and emits status", async () => {
  const { plane, server } = await serve();
  try {
    const id = plane.registry.get("lucy02").agentId!;
    (plane.transport as MockCursorClient).latencyMs = 0;
    const run = await plane.transport.createRun(id, "ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    const first = await fetch(
      `${server.url}/v1/agents/${id}/runs/${run.id}/stream`,
    );
    assert.equal(first.headers.get("x-cursor-stream-retention-seconds"), "86400");
    const events = parseSseText(await first.text());
    assert.equal(events[0]?.event, "status");
    const assistant = events.filter((e) => e.event === "assistant");
    assert.ok(assistant.length >= 2);
    const resumeId = assistant[0]!.id;
    assert.ok(resumeId);

    const resumed = await fetch(
      `${server.url}/v1/agents/${id}/runs/${run.id}/stream`,
      { headers: { "Last-Event-ID": resumeId } },
    );
    const later = parseSseText(await resumed.text());
    const laterAssistant = later.filter((e) => e.event === "assistant");
    assert.ok(laterAssistant.length < assistant.length);
    assert.ok(!laterAssistant.some((e) => e.id === resumeId));
  } finally {
    await server.close();
  }
});

test("official image validation rejects more than five images", async () => {
  const { plane, server } = await serve();
  try {
    const id = plane.registry.get("lucy02").agentId!;
    const bad = await fetch(`${server.url}/v1/agents/${id}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: {
          text: "too many",
          images: Array.from({ length: 6 }, (_, i) => ({
            url: `https://example.com/${i}.png`,
            mimeType: "image/png",
          })),
        },
      }),
    });
    assert.equal(bad.status, 400);
    const err = (await bad.json()) as { error: { code: string } };
    assert.equal(err.error.code, "too_many_images");
  } finally {
    await server.close();
  }
});

test("Basic control token is accepted the official way", async () => {
  const plane = createPlane({
    transport: "mock",
    port: 0,
    bind: "127.0.0.1",
    controlToken: "official-token",
    apiKey: undefined,
  });
  const server = await startServer(plane);
  try {
    const denied = await fetch(`${server.url}/v1/me`);
    assert.equal(denied.status, 401);
    const basic = Buffer.from("official-token:").toString("base64");
    const ok = await fetch(`${server.url}/v1/me`, {
      headers: { authorization: `Basic ${basic}` },
    });
    assert.equal(ok.status, 200);
  } finally {
    await server.close();
  }
});
