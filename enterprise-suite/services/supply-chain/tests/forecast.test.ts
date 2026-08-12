import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tenantId } from "@enterprise-suite/shared-kernel";
import { DemandForecast, residualForecast } from "../src/domain/demand-forecast.js";
import { locationCode } from "../src/domain/types.js";

const tenant = tenantId("t1");
const dc = locationCode("DC-EAST");

describe("demand forecast aggregate", () => {
  it("normalizes entries to Mondays and merges duplicate weeks", () => {
    const forecast = DemandForecast.create(tenant, {
      sku: "fg-bike",
      location: dc,
      entries: [
        { weekStart: "2026-08-12", qty: 10 }, // Wednesday -> 2026-08-10
        { weekStart: "2026-08-10", qty: 5 },
        { weekStart: "2026-08-17", qty: 20 },
      ],
    });
    assert.equal(forecast.sku, "FG-BIKE");
    assert.deepEqual(
      forecast.entries.map((e) => ({ ...e })),
      [
        { weekStart: "2026-08-10", qty: 15 },
        { weekStart: "2026-08-17", qty: 20 },
      ],
    );
    assert.equal(forecast.totalQty, 35);
  });

  it("upserts entries and removes weeks with qty 0", () => {
    const forecast = DemandForecast.create(tenant, {
      sku: "FG-BIKE",
      location: dc,
      entries: [{ weekStart: "2026-08-10", qty: 10 }],
    });
    forecast.upsertEntries([
      { weekStart: "2026-08-10", qty: 0 },
      { weekStart: "2026-08-17", qty: 25 },
    ]);
    assert.deepEqual(forecast.entries.map((e) => e.weekStart), ["2026-08-17"]);
  });

  it("enforces the DRAFT -> PUBLISHED -> ARCHIVED lifecycle", () => {
    const forecast = DemandForecast.create(tenant, { sku: "FG-BIKE", location: dc });
    assert.throws(() => forecast.publish(), /empty forecast/);
    forecast.upsertEntries([{ weekStart: "2026-08-10", qty: 10 }]);
    forecast.publish();
    assert.equal(forecast.status, "PUBLISHED");
    const events = forecast.pullEvents();
    assert.equal(events[0].eventType, "supplychain.forecast.published");
    assert.throws(() => forecast.upsertEntries([{ weekStart: "2026-08-17", qty: 5 }]), /only DRAFT/);
    forecast.archive();
    assert.equal(forecast.status, "ARCHIVED");
    assert.throws(() => forecast.archive(), /already archived/);
  });

  it("rejects negative quantities", () => {
    assert.throws(
      () => DemandForecast.create(tenant, { sku: "X", location: dc, entries: [{ weekStart: "2026-08-10", qty: -1 }] }),
      /must not be negative/,
    );
  });
});

describe("forecast consumption", () => {
  it("consumes forecast with actuals in the same bucket, flooring at zero", () => {
    const forecast = [100, 50, 80, 0];
    const actuals = [30, 70, 0, 10];
    assert.deepEqual(residualForecast(forecast, actuals), [70, 0, 80, 0]);
  });

  it("treats missing actual buckets as zero consumption", () => {
    assert.deepEqual(residualForecast([40, 40], []), [40, 40]);
  });
});
