import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tenantId } from "@enterprise-suite/shared-kernel";
import { isoDate, makeWeeklyCalendar } from "../src/domain/calendar.js";
import { computeLowLevelCodes, itemsByLevel } from "../src/domain/low-level-code.js";
import { netItem } from "../src/domain/mrp.js";
import { PlanningItem } from "../src/domain/planning-item.js";

const calendar8 = makeWeeklyCalendar(isoDate("2026-08-10"), 8);

describe("MRP netting", () => {
  it("computes the textbook grid: gross, receipts, on-hand, net, planned orders", () => {
    const result = netItem({
      sku: "FG-BIKE",
      calendar: calendar8,
      onHand: 60,
      safetyStock: 0,
      leadTimeDays: 14, // 2 buckets
      lotSizing: { type: "LOT_FOR_LOT" },
      grossRequirements: [20, 30, 40, 10, 50, 0, 0, 0],
      scheduledReceipts: [0, 25, 0, 0, 0, 0, 0, 0],
    });

    assert.deepEqual(
      result.rows.map((r) => r.projectedOnHand),
      [40, 35, 0, 0, 0, 0, 0, 0],
    );
    assert.deepEqual(
      result.rows.map((r) => r.netRequirement),
      [0, 0, 5, 10, 50, 0, 0, 0],
    );
    assert.deepEqual(
      result.plannedOrders.map((o) => ({ qty: o.qty, due: o.dueDate, release: o.releaseDate, pastDue: o.pastDue })),
      [
        { qty: 5, due: "2026-08-24", release: "2026-08-10", pastDue: false },
        { qty: 10, due: "2026-08-31", release: "2026-08-17", pastDue: false },
        { qty: 50, due: "2026-09-07", release: "2026-08-24", pastDue: false },
      ],
    );
    assert.equal(result.exceptions.length, 0);
  });

  it("replenishes up to safety stock, not just to zero", () => {
    const result = netItem({
      sku: "RM-STEEL",
      calendar: calendar8,
      onHand: 30,
      safetyStock: 20,
      leadTimeDays: 0,
      lotSizing: { type: "LOT_FOR_LOT" },
      grossRequirements: [15, 0, 0, 0, 0, 0, 0, 0],
      scheduledReceipts: [],
    });
    // available 30 - gross 15 = 15 < SS 20 -> net requirement 5
    assert.equal(result.rows[0].netRequirement, 5);
    assert.equal(result.rows[0].projectedOnHand, 20);
    assert.equal(result.plannedOrders[0].qty, 5);
  });

  it("applies FIXED_ORDER_QTY multiples and carries the remainder forward", () => {
    const result = netItem({
      sku: "CMP-WHEEL",
      calendar: calendar8,
      onHand: 0,
      safetyStock: 0,
      leadTimeDays: 0,
      lotSizing: { type: "FIXED_ORDER_QTY", fixedQty: 25 },
      grossRequirements: [30, 0, 30, 0, 0, 0, 0, 0],
      scheduledReceipts: [],
    });
    assert.deepEqual(result.plannedOrders.map((o) => o.qty), [50, 25]);
    assert.deepEqual(
      result.rows.map((r) => r.projectedOnHand).slice(0, 4),
      [20, 20, 15, 15],
    );
  });

  it("PERIOD_ORDER_QTY covers the whole window with one order", () => {
    const result = netItem({
      sku: "CMP-FRAME",
      calendar: calendar8,
      onHand: 0,
      safetyStock: 0,
      leadTimeDays: 0,
      lotSizing: { type: "PERIOD_ORDER_QTY", periods: 3 },
      grossRequirements: [10, 20, 30, 40, 10, 0, 0, 0],
      scheduledReceipts: [],
    });
    // order 1 at t0 covers t0..t2 (10+20+30), order 2 at t3 covers t3..t4
    assert.deepEqual(
      result.plannedOrders.map((o) => ({ qty: o.qty, due: o.dueDate })),
      [
        { qty: 60, due: "2026-08-10" },
        { qty: 50, due: "2026-08-31" },
      ],
    );
    assert.deepEqual(
      result.rows.map((r) => r.netRequirement),
      [10, 0, 0, 40, 0, 0, 0, 0],
    );
  });

  it("POQ lookahead accounts for scheduled receipts inside the window", () => {
    const result = netItem({
      sku: "CMP-SEAT",
      calendar: calendar8,
      onHand: 0,
      safetyStock: 0,
      leadTimeDays: 0,
      lotSizing: { type: "PERIOD_ORDER_QTY", periods: 2 },
      grossRequirements: [10, 20, 0, 0, 0, 0, 0, 0],
      scheduledReceipts: [0, 15, 0, 0, 0, 0, 0, 0],
    });
    // t0 needs 10; t1 needs max(0, 20-15)=5 more -> single order of 15
    assert.deepEqual(result.plannedOrders.map((o) => o.qty), [15]);
  });

  it("flags past-due releases and derives feasibility exceptions", () => {
    const result = netItem({
      sku: "RM-TUBE",
      calendar: calendar8,
      onHand: 0,
      safetyStock: 0,
      leadTimeDays: 21, // 3 buckets: demand in week 1 cannot be met
      lotSizing: { type: "LOT_FOR_LOT" },
      grossRequirements: [0, 40, 0, 0, 0, 0, 0, 0],
      scheduledReceipts: [],
    });
    const order = result.plannedOrders[0];
    assert.equal(order.pastDue, true);
    assert.equal(order.releaseDate, "2026-08-10"); // clamped to horizon start
    assert.equal(order.releaseIndex, 0);

    const codes = result.exceptions.map((e) => e.code);
    assert.ok(codes.includes("RELEASE_PAST_DUE"));
    // Material can only arrive in week 3 -> weeks 1..2 are short.
    const shortages = result.exceptions.filter((e) => e.code === "SHORTAGE");
    assert.deepEqual(shortages.map((s) => s.weekStart), ["2026-08-17", "2026-08-24"]);
  });

  it("suggests expediting an existing later receipt over a new order", () => {
    const result = netItem({
      sku: "RM-PAINT",
      calendar: calendar8,
      onHand: 0,
      safetyStock: 0,
      leadTimeDays: 28, // any new order is past due for week 1
      lotSizing: { type: "LOT_FOR_LOT" },
      grossRequirements: [0, 30, 0, 0, 0, 0, 0, 0],
      scheduledReceipts: [0, 0, 0, 0, 0, 30, 0, 0],
    });
    const expedite = result.exceptions.find((e) => e.code === "EXPEDITE_RECEIPT");
    assert.ok(expedite, "expected an EXPEDITE_RECEIPT exception");
    assert.equal(expedite.weekStart, "2026-09-14"); // the receipt to pull in
  });

  it("flags receipts that are never needed as excess", () => {
    const result = netItem({
      sku: "CMP-BELL",
      calendar: calendar8,
      onHand: 100,
      safetyStock: 10,
      leadTimeDays: 7,
      lotSizing: { type: "LOT_FOR_LOT" },
      grossRequirements: [5, 5, 5, 0, 0, 0, 0, 0],
      scheduledReceipts: [0, 0, 50, 0, 0, 0, 0, 0],
    });
    const excess = result.exceptions.filter((e) => e.code === "EXCESS_RECEIPT");
    assert.equal(excess.length, 1);
    assert.equal(excess[0].weekStart, "2026-08-24");
    assert.equal(result.plannedOrders.length, 0);
  });

  it("warns when a MIN_MAX cap must be exceeded to avoid shortage", () => {
    const result = netItem({
      sku: "CMP-CHAIN",
      calendar: calendar8,
      onHand: 0,
      safetyStock: 0,
      leadTimeDays: 0,
      lotSizing: { type: "MIN_MAX", minQty: 10, maxQty: 50 },
      grossRequirements: [80, 0, 0, 0, 0, 0, 0, 0],
      scheduledReceipts: [],
    });
    assert.ok(result.exceptions.some((e) => e.code === "LOT_MAX_EXCEEDED"));
    assert.equal(result.plannedOrders[0].qty, 80);
  });
});

describe("low-level codes", () => {
  const tenant = tenantId("t1");

  function item(sku: string, bom: { componentSku: string; qtyPer: number }[] = [], type: "MAKE" | "BUY" = "MAKE") {
    return PlanningItem.create(tenant, {
      sku,
      description: sku,
      procurementType: type,
      leadTimeDays: 7,
      bom: type === "BUY" ? [] : bom,
    });
  }

  it("assigns the deepest level at which an item appears", () => {
    // BIKE -> WHEEL -> SPOKE; BIKE -> SPOKE directly too: SPOKE must be level 2
    const items = [
      item("BIKE", [
        { componentSku: "WHEEL", qtyPer: 2 },
        { componentSku: "SPOKE", qtyPer: 4 },
      ]),
      item("WHEEL", [{ componentSku: "SPOKE", qtyPer: 36 }]),
      item("SPOKE", [], "BUY"),
    ];
    const codes = computeLowLevelCodes(items);
    assert.equal(codes.get("BIKE"), 0);
    assert.equal(codes.get("WHEEL"), 1);
    assert.equal(codes.get("SPOKE"), 2);

    const levels = itemsByLevel(items, codes);
    assert.deepEqual(levels.map((level) => level.map((i) => i.sku)), [["BIKE"], ["WHEEL"], ["SPOKE"]]);
  });

  it("detects BOM cycles", () => {
    const a = item("A", [{ componentSku: "B", qtyPer: 1 }]);
    const b = item("B", [{ componentSku: "A", qtyPer: 1 }]);
    assert.throws(() => computeLowLevelCodes([a, b]), /BOM cycle detected/);
  });

  it("treats components outside planning control as leaves", () => {
    const codes = computeLowLevelCodes([item("TOP", [{ componentSku: "EXTERNAL", qtyPer: 1 }])]);
    assert.equal(codes.get("TOP"), 0);
    assert.equal(codes.get("EXTERNAL"), 1);
  });
});
