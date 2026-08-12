import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tenantId } from "@enterprise-suite/shared-kernel";
import { workCenterId } from "../src/domain/ids.js";
import { Routing } from "../src/domain/routing.js";

const tenant = tenantId("tenant-a");
const wc = workCenterId("wc_test1");

function draftRouting(): Routing {
  const routing = Routing.create(tenant, { sku: "widget-100", revision: "A" });
  routing.addOperation({
    seq: 10,
    description: "Mill",
    workCenterId: wc,
    setupMinutes: 30,
    runMinutesPerUnit: 2,
  });
  routing.addOperation({
    seq: 20,
    description: "Assemble",
    workCenterId: wc,
    setupMinutes: 15,
    runMinutesPerUnit: 1,
    teardownMinutes: 15,
    queueMinutes: 60,
    moveMinutes: 10,
  });
  routing.pullEvents();
  return routing;
}

describe("Routing", () => {
  it("normalizes sku, keeps operations sorted by seq, defaults revision A", () => {
    const routing = draftRouting();
    assert.equal(routing.sku, "WIDGET-100");
    assert.equal(routing.revision, "A");
    assert.deepEqual(
      routing.operations.map((op) => op.seq),
      [10, 20],
    );
  });

  it("rejects duplicate sequences and zero-time operations", () => {
    const routing = draftRouting();
    assert.throws(
      () =>
        routing.addOperation({
          seq: 10,
          description: "Dup",
          workCenterId: wc,
          runMinutesPerUnit: 1,
        }),
      /already exists/,
    );
    assert.throws(
      () =>
        routing.addOperation({
          seq: 30,
          description: "No time",
          workCenterId: wc,
          runMinutesPerUnit: 0,
        }),
      /setup, run, or teardown/,
    );
  });

  it("updates and removes operations while DRAFT only", () => {
    const routing = draftRouting();
    routing.updateOperation(10, { runMinutesPerUnit: 3 });
    assert.equal(routing.operations[0]!.runMinutesPerUnit, 3);
    routing.removeOperation(20);
    assert.equal(routing.operations.length, 1);

    routing.release();
    assert.throws(() => routing.updateOperation(10, { setupMinutes: 5 }), /is RELEASED/);
    assert.throws(() => routing.removeOperation(10), /is RELEASED/);
    assert.throws(
      () =>
        routing.addOperation({
          seq: 30,
          description: "Late",
          workCenterId: wc,
          runMinutesPerUnit: 1,
        }),
      /is RELEASED/,
    );
  });

  it("refuses to release an empty routing and to release twice", () => {
    const empty = Routing.create(tenant, { sku: "EMPTY-1" });
    assert.throws(() => empty.release(), /no operations/);

    const routing = draftRouting();
    routing.release();
    assert.throws(() => routing.release(), /is RELEASED/);
  });

  it("obsoletes released routings but not drafts", () => {
    const routing = draftRouting();
    assert.throws(() => routing.makeObsolete(), /Draft routings/);
    routing.release();
    routing.makeObsolete();
    assert.equal(routing.status, "OBSOLETE");
  });

  it("estimates lead time as queue + setup + run*qty + teardown + move", () => {
    const routing = draftRouting();
    // op10: 0 + 30 + 2*10 + 0 + 0 = 50
    // op20: 60 + 15 + 1*10 + 15 + 10 = 110
    assert.equal(routing.estimateLeadTimeMinutes(10), 160);
    assert.throws(() => routing.estimateLeadTimeMinutes(0), /positive/);
  });

  it("emits lifecycle events with the mes.routing prefix", () => {
    const routing = Routing.create(tenant, { sku: "EVT-1" });
    routing.addOperation({
      seq: 10,
      description: "Op",
      workCenterId: wc,
      runMinutesPerUnit: 1,
    });
    routing.release();
    const types = routing.pullEvents().map((e) => e.eventType);
    assert.deepEqual(types, [
      "mes.routing.created",
      "mes.routing.operation-added",
      "mes.routing.released",
    ]);
  });
});
