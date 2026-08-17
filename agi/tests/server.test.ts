import assert from "node:assert/strict";
import { test } from "node:test";
import { startServer } from "../src/http/server.ts";
import { createPlane } from "../src/plane.ts";

test("health and ask endpoints serve Q&A over HTTP", async () => {
  const plane = createPlane({
    transport: "mock",
    port: 0,
    bind: "127.0.0.1",
    apiKey: undefined,
  });
  const server = await startServer(plane);
  try {
    const health = await fetch(`${server.url}/health`);
    assert.equal(health.status, 200);
    const body = (await health.json()) as { ok: boolean; transport: string };
    assert.equal(body.ok, true);
    assert.equal(body.transport, "mock");

    const ask = await fetch(`${server.url}/v1/ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        question: "Reply with the word ready.",
        target: "lucy",
      }),
    });
    assert.equal(ask.status, 200);
    const job = (await ask.json()) as { status: string; assignments: { answer?: string }[] };
    assert.equal(job.status, "succeeded");
    assert.ok(job.assignments[0]?.answer);
  } finally {
    await server.close();
  }
});
