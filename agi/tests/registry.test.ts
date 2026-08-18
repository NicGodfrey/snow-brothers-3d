import assert from "node:assert/strict";
import { test } from "node:test";
import { FleetRegistry } from "../src/registry.ts";
import { slotName } from "../src/seed.ts";

test("fleet has 101 named slots", () => {
  const fleet = new FleetRegistry();
  assert.equal(fleet.slots.length, 101);
  assert.equal(fleet.slots[0]?.name, "lucy");
  assert.equal(fleet.slots[1]?.name, "lucy01");
  assert.equal(fleet.slots[100]?.name, "lucy100");
  assert.equal(slotName(20), "lucy20");
});

test("only official idle slots are dispatchable", () => {
  const fleet = new FleetRegistry();
  const names = fleet.dispatchable().map((s) => s.name);
  assert.ok(names.includes("lucy02"));
  assert.ok(names.includes("lucy18"));
  assert.equal(names.includes("lucy"), false);
  assert.equal(names.includes("lucy01"), false);
  assert.equal(fleet.get("lucy").source, "legacy");
  assert.equal(fleet.get("lucy21").status, "unprovisioned");
  assert.equal(fleet.dispatchable().length, 10);
});
