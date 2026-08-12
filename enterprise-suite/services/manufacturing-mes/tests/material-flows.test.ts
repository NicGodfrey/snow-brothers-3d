import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MesEvents } from "../src/domain/events.js";
import { seedPlant, testContainer, testContext, WIDGET_BOM } from "./helpers.js";

describe("Work order material flows (application services)", () => {
  async function setup() {
    const { container } = testContainer();
    const ctx = testContext();
    const plant = await seedPlant(container, ctx);
    const wo = await container.services.workOrders.create(ctx, {
      sku: "WIDGET-100",
      quantity: 10,
      uom: "EA",
      dueDate: "2026-08-14",
      demandSource: { type: "SALES_ORDER", refId: "so_1" },
      bomLines: WIDGET_BOM,
    });
    return { container, ctx, plant, wo };
  }

  it("creates orders with sequential numbers and exploded requirements", async () => {
    const { container, ctx, wo } = await setup();
    assert.equal(wo.orderNumber, "WO-000001");
    const second = await container.services.workOrders.create(ctx, {
      sku: "WIDGET-100",
      quantity: 1,
      uom: "EA",
      dueDate: "2026-08-21",
      bomLines: [],
    });
    assert.equal(second.orderNumber, "WO-000002");
    const housing = wo.requirements.find((r) => r.componentSku === "CMP-HOUSING")!;
    assert.equal(housing.requiredQty, 11); // 10 * 1 * 1.10
  });

  it("refuses creation without a released routing", async () => {
    const { container, ctx } = await setup();
    await assert.rejects(
      container.services.workOrders.create(ctx, {
        sku: "UNKNOWN-SKU",
        quantity: 1,
        uom: "EA",
        dueDate: "2026-08-14",
      }),
      /No released routing/,
    );
  });

  it("issues, returns and receipts update the order and emit events", async () => {
    const { container, ctx, wo } = await setup();
    const { workOrders, materials } = container.services;
    await workOrders.release(ctx, wo.id);

    const issue = await materials.issueMaterials(ctx, wo.id, {
      warehouseCode: "wh-main",
      lines: [
        { componentSku: "CMP-HOUSING", qty: 11, uom: "EA", lotNumber: "LOT-7" },
        { componentSku: "CMP-COOLANT", qty: 2.5, uom: "L" },
      ],
    });
    assert.equal(issue.document.direction, "ISSUE");
    assert.equal(issue.document.toJSON().warehouseCode, "WH-MAIN");
    const housing = issue.workOrder.requirements.find((r) => r.componentSku === "CMP-HOUSING")!;
    assert.equal(housing.issuedQty, 11);

    // Over-return is rejected; partial return reduces issued qty.
    await assert.rejects(
      materials.returnMaterials(ctx, wo.id, {
        warehouseCode: "WH-MAIN",
        lines: [{ componentSku: "CMP-HOUSING", qty: 12, uom: "EA" }],
      }),
      /only 11 issued/,
    );
    const returned = await materials.returnMaterials(ctx, wo.id, {
      warehouseCode: "WH-MAIN",
      lines: [{ componentSku: "CMP-HOUSING", qty: 1, uom: "EA" }],
    });
    assert.equal(
      returned.workOrder.requirements.find((r) => r.componentSku === "CMP-HOUSING")!.issuedQty,
      10,
    );

    // Produce everything, then receive into stock.
    await workOrders.reportOperation(ctx, wo.id, { seq: 10, qtyGood: 10 });
    await workOrders.reportOperation(ctx, wo.id, { seq: 20, qtyGood: 10 });
    await assert.rejects(
      materials.postReceipt(ctx, wo.id, { qtyGood: 11, warehouseCode: "WH-FG" }),
      /only 10/,
    );
    const receipt = await materials.postReceipt(ctx, wo.id, {
      qtyGood: 10,
      warehouseCode: "WH-FG",
      lotNumber: "FG-LOT-1",
    });
    assert.equal(receipt.workOrder.quantityReceived, 10);

    const issued = container.outbox.ofType(MesEvents.MaterialIssued);
    const returnedEvents = container.outbox.ofType(MesEvents.MaterialReturned);
    const receipts = container.outbox.ofType(MesEvents.ProductionReceiptPosted);
    assert.equal(issued.length, 1);
    assert.equal(returnedEvents.length, 1);
    assert.equal(receipts.length, 1);
    const receiptPayload = receipts[0]!.payload as { sku: string; qtyGood: number };
    assert.equal(receiptPayload.sku, "WIDGET-100");
    assert.equal(receiptPayload.qtyGood, 10);
  });

  it("blocks issues to unreleased orders and unknown components", async () => {
    const { container, ctx, wo } = await setup();
    const { materials } = container.services;
    await assert.rejects(
      materials.issueMaterials(ctx, wo.id, {
        warehouseCode: "WH",
        lines: [{ componentSku: "CMP-HOUSING", qty: 1, uom: "EA" }],
      }),
      /is DRAFT/,
    );
    await container.services.workOrders.release(ctx, wo.id);
    await assert.rejects(
      materials.issueMaterials(ctx, wo.id, {
        warehouseCode: "WH",
        lines: [{ componentSku: "CMP-MYSTERY", qty: 1, uom: "EA" }],
      }),
      /not on the work order BOM/,
    );
    // With the unplanned flag it works and is marked as such on the document.
    const forced = await materials.issueMaterials(ctx, wo.id, {
      warehouseCode: "WH",
      lines: [{ componentSku: "CMP-MYSTERY", qty: 1, uom: "EA", unplanned: true }],
    });
    assert.equal(forced.document.lines[0]!.unplanned, true);
  });

  it("keeps shortages in sync as material is issued", async () => {
    const { container, ctx, wo } = await setup();
    const { workOrders, materials } = container.services;
    await workOrders.release(ctx, wo.id);
    let shortages = await workOrders.shortages(ctx, wo.id);
    assert.equal(shortages.length, 3);
    await materials.issueMaterials(ctx, wo.id, {
      warehouseCode: "WH",
      lines: [
        { componentSku: "CMP-HOUSING", qty: 11, uom: "EA" },
        { componentSku: "CMP-SCREW", qty: 30, uom: "EA" },
      ],
    });
    shortages = await workOrders.shortages(ctx, wo.id);
    assert.deepEqual(
      shortages.map((s) => [s.componentSku, s.shortQty]),
      [
        ["CMP-SCREW", 10], // 40 required - 30 issued
        ["CMP-COOLANT", 2.5],
      ],
    );
  });

  it("plans a work order backward from its due date on the plant calendar", async () => {
    const { container, ctx, wo } = await setup();
    const planned = await container.services.workOrders.plan(ctx, wo.id);
    assert.equal(planned.status, "PLANNED");
    // op10 worked = 30 + 2*10 = 50; op20 worked = 15 + 10 + 15 = 40.
    // Backward from Friday 16:00: op20 13:20->16:00... (op20 40min: 15:20).
    assert.equal(planned.scheduledEnd, "2026-08-14T16:00:00.000Z");
    assert.equal(planned.operations[1]!.scheduledStart, "2026-08-14T15:20:00.000Z");
    assert.equal(planned.scheduledStart, "2026-08-14T14:30:00.000Z");
    // Replanning while PLANNED is allowed.
    const replanned = await container.services.workOrders.plan(ctx, wo.id);
    assert.equal(replanned.status, "PLANNED");
  });

  it("falls back to forward scheduling when the due date is in the past", async () => {
    const { container, ctx } = await setup();
    const wo = await container.services.workOrders.create(ctx, {
      sku: "WIDGET-100",
      quantity: 10,
      uom: "EA",
      dueDate: "2026-07-01", // long past TODAY (2026-08-03)
      bomLines: [],
    });
    const planned = await container.services.workOrders.plan(ctx, wo.id);
    assert.ok(planned.scheduledStart! >= "2026-08-03T00:00:00.000Z");
    assert.ok(planned.scheduledEnd! > planned.scheduledStart!);
  });

  it("computes capacity and load for a work center", async () => {
    const { container, ctx, plant, wo } = await setup();
    await container.services.workOrders.plan(ctx, wo.id);
    const capacity = await container.services.capacity.workCenterCapacity(
      ctx,
      plant.cncId,
      "2026-08-10",
      "2026-08-16",
    );
    // CNC: 2 machines * 90% * 80% = 1.44 factor; 480 raw minutes Mon–Fri.
    assert.equal(capacity[0]!.calendarMinutes, 480);
    assert.equal(capacity[0]!.effectiveMinutes, 691);
    assert.equal(capacity[5]!.calendarMinutes, 0); // Saturday

    const load = await container.services.capacity.workCenterLoad(
      ctx,
      plant.cncId,
      "2026-08-10",
      "2026-08-16",
    );
    const friday = load.find((d) => d.date === "2026-08-14")!;
    assert.equal(friday.loadMinutes, 50); // op10 worked minutes
    assert.ok(friday.loadPct > 0);
  });
});
