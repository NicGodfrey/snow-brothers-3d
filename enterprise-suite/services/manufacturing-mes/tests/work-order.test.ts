import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tenantId } from "@enterprise-suite/shared-kernel";
import { qty, routingId, workCenterId } from "../src/domain/ids.js";
import type { RoutingOperation } from "../src/domain/routing.js";
import {
  canTransition,
  WORK_ORDER_STATUSES,
  WorkOrder,
  type CreateWorkOrderInput,
} from "../src/domain/work-order.js";

const tenant = tenantId("tenant-a");
const wc1 = workCenterId("wc_mill");
const wc2 = workCenterId("wc_assy");

function routingOps(): RoutingOperation[] {
  return [
    {
      seq: 10,
      description: "Mill",
      workCenterId: wc1,
      setupMinutes: 30,
      runMinutesPerUnit: 2,
      teardownMinutes: 0,
      queueMinutes: 0,
      moveMinutes: 0,
      inspectionRequired: false,
      crewSize: 1,
    },
    {
      seq: 20,
      description: "Assemble",
      workCenterId: wc2,
      setupMinutes: 15,
      runMinutesPerUnit: 1,
      teardownMinutes: 15,
      queueMinutes: 0,
      moveMinutes: 0,
      inspectionRequired: true,
      crewSize: 2,
    },
  ];
}

function createInput(overrides: Partial<CreateWorkOrderInput> = {}): CreateWorkOrderInput {
  return {
    orderNumber: "WO-000001",
    sku: "widget-100",
    routingId: routingId("rtg_1"),
    routingRevision: "A",
    routingOperations: routingOps(),
    quantityOrdered: 10,
    uom: "EA",
    dueDate: "2026-08-14",
    demandSource: { type: "SALES_ORDER", refId: "so_123" },
    bomLines: [
      { componentSku: "CMP-A", qtyPerUnit: 2, uom: "EA", scrapFactorPct: 10, operationSeq: 10 },
      { componentSku: "CMP-B", qtyPerUnit: 0.5, uom: "KG" },
    ],
    ...overrides,
  };
}

describe("WorkOrder creation", () => {
  it("explodes BOM lines with scrap factors into requirements", () => {
    const wo = WorkOrder.create(tenant, createInput());
    const byComponent = Object.fromEntries(wo.requirements.map((r) => [r.componentSku, r]));
    assert.equal(byComponent["CMP-A"]!.requiredQty, 22); // 10 * 2 * 1.10
    assert.equal(byComponent["CMP-A"]!.operationSeq, 10);
    assert.equal(byComponent["CMP-B"]!.requiredQty, 5); // 10 * 0.5
    assert.equal(byComponent["CMP-B"]!.operationSeq, null);
    assert.equal(wo.status, "DRAFT");
    assert.equal(wo.operations[0]!.status, "PENDING");
  });

  it("rejects BOM lines pointing at unknown operations or duplicated components", () => {
    assert.throws(
      () =>
        WorkOrder.create(
          tenant,
          createInput({
            bomLines: [{ componentSku: "CMP-X", qtyPerUnit: 1, uom: "EA", operationSeq: 99 }],
          }),
        ),
      /operationSeq 99 not in routing/,
    );
    assert.throws(
      () =>
        WorkOrder.create(
          tenant,
          createInput({
            bomLines: [
              { componentSku: "CMP-A", qtyPerUnit: 1, uom: "EA" },
              { componentSku: "cmp-a", qtyPerUnit: 2, uom: "EA" },
            ],
          }),
        ),
      /appears more than once/,
    );
  });

  it("requires positive quantity and at least one routing operation", () => {
    assert.throws(() => WorkOrder.create(tenant, createInput({ quantityOrdered: 0 })), /positive/);
    assert.throws(
      () => WorkOrder.create(tenant, createInput({ routingOperations: [] })),
      /at least one operation/,
    );
  });
});

describe("WorkOrder status machine", () => {
  it("encodes the legal transition table", () => {
    assert.ok(canTransition("DRAFT", "PLANNED"));
    assert.ok(canTransition("DRAFT", "RELEASED"));
    assert.ok(canTransition("PLANNED", "RELEASED"));
    assert.ok(canTransition("RELEASED", "IN_PROGRESS"));
    assert.ok(canTransition("IN_PROGRESS", "COMPLETED"));
    assert.ok(canTransition("COMPLETED", "CLOSED"));

    assert.ok(!canTransition("DRAFT", "IN_PROGRESS"));
    assert.ok(!canTransition("DRAFT", "COMPLETED"));
    assert.ok(!canTransition("RELEASED", "COMPLETED"));
    assert.ok(!canTransition("IN_PROGRESS", "CANCELLED"));
    assert.ok(!canTransition("COMPLETED", "IN_PROGRESS"));
    for (const status of WORK_ORDER_STATUSES) {
      assert.ok(!canTransition("CLOSED", status));
      assert.ok(!canTransition("CANCELLED", status));
    }
  });

  it("walks the happy path DRAFT -> ... -> CLOSED", () => {
    const wo = WorkOrder.create(tenant, createInput());
    wo.release();
    assert.equal(wo.status, "RELEASED");
    assert.equal(wo.operations[0]!.status, "READY");
    wo.start();
    wo.reportOperation({ seq: 10, qtyGood: 10 });
    wo.reportOperation({ seq: 20, qtyGood: 10 });
    wo.complete();
    assert.equal(wo.status, "COMPLETED");
    wo.recordReceipt(qty(10, "EA"));
    wo.close();
    assert.equal(wo.status, "CLOSED");
  });

  it("rejects illegal transitions with conflicts", () => {
    const wo = WorkOrder.create(tenant, createInput());
    assert.throws(() => wo.start(), /illegal transition DRAFT -> IN_PROGRESS/);
    assert.throws(() => wo.complete(), /not done/);
    wo.release();
    assert.throws(() => wo.release(), /illegal transition RELEASED -> RELEASED/);
  });

  it("hold and resume return to the held-from status", () => {
    const wo = WorkOrder.create(tenant, createInput());
    wo.release();
    wo.start();
    wo.hold("Material shortage");
    assert.equal(wo.status, "ON_HOLD");
    wo.resume();
    assert.equal(wo.status, "IN_PROGRESS");
    assert.throws(() => wo.resume(), /not on hold/);
  });

  it("cancel is blocked once production or issues exist", () => {
    const wo = WorkOrder.create(tenant, createInput());
    wo.release();
    wo.start();
    wo.reportOperation({ seq: 10, qtyGood: 1 });
    wo.hold("investigating defect");
    assert.throws(() => wo.cancel("mistake"), /reported production/);

    const wo2 = WorkOrder.create(tenant, createInput());
    wo2.release();
    wo2.recordMaterialIssue("CMP-A", qty(5, "EA"), false);
    assert.throws(() => wo2.cancel("mistake"), /issued materials/);
    wo2.recordMaterialReturn("CMP-A", qty(5, "EA"));
    wo2.cancel("mistake");
    assert.equal(wo2.status, "CANCELLED");
  });
});

describe("WorkOrder operation reporting", () => {
  function released(): WorkOrder {
    const wo = WorkOrder.create(tenant, createInput());
    wo.release();
    wo.start();
    wo.pullEvents();
    return wo;
  }

  it("caps the first operation at the ordered quantity", () => {
    const wo = released();
    assert.throws(() => wo.reportOperation({ seq: 10, qtyGood: 11 }), /exceeds available/);
    wo.reportOperation({ seq: 10, qtyGood: 10 });
    assert.equal(wo.operations[0]!.status, "DONE");
  });

  it("only lets downstream ops process what upstream completed", () => {
    const wo = released();
    assert.throws(() => wo.reportOperation({ seq: 20, qtyGood: 1 }), /not ready/);
    wo.reportOperation({ seq: 10, qtyGood: 4 });
    assert.equal(wo.operations[1]!.status, "READY");
    assert.throws(() => wo.reportOperation({ seq: 20, qtyGood: 5 }), /exceeds available/);
    wo.reportOperation({ seq: 20, qtyGood: 4 });
    // Upstream not DONE yet, so op20 must stay RUNNING even at parity.
    assert.equal(wo.operations[1]!.status, "RUNNING");
  });

  it("propagates scrap: downstream availability shrinks and totals accumulate", () => {
    const wo = released();
    wo.reportOperation({ seq: 10, qtyGood: 7, qtyScrap: 3 });
    assert.equal(wo.operations[0]!.status, "DONE"); // 7 + 3 = 10 ordered
    assert.equal(wo.quantityScrapped, 3);
    assert.throws(() => wo.reportOperation({ seq: 20, qtyGood: 8 }), /exceeds available/);
    wo.reportOperation({ seq: 20, qtyGood: 6, qtyScrap: 1 });
    assert.equal(wo.operations[1]!.status, "DONE");
    assert.equal(wo.quantityCompleted, 6);
    assert.equal(wo.quantityScrapped, 4);
    wo.complete();
    assert.equal(wo.status, "COMPLETED");
  });

  it("tracks labor and machine minutes per operation", () => {
    const wo = released();
    wo.reportOperation({ seq: 10, qtyGood: 5, laborMinutes: 45, machineMinutes: 40 });
    wo.reportOperation({ seq: 10, qtyGood: 5, laborMinutes: 50, machineMinutes: 42 });
    assert.equal(wo.operations[0]!.laborMinutesActual, 95);
    assert.equal(wo.operations[0]!.machineMinutesActual, 82);
  });

  it("blocks receipts beyond completed quantity and close with unreceived stock", () => {
    const wo = released();
    wo.reportOperation({ seq: 10, qtyGood: 10 });
    wo.reportOperation({ seq: 20, qtyGood: 10 });
    assert.throws(() => wo.recordReceipt(qty(11, "EA")), /only 10/);
    wo.recordReceipt(qty(6, "EA"));
    wo.complete();
    assert.throws(() => wo.close(), /not yet received/);
    wo.recordReceipt(qty(4, "EA"));
    wo.close();
    assert.equal(wo.quantityReceived, 10);
  });

  it("handles unplanned components and UoM mismatches on issue", () => {
    const wo = released();
    assert.throws(() => wo.recordMaterialIssue("CMP-NEW", qty(1, "EA"), false), /not on the work order BOM/);
    wo.recordMaterialIssue("CMP-NEW", qty(1, "EA"), true);
    const unplanned = wo.requirements.find((r) => r.componentSku === "CMP-NEW")!;
    assert.equal(unplanned.unplanned, true);
    assert.equal(unplanned.issuedQty, 1);
    assert.throws(() => wo.recordMaterialIssue("CMP-B", qty(1, "EA"), false), /UoM/);
    assert.throws(() => wo.recordMaterialReturn("CMP-NEW", qty(2, "EA")), /only 1 issued/);
  });

  it("reports shortages for planned lines only", () => {
    const wo = released();
    wo.recordMaterialIssue("CMP-A", qty(22, "EA"), false);
    wo.recordMaterialIssue("CMP-EXTRA", qty(3, "EA"), true);
    const shortages = wo.materialShortages();
    assert.deepEqual(shortages, [{ componentSku: "CMP-B", shortQty: 5, uom: "KG" }]);
  });
});
