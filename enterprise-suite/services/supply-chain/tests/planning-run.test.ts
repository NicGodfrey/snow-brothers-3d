import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { createTenantContext } from "@enterprise-suite/shared-kernel";
import { FixedClock } from "../src/infrastructure/clock.js";
import { createSupplyChainModule, type SupplyChainModule } from "../src/infrastructure/module.js";
import { locationCode } from "../src/domain/types.js";
import { SupplyChainEvents } from "../src/domain/events.js";

/**
 * Bike factory fixture, planned from Wed 2026-08-12 (horizon starts Mon
 * 2026-08-10, weekly buckets t0.., 8 weeks):
 *
 *   FG-BIKE   (MAKE, LT 7d, LOT_FOR_LOT)  = 2x CMP-WHEEL + 1x CMP-FRAME
 *   CMP-WHEEL (MAKE, LT 7d, FOQ 100)      = 0.5x RM-ALU
 *   CMP-FRAME (BUY,  LT 14d, LFL, supplier SUP-ACME @ 25/week)
 *   RM-ALU    (BUY,  LT 7d, LFL)
 */
const DC = locationCode("DC-EAST");
const ctx = createTenantContext("tenant-a", "planner-1", ["planner"]);

async function seedBikeFactory(module: SupplyChainModule): Promise<void> {
  await module.items.createItem(ctx, {
    sku: "FG-BIKE",
    description: "City bike",
    procurementType: "MAKE",
    leadTimeDays: 7,
    bom: [
      { componentSku: "CMP-WHEEL", qtyPer: 2 },
      { componentSku: "CMP-FRAME", qtyPer: 1 },
    ],
  });
  await module.items.createItem(ctx, {
    sku: "CMP-WHEEL",
    description: "Wheel assembly",
    procurementType: "MAKE",
    leadTimeDays: 7,
    lotSizing: { type: "FIXED_ORDER_QTY", fixedQty: 100 },
    bom: [{ componentSku: "RM-ALU", qtyPer: 0.5 }],
  });
  await module.items.createItem(ctx, {
    sku: "CMP-FRAME",
    description: "Frame",
    procurementType: "BUY",
    leadTimeDays: 14,
    preferredSupplierId: "SUP-ACME",
    standardCostMinor: 4500,
    currency: "USD",
  });
  await module.items.createItem(ctx, {
    sku: "RM-ALU",
    description: "Aluminium tube",
    procurementType: "BUY",
    leadTimeDays: 7,
  });

  const forecast = await module.forecasts.createForecast(ctx, {
    sku: "FG-BIKE",
    location: DC,
    entries: [
      { weekStart: "2026-08-24", qty: 40 },
      { weekStart: "2026-08-31", qty: 40 },
      { weekStart: "2026-09-07", qty: 40 },
    ],
  });
  await module.forecasts.publishForecast(ctx, forecast.id);

  await module.atp.upsertInventory(ctx, { sku: "FG-BIKE", location: DC, onHandQty: 50 });
  await module.atp.upsertInventory(ctx, { sku: "CMP-WHEEL", location: DC, onHandQty: 30 });
  await module.atp.upsertInventory(ctx, { sku: "RM-ALU", location: DC, onHandQty: 200 });

  await module.atp.addScheduledReceipt(ctx, {
    sku: "CMP-FRAME",
    location: DC,
    dueDate: "2026-08-25",
    qty: 20,
    sourceType: "PURCHASE_ORDER",
    sourceRef: "PO-1001",
  });

  await module.capacity.createCalendar(ctx, { supplierId: "SUP-ACME", defaultWeeklyCapacity: 25 });

  // Committed customer demand consumes the FG-BIKE forecast of its week.
  await module.atp.createAllocation(ctx, {
    sku: "FG-BIKE",
    location: DC,
    qty: 10,
    needDate: "2026-08-26",
    demandRef: "SO-778",
  });
}

describe("planning run (multi-level MRP end to end)", () => {
  let module: SupplyChainModule;

  beforeEach(async () => {
    module = createSupplyChainModule({ clock: new FixedClock(new Date("2026-08-12T08:00:00Z")) });
    await seedBikeFactory(module);
  });

  it("plans all levels, explodes BOM demand and audits every step", async () => {
    const run = await module.planning.createRun(ctx, { location: DC, horizonWeeks: 8 });
    const executed = await module.planning.executeRun(ctx, run.id);

    assert.equal(executed.status, "COMPLETED");
    assert.deepEqual(
      { itemsPlanned: executed.stats?.itemsPlanned, orders: executed.stats?.ordersCreated, levels: executed.stats?.levelsProcessed },
      { itemsPlanned: 4, orders: 6, levels: 3 },
    );

    const plans = await module.supplyPlans.listPlans(ctx, { runId: run.id });
    const bySku = new Map(plans.map((p) => [p.sku, p]));

    // FG-BIKE: forecast 40/40/40 with 10 consumed by the allocation in t2;
    // 50 on hand covers t2 fully, then two production orders.
    const bike = bySku.get("FG-BIKE")!;
    assert.deepEqual(
      bike.rows.map((r) => r.grossRequirement).slice(0, 5),
      [0, 0, 40, 40, 40],
      "allocation must consume the forecast, not add to it",
    );
    assert.deepEqual(
      bike.orders.map((o) => ({ type: o.orderType, qty: o.qty, due: o.dueDate, release: o.releaseDate })),
      [
        { type: "PRODUCTION", qty: 30, due: "2026-08-31", release: "2026-08-24" },
        { type: "PRODUCTION", qty: 40, due: "2026-09-07", release: "2026-08-31" },
      ],
    );

    // CMP-WHEEL: dependent demand 60@t2 / 80@t3, FOQ 100.
    const wheel = bySku.get("CMP-WHEEL")!;
    assert.deepEqual(
      wheel.rows.map((r) => r.grossRequirement).slice(0, 5),
      [0, 0, 60, 80, 0],
    );
    assert.deepEqual(wheel.orders.map((o) => o.qty), [100, 100]);

    // CMP-FRAME: dependent demand 30@t2 / 40@t3, PO for 20 due t2,
    // purchase orders priced from the item standard cost.
    const frame = bySku.get("CMP-FRAME")!;
    assert.deepEqual(frame.orders.map((o) => ({ type: o.orderType, qty: o.qty, supplier: o.supplierId })), [
      { type: "PURCHASE", qty: 10, supplier: "SUP-ACME" },
      { type: "PURCHASE", qty: 40, supplier: "SUP-ACME" },
    ]);
    assert.equal(frame.orders[1].estimatedCost?.amountMinor, 40 * 4500);
    const overload = frame.exceptions.find((e) => e.code === "SUPPLIER_CAPACITY_OVERLOAD");
    assert.ok(overload, "40 units in one week exceed the 25/week supplier calendar");
    assert.equal(overload.weekStart, "2026-08-31");

    // RM-ALU: 200 on hand covers the exploded 50/50 - no orders.
    const alu = bySku.get("RM-ALU")!;
    assert.deepEqual(
      alu.rows.map((r) => r.grossRequirement).slice(0, 4),
      [0, 50, 50, 0],
    );
    assert.equal(alu.orders.length, 0);

    // Audit trail captures scope, per-item results and the capacity warning.
    const audit = executed.audit;
    assert.ok(audit.length >= 8);
    assert.equal(audit[0].message, "Planning run started");
    assert.ok(audit.some((e) => e.message === "Item scope resolved"));
    assert.ok(audit.some((e) => e.level === "WARN" && /exceed supplier SUP-ACME capacity/.test(e.message)));
    assert.ok(audit.some((e) => e.message === "Planned CMP-WHEEL" && (e.context as { level: number }).level === 1));
    assert.equal(audit.at(-1)?.message, "Planning run completed");
    assert.ok(audit.every((e, i) => e.seq === i + 1), "audit entries must be strictly sequenced");

    // Events for downstream contexts.
    assert.equal(module.outbox.eventsOfType(SupplyChainEvents.PlanningRunStarted).length, 1);
    assert.equal(module.outbox.eventsOfType(SupplyChainEvents.PlanningRunCompleted).length, 1);
    assert.equal(module.outbox.eventsOfType(SupplyChainEvents.SupplyPlanCreated).length, 4);
  });

  it("treats firmed planned orders as committed supply in the next run", async () => {
    const run1 = await module.planning.createRun(ctx, { location: DC, horizonWeeks: 8 });
    await module.planning.executeRun(ctx, run1.id);
    const frame1 = (await module.supplyPlans.listPlans(ctx, { runId: run1.id })).find((p) => p.sku === "CMP-FRAME")!;
    assert.equal(frame1.orders.length, 2);

    // Planner pins the 40-unit order; regeneration must not recreate it.
    const bigOrder = frame1.orders.find((o) => o.qty === 40)!;
    await module.supplyPlans.firmOrder(ctx, frame1.id, bigOrder.orderId);
    assert.equal(module.outbox.eventsOfType(SupplyChainEvents.PlannedOrderFirmed).length, 1);

    const run2 = await module.planning.createRun(ctx, { location: DC, horizonWeeks: 8 });
    await module.planning.executeRun(ctx, run2.id);
    const frame2 = (await module.supplyPlans.listPlans(ctx, { runId: run2.id })).find((p) => p.sku === "CMP-FRAME")!;
    assert.deepEqual(frame2.orders.map((o) => o.qty), [10], "firmed 40 now appears as scheduled receipt");
    assert.equal(frame2.rows[3].scheduledReceipts, 40);
  });

  it("scopes runs to selected items plus their BOM closure", async () => {
    const run = await module.planning.createRun(ctx, {
      location: DC,
      horizonWeeks: 8,
      scope: { type: "ITEMS", skus: ["CMP-WHEEL"] },
    });
    const executed = await module.planning.executeRun(ctx, run.id);
    const plans = await module.supplyPlans.listPlans(ctx, { runId: run.id });
    assert.deepEqual(plans.map((p) => p.sku).sort(), ["CMP-WHEEL", "RM-ALU"]);
    assert.equal(executed.stats?.itemsPlanned, 2);
  });

  it("marks the run FAILED with an audit trail when planning is impossible", async () => {
    const run = await module.planning.createRun(ctx, {
      location: DC,
      horizonWeeks: 8,
      scope: { type: "ITEMS", skus: ["NO-SUCH-SKU"] },
    });
    await assert.rejects(() => module.planning.executeRun(ctx, run.id), /zero active items/);
    const failed = await module.planning.getRun(ctx, run.id);
    assert.equal(failed.status, "FAILED");
    assert.ok(failed.audit.some((e) => e.level === "ERROR" && /zero active items/.test(e.message)));
    assert.equal(module.outbox.eventsOfType(SupplyChainEvents.PlanningRunFailed).length, 1);
  });

  it("releasing a purchase order emits the procurement hand-off event", async () => {
    const run = await module.planning.createRun(ctx, { location: DC, horizonWeeks: 8 });
    await module.planning.executeRun(ctx, run.id);
    const frame = (await module.supplyPlans.listPlans(ctx, { runId: run.id })).find((p) => p.sku === "CMP-FRAME")!;
    const order = frame.orders[0];

    const released = await module.supplyPlans.releaseOrder(ctx, frame.id, order.orderId);
    assert.equal(released.status, "RELEASED");
    const events = module.outbox.eventsOfType(SupplyChainEvents.PlannedOrderReleased);
    assert.equal(events.length, 1);
    const payload = events[0].payload as { sku: string; orderType: string; supplierId: string | null };
    assert.equal(payload.sku, "CMP-FRAME");
    assert.equal(payload.orderType, "PURCHASE");
    assert.equal(payload.supplierId, "SUP-ACME");

    // Lifecycle guards: released orders cannot be cancelled or re-firmed here.
    await assert.rejects(() => module.supplyPlans.cancelOrder(ctx, frame.id, order.orderId), /RELEASED/);
    await assert.rejects(() => module.supplyPlans.firmOrder(ctx, frame.id, order.orderId), /only PLANNED/);
  });
});
