import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MesEvents } from "../src/domain/events.js";
import { seedPlant, testContainer, testContext, WIDGET_BOM } from "./helpers.js";

describe("Scrap and rework", () => {
  async function setupInProgress() {
    const { container } = testContainer();
    const ctx = testContext();
    const plant = await seedPlant(container, ctx);
    const wo = await container.services.workOrders.create(ctx, {
      sku: "WIDGET-100",
      quantity: 20,
      uom: "EA",
      dueDate: "2026-08-21",
      bomLines: WIDGET_BOM,
    });
    await container.services.workOrders.release(ctx, wo.id);
    return { container, ctx, plant, wo };
  }

  it("requires a reason code when scrap is reported", async () => {
    const { container, ctx, wo } = await setupInProgress();
    await assert.rejects(
      container.services.workOrders.reportOperation(ctx, wo.id, {
        seq: 10,
        qtyGood: 5,
        qtyScrap: 2,
      }),
      /reasonCode/,
    );
    await assert.rejects(
      container.services.workOrders.reportOperation(ctx, wo.id, {
        seq: 10,
        qtyGood: 5,
        qtyScrap: 2,
        scrapReasonCode: "BAD_LUCK",
      }),
      /reasonCode/,
    );
  });

  it("creates a scrap record alongside the operation report", async () => {
    const { container, ctx, wo } = await setupInProgress();
    const { scrapRecord } = await container.services.workOrders.reportOperation(ctx, wo.id, {
      seq: 10,
      qtyGood: 15,
      qtyScrap: 5,
      scrapReasonCode: "MACHINE_FAULT",
      scrapDisposition: "REWORK",
      scrapNotes: "Spindle chatter on batch 2",
    });
    assert.ok(scrapRecord);
    assert.equal(scrapRecord.quantity, 5);
    assert.equal(scrapRecord.reasonCode, "MACHINE_FAULT");
    assert.equal(scrapRecord.disposition, "REWORK");

    const stored = await container.services.scrap.listForWorkOrder(ctx, wo.id);
    assert.equal(stored.length, 1);
    assert.equal(container.outbox.ofType(MesEvents.ScrapRecorded).length, 1);
  });

  it("spawns a rework order routing from the failed operation onward", async () => {
    const { container, ctx, wo } = await setupInProgress();
    // Scrap at op 20: rework must include only op 20.
    await container.services.workOrders.reportOperation(ctx, wo.id, { seq: 10, qtyGood: 20 });
    const { scrapRecord } = await container.services.workOrders.reportOperation(ctx, wo.id, {
      seq: 20,
      qtyGood: 16,
      qtyScrap: 4,
      scrapReasonCode: "OPERATOR_ERROR",
      scrapDisposition: "REWORK",
    });
    const { reworkOrder, scrapRecord: linked } = await container.services.scrap.createReworkOrder(
      ctx,
      scrapRecord!.id,
      { dueDate: "2026-08-28" },
    );
    assert.equal(reworkOrder.orderNumber, "WO-000002");
    assert.equal(reworkOrder.quantityOrdered, 4);
    assert.equal(reworkOrder.demandSource.type, "REWORK");
    assert.equal(reworkOrder.demandSource.refId, wo.id);
    assert.deepEqual(
      reworkOrder.operations.map((op) => op.seq),
      [20],
    );
    assert.equal(reworkOrder.requirements.length, 0); // components already consumed
    assert.equal(reworkOrder.priority, 7); // original 5 + 2 bump
    assert.equal(linked.reworkWorkOrderId, reworkOrder.id);
    assert.equal(container.outbox.ofType(MesEvents.ReworkOrderCreated).length, 1);

    // A second rework order from the same record is rejected.
    await assert.rejects(
      container.services.scrap.createReworkOrder(ctx, scrapRecord!.id),
      /already has a rework order/,
    );
  });

  it("only REWORK dispositions can spawn rework orders", async () => {
    const { container, ctx, wo } = await setupInProgress();
    const { scrapRecord } = await container.services.workOrders.reportOperation(ctx, wo.id, {
      seq: 10,
      qtyGood: 18,
      qtyScrap: 2,
      scrapReasonCode: "MATERIAL_DEFECT",
      scrapDisposition: "SCRAP",
    });
    await assert.rejects(
      container.services.scrap.createReworkOrder(ctx, scrapRecord!.id),
      /only REWORK records/,
    );
  });

  it("records standalone scrap and aggregates a summary", async () => {
    const { container, ctx, wo } = await setupInProgress();
    await container.services.workOrders.reportOperation(ctx, wo.id, {
      seq: 10,
      qtyGood: 10,
      qtyScrap: 3,
      scrapReasonCode: "MACHINE_FAULT",
    });
    await container.services.scrap.recordStandalone(ctx, {
      workOrderId: wo.id,
      operationSeq: 10,
      quantity: 2,
      reasonCode: "MACHINE_FAULT",
      disposition: "USE_AS_IS",
      notes: "Cosmetic only, accepted by QA waiver",
    });
    await container.services.scrap.recordStandalone(ctx, {
      workOrderId: wo.id,
      operationSeq: 10,
      quantity: 1,
      reasonCode: "HANDLING_DAMAGE",
    });
    const summary = await container.services.scrap.summary(ctx);
    assert.deepEqual(summary, [
      { reasonCode: "MACHINE_FAULT", disposition: "SCRAP", recordCount: 1, totalQty: 3 },
      { reasonCode: "MACHINE_FAULT", disposition: "USE_AS_IS", recordCount: 1, totalQty: 2 },
      { reasonCode: "HANDLING_DAMAGE", disposition: "SCRAP", recordCount: 1, totalQty: 1 },
    ]);
    const filtered = await container.services.scrap.list(ctx, { reasonCode: "HANDLING_DAMAGE" });
    assert.equal(filtered.length, 1);
  });

  it("standalone scrap validates the operation exists", async () => {
    const { container, ctx, wo } = await setupInProgress();
    await assert.rejects(
      container.services.scrap.recordStandalone(ctx, {
        workOrderId: wo.id,
        operationSeq: 99,
        quantity: 1,
        reasonCode: "OTHER",
      }),
      /no operation 99/,
    );
  });
});
