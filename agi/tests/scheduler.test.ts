import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../src/config.ts";
import { MockCursorClient } from "../src/cursor/mock.ts";
import { FleetRegistry } from "../src/registry.ts";
import { Scheduler } from "../src/scheduler.ts";
import { buildSeedSlots } from "../src/seed.ts";

function plane(maxInFlight = 100): Scheduler {
  const slots = buildSeedSlots();
  const registry = new FleetRegistry(slots);
  const transport = new MockCursorClient(
    registry.slots.map((s) => s.agentId).filter((id): id is string => Boolean(id)),
  );
  transport.latencyMs = 0;
  return new Scheduler(registry, transport, loadConfig({ maxInFlight, transport: "mock" }));
}

test("ask routes a single idle worker and returns an answer", async () => {
  const scheduler = plane();
  const job = await scheduler.submit({
    question: "What is the Stage 1 cheese quota?",
    target: "lucy02",
  });
  assert.equal(job.status, "succeeded");
  assert.equal(job.assignments.length, 1);
  assert.match(job.assignments[0]!.answer ?? "", /lucy02|quota|Stage/);
  assert.equal(job.intent, "game");
});

test("fanout and debate produce synthesized multi-agent answers", async () => {
  const scheduler = plane();
  const fanout = await scheduler.submit({
    question: "Name one risk in the cat AI.",
    mode: "fanout",
    n: 4,
  });
  assert.equal(fanout.status, "succeeded");
  assert.equal(fanout.assignments.length, 4);
  assert.match(fanout.synthesis ?? "", /Received 4 answers/);

  const debate = await scheduler.submit({
    question: "Should chaseSpeed stay below mouse walk speed?",
    mode: "debate",
  });
  assert.equal(debate.assignments.length, 2);
  assert.equal(debate.status, "succeeded");
});

test("100 concurrent asks stay within the admission cap", async () => {
  const scheduler = plane(100);
  const jobs = await Promise.all(
    Array.from({ length: 100 }, (_, i) =>
      scheduler.submit({
        question: `Ping ${i} from the AGI control plane.`,
        mode: "ask",
      }),
    ),
  );
  assert.equal(jobs.length, 100);
  assert.ok(jobs.every((j) => j.status === "succeeded"));
  assert.ok(scheduler.global.peak <= 100);
  assert.equal(scheduler.global.inFlight, 0);
});

test("provision fills unprovisioned slots on the mock transport", async () => {
  const scheduler = plane();
  const before = scheduler.registry.dispatchable().length;
  const job = await scheduler.provision(5);
  assert.equal(job.status, "succeeded");
  assert.equal(scheduler.registry.dispatchable().length, before + 5);
  assert.equal(scheduler.registry.get("lucy").status, "idle");
  assert.equal(scheduler.registry.get("lucy").source, "official");
  assert.ok(scheduler.registry.get("lucy").agentId?.startsWith("bc-mock-"));
});

test("fresh session archives the previous agent and starts a new conversation", async () => {
  const scheduler = plane();
  const first = await scheduler.submit({
    question: "Remember the token ALPHA.",
    target: "lucy02",
  });
  const firstId = first.assignments[0]!.agentId;
  const second = await scheduler.submit({
    question: "What token did I just give you?",
    target: "lucy02",
  });
  const secondId = second.assignments[0]!.agentId;
  assert.notEqual(firstId, secondId);
  assert.equal(scheduler.registry.get("lucy02").agentId, secondId);
  const mock = scheduler.transport as MockCursorClient;
  assert.equal(mock.agents.get(firstId)!.archived, true);
  assert.equal(mock.agents.get(secondId)!.archived, false);
  assert.equal(mock.agents.get(secondId)!.history.length, 1);
});
