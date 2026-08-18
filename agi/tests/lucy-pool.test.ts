import assert from "node:assert/strict";
import { test } from "node:test";
import { AgiError } from "../src/errors.ts";
import { loadLucyCopies } from "../src/lucy/copies.ts";
import { LucyPool } from "../src/lucy/pool.ts";
import { FleetRegistry } from "../src/registry.ts";

function pool(rng: () => number = Math.random): LucyPool {
  return new LucyPool(loadLucyCopies(), new FleetRegistry(), rng);
}

test("lucy copies include original lucy plus ten idle copies", () => {
  const copies = loadLucyCopies();
  assert.equal(copies.length, 11);
  assert.equal(copies[0]?.name, "lucy");
  assert.equal(copies[0]?.agentId, "bc-9a1ae0da-1b80-5fe3-985e-94bc5ea1f3eb");
  assert.equal(copies.at(-1)?.name, "lucy-copy-10");
  assert.ok(copies.every((s) => s.status === "idle" && s.kind === "copy"));
});

test("pickIdle randomly selects among idle lucys only", () => {
  let i = 0;
  const values = [0, 0.99, 0.5];
  const lucy = pool(() => values[i++ % values.length]!);
  const first = lucy.pickIdle("copy")!;
  const last = lucy.pickIdle("copy")!;
  const mid = lucy.pickIdle("copy")!;
  assert.equal(first.name, "lucy");
  assert.equal(last.name, "lucy-copy-10");
  assert.equal(mid.name, "lucy-copy-05");
  lucy.acquire({ pool: "copies", conversationId: "c1", target: "lucy-copy-01" });
  const names = new Set<string>();
  for (let n = 0; n < 30; n += 1) {
    const hit = lucy.pickIdle("copy");
    assert.ok(hit);
    assert.notEqual(hit.name, "lucy-copy-01");
    names.add(hit.name);
  }
  assert.ok(names.size >= 2);
});

test("acquire fails when every copy is busy", () => {
  const lucy = pool();
  for (const slot of lucy.copies) {
    lucy.acquire({ pool: "copies", conversationId: `c-${slot.name}`, target: slot.name });
  }
  assert.equal(lucy.pickIdle("copy"), null);
  assert.throws(
    () => lucy.acquire({ pool: "copies", conversationId: "overflow" }),
    (err: unknown) => err instanceof AgiError && err.status === 503,
  );
});

test("official pick prefers a recently released warm slot", () => {
  const lucy = pool(() => 0.99);
  const first = lucy.acquire({
    pool: "official",
    conversationId: "warm-1",
    target: "lucy02",
  });
  lucy.release(first.name, "official");
  const picked = lucy.pickIdle("official");
  assert.equal(picked?.name, "lucy02");
  assert.equal(lucy.snapshot().official.warm, 1);
});

test("conversation reuses the same idle lucy", () => {
  const lucy = pool(() => 0);
  const first = lucy.acquire({ pool: "copies", conversationId: "conv-a" });
  lucy.release(first.name, "copy");
  const second = lucy.acquire({ pool: "copies", conversationId: "conv-a" });
  assert.equal(second.name, first.name);
});
