/**
 * Fact ingest.
 *
 * The properties that matter here are the ones an at-least-once event bus
 * makes you care about: redelivery must not double-count, one bad payload
 * must not sink the batch, and anything rejected must be recoverable from
 * the dead-letter queue rather than silently gone.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ReportingCubes } from "../src/application/mappings.js";
import { UNKNOWN_MEMBER } from "../src/domain/fact.js";
import { ReportingEventTypes } from "../src/domain/events.js";
import { installCatalog } from "../src/infrastructure/catalog.js";
import {
  appendFacts,
  domainEnvelope,
  harness,
  otherTenantCtx,
  publishedTypes,
  sourceEvent,
} from "./helpers.js";

const orderPayload = {
  accountId: "ACC-1",
  orderNumber: "SO-1001",
  grandTotalMinor: 125_00,
  currency: "EUR",
  creditDecision: "approved",
  quoteId: "Q-9",
};

async function catalogued() {
  const h = harness();
  await installCatalog(h.ctx, h.module);
  return h;
}

describe("ingest / mapping", () => {
  it("projects a confirmed order into a sales fact", async () => {
    const h = await catalogued();
    const result = await h.module.services.ingest.ingest(h.ctx, [
      sourceEvent(h.ctx, "sales.order.confirmed", orderPayload, { at: "2026-08-01T10:00:00Z" }),
    ]);

    assert.equal(result.ingested, 1);
    assert.equal(result.factsWritten, 1);
    assert.deepEqual(result.cubes, [ReportingCubes.salesOrders]);

    const [fact] = await h.module.repos.facts.scan(h.ctx.tenantId, { cube: ReportingCubes.salesOrders });
    assert.equal(fact.dimensions.customer, "ACC-1");
    assert.equal(fact.dimensions.credit_decision, "approved");
    // A quote id on the payload means the order originated from a quote.
    assert.equal(fact.dimensions.order_source, "quote");
    assert.equal(fact.measures.booked_amount_minor, 125_00);
    assert.equal(fact.measures.orders_confirmed, 1);
    assert.equal(fact.currency, "EUR");
    assert.equal(fact.occurredAt, "2026-08-01T10:00:00.000Z");
    assert.equal(fact.source.eventType, "sales.order.confirmed");
    assert.equal(fact.source.mappingVersion, 1);
  });

  it("fills missing dimension values with a single unknown bucket", async () => {
    const h = await catalogued();
    await h.module.services.ingest.ingest(h.ctx, [
      sourceEvent(h.ctx, "sales.order.confirmed", { accountId: "ACC-1", grandTotalMinor: 1 }),
    ]);

    const [fact] = await h.module.repos.facts.scan(h.ctx.tenantId, { cube: ReportingCubes.salesOrders });
    assert.equal(fact.dimensions.order_reference, UNKNOWN_MEMBER);
    assert.equal(fact.dimensions.credit_decision, "none");
  });

  it("fans one event out into a fact per counted line", async () => {
    const h = await catalogued();
    const result = await h.module.services.ingest.ingest(h.ctx, [
      sourceEvent(h.ctx, "inventory.cycle-count.completed", {
        warehouseId: "WH-1",
        countedLines: 3,
        variances: [
          { sku: "SKU-1", countedQty: 10, expectedQty: 12, varianceQty: -2 },
          { sku: "SKU-2", countedQty: 5, expectedQty: 5, varianceQty: 0 },
        ],
      }),
    ]);

    assert.equal(result.ingested, 1);
    assert.equal(result.factsWritten, 2);
    const facts = await h.module.repos.facts.scan(h.ctx.tenantId, {
      cube: ReportingCubes.inventoryMovements,
    });
    assert.deepEqual(
      facts.map((f) => f.measures.variance_lines),
      [1, 0],
    );
    // Both rows carry the same source event, which is how a re-ingest of that
    // event is recognised as a duplicate rather than two half-duplicates.
    assert.equal(new Set(facts.map((f) => f.source.eventId)).size, 1);
  });

  it("stamps delivery facts at the delivery instant, not the publish instant", async () => {
    const h = await catalogued();
    await h.module.services.ingest.ingest(h.ctx, [
      sourceEvent(
        h.ctx,
        "logistics.shipment.delivered",
        { carrierCode: "DHL", deliveredAt: "2026-07-30T18:20:00Z" },
        { at: "2026-08-02T06:00:00Z" },
      ),
    ]);

    const [fact] = await h.module.repos.facts.scan(h.ctx.tenantId, {
      cube: ReportingCubes.logisticsShipments,
    });
    assert.equal(fact.occurredAt, "2026-07-30T18:20:00.000Z");
  });

  it("falls back to the event instant when the payload timestamp is junk", async () => {
    const h = await catalogued();
    await h.module.services.ingest.ingest(h.ctx, [
      sourceEvent(
        h.ctx,
        "logistics.shipment.delivered",
        { carrierCode: "DHL", deliveredAt: "not-a-date" },
        { at: "2026-08-02T06:00:00Z" },
      ),
    ]);

    const [fact] = await h.module.repos.facts.scan(h.ctx.tenantId, {
      cube: ReportingCubes.logisticsShipments,
    });
    assert.equal(fact.occurredAt, "2026-08-02T06:00:00.000Z");
  });

  it("accepts shared-kernel envelopes straight off the bus", async () => {
    const h = await catalogued();
    const result = await h.module.services.ingest.ingestEnvelopes(h.ctx, [
      domainEnvelope(h.ctx, "sales.order.confirmed", orderPayload),
    ]);
    assert.equal(result.factsWritten, 1);
  });
});

describe("ingest / idempotency", () => {
  it("ignores an event id it has already stored", async () => {
    const h = await catalogued();
    const event = sourceEvent(h.ctx, "sales.order.confirmed", orderPayload);

    const first = await h.module.services.ingest.ingest(h.ctx, [event]);
    const second = await h.module.services.ingest.ingest(h.ctx, [event]);

    assert.equal(first.ingested, 1);
    assert.equal(second.ingested, 0);
    assert.equal(second.duplicates, 1);
    assert.equal(await h.module.repos.facts.count(h.ctx.tenantId, ReportingCubes.salesOrders), 1);
  });

  it("collapses duplicates that arrive twice inside one batch", async () => {
    const h = await catalogued();
    const event = sourceEvent(h.ctx, "sales.order.confirmed", orderPayload);
    const result = await h.module.services.ingest.ingest(h.ctx, [event, event, event]);

    assert.equal(result.received, 3);
    assert.equal(result.ingested, 1);
    assert.equal(result.duplicates, 2);
  });

  it("keeps tenants apart: the same event id ingests once per tenant", async () => {
    const h = await catalogued();
    const other = otherTenantCtx();
    await installCatalog(other, h.module);

    await h.module.services.ingest.ingest(h.ctx, [
      sourceEvent(h.ctx, "sales.order.confirmed", orderPayload, { eventId: "evt-shared" }),
    ]);
    const result = await h.module.services.ingest.ingest(other, [
      sourceEvent(other, "sales.order.confirmed", orderPayload, { eventId: "evt-shared" }),
    ]);

    assert.equal(result.ingested, 1);
    assert.equal(await h.module.repos.facts.count(other.tenantId, ReportingCubes.salesOrders), 1);
  });
});

describe("ingest / rejection", () => {
  it("dead-letters an unmapped event type", async () => {
    const h = await catalogued();
    const result = await h.module.services.ingest.ingest(h.ctx, [
      sourceEvent(h.ctx, "weather.storm.forecast", { windSpeed: 90 }),
    ]);

    assert.equal(result.rejected, 1);
    assert.equal(result.deadLetters[0].reason, "no-mapping");
    const stored = await h.module.services.ingest.listDeadLetters(h.ctx);
    assert.equal(stored.length, 1);
    assert.deepEqual(stored[0].payload, { windSpeed: 90 });
  });

  it("dead-letters a payload missing a field the mapping requires", async () => {
    const h = await catalogued();
    const result = await h.module.services.ingest.ingest(h.ctx, [
      sourceEvent(h.ctx, "sales.order.confirmed", { grandTotalMinor: 100 }),
    ]);

    assert.equal(result.rejected, 1);
    assert.equal(result.deadLetters[0].reason, "mapping-failed");
    assert.match(result.deadLetters[0].message, /accountId/);
  });

  it("dead-letters when the target cube is not defined in this tenant", async () => {
    const h = harness(); // no catalog installed
    const result = await h.module.services.ingest.ingest(h.ctx, [
      sourceEvent(h.ctx, "sales.order.confirmed", orderPayload),
    ]);

    assert.equal(result.rejected, 1);
    assert.equal(result.deadLetters[0].reason, "invalid-payload");
    assert.match(result.deadLetters[0].message, /not defined in this tenant/);
  });

  it("rejects an event carrying another tenant's id", async () => {
    const h = await catalogued();
    const foreign = sourceEvent(otherTenantCtx(), "sales.order.confirmed", orderPayload);
    const result = await h.module.services.ingest.ingest(h.ctx, [foreign]);

    assert.equal(result.rejected, 1);
    assert.match(result.deadLetters[0].message, /belongs to tenant/);
    assert.equal(await h.module.repos.facts.count(h.ctx.tenantId, ReportingCubes.salesOrders), 0);
  });

  it("keeps the good events of a batch that also contains a bad one", async () => {
    const h = await catalogued();
    const result = await h.module.services.ingest.ingest(h.ctx, [
      sourceEvent(h.ctx, "sales.order.confirmed", orderPayload),
      sourceEvent(h.ctx, "sales.order.confirmed", { grandTotalMinor: 1 }),
      sourceEvent(h.ctx, "sales.order.confirmed", { ...orderPayload, accountId: "ACC-2" }),
    ]);

    assert.equal(result.ingested, 2);
    assert.equal(result.rejected, 1);
    assert.equal(result.factsWritten, 2);
  });

  it("counts master-data events as recognised-but-ignored, not rejected", async () => {
    const h = await catalogued();
    const result = await h.module.services.ingest.ingest(h.ctx, [
      sourceEvent(h.ctx, "sales.account.created", { accountId: "ACC-9" }),
    ]);

    assert.equal(result.ignored, 1);
    assert.equal(result.rejected, 0);
    assert.equal(result.factsWritten, 0);
    assert.deepEqual(await h.module.services.ingest.listDeadLetters(h.ctx), []);
  });

  it("filters the dead-letter queue by reason and event type", async () => {
    const h = await catalogued();
    await h.module.services.ingest.ingest(h.ctx, [
      sourceEvent(h.ctx, "weather.storm.forecast", {}),
      sourceEvent(h.ctx, "sales.order.confirmed", {}),
    ]);

    assert.equal((await h.module.services.ingest.listDeadLetters(h.ctx, { reason: "no-mapping" })).length, 1);
    assert.equal(
      (await h.module.services.ingest.listDeadLetters(h.ctx, { eventType: "sales.order.confirmed" })).length,
      1,
    );
    assert.equal((await h.module.services.ingest.listDeadLetters(h.ctx, { limit: 1 })).length, 1);
  });
});

describe("ingest / watermarks", () => {
  it("records the newest event per source context", async () => {
    const h = await catalogued();
    await h.module.services.ingest.ingest(h.ctx, [
      sourceEvent(h.ctx, "sales.order.confirmed", orderPayload, { at: "2026-08-01T10:00:00Z" }),
      sourceEvent(h.ctx, "sales.order.confirmed", { ...orderPayload, accountId: "ACC-2" }, { at: "2026-08-03T10:00:00Z" }),
      sourceEvent(h.ctx, "finance.ar.invoice-issued", { customerId: "ACC-1", totalMinor: 500 }, { at: "2026-08-02T10:00:00Z" }),
    ]);

    const watermarks = await h.module.services.ingest.listWatermarks(h.ctx);
    const sales = watermarks.find((w) => w.source === "sales");
    const finance = watermarks.find((w) => w.source === "finance");

    assert.equal(sales?.lastOccurredAt, "2026-08-03T10:00:00.000Z");
    assert.equal(sales?.eventCount, 2);
    assert.equal(sales?.factCount, 2);
    assert.equal(finance?.lastOccurredAt, "2026-08-02T10:00:00.000Z");
  });

  it("never rewinds on a late-arriving event", async () => {
    const h = await catalogued();
    await h.module.services.ingest.ingest(h.ctx, [
      sourceEvent(h.ctx, "sales.order.confirmed", orderPayload, { at: "2026-08-05T10:00:00Z" }),
    ]);
    await h.module.services.ingest.ingest(h.ctx, [
      sourceEvent(h.ctx, "sales.order.confirmed", { ...orderPayload, accountId: "ACC-2" }, { at: "2026-08-01T10:00:00Z" }),
    ]);

    const [sales] = await h.module.services.ingest.listWatermarks(h.ctx);
    assert.equal(sales.lastOccurredAt, "2026-08-05T10:00:00.000Z");
    // Volume still counts the late event, only freshness is pinned.
    assert.equal(sales.eventCount, 2);
  });
});

describe("ingest / announcements", () => {
  it("publishes one ingested event per source and one rejection per dead letter", async () => {
    const h = await catalogued();
    await h.module.outbox.drain();
    await h.module.services.ingest.ingest(h.ctx, [
      sourceEvent(h.ctx, "sales.order.confirmed", orderPayload),
      sourceEvent(h.ctx, "weather.storm.forecast", {}),
    ]);

    const types = await publishedTypes(h);
    assert.deepEqual(types.filter((t) => t === ReportingEventTypes.FactsRejected).length, 1);
    assert.deepEqual(types.filter((t) => t === ReportingEventTypes.FactsIngested).length, 1);
  });

  it("says nothing when a batch produced no facts", async () => {
    const h = await catalogued();
    await h.module.outbox.drain();
    await h.module.services.ingest.ingest(h.ctx, []);
    assert.deepEqual(await publishedTypes(h), []);
  });
});

describe("ingest / retention", () => {
  const SHORT_LIVED = "short_lived";

  async function withRetention(days: number) {
    const h = harness();
    await h.module.services.cubes.defineCube(h.ctx, {
      name: SHORT_LIVED,
      title: "Short lived",
      retentionDays: days,
      dimensions: [{ factKey: "channel" }],
      measureFields: [{ field: "orders" }],
    });
    await appendFacts(h, [
      { at: "2026-08-11T00:00:00Z", cube: SHORT_LIVED },
      { at: "2026-06-20T00:00:00Z", cube: SHORT_LIVED },
      { at: "2026-01-01T00:00:00Z", cube: SHORT_LIVED },
    ]);
    return h;
  }

  it("drops facts older than the retention window and announces the purge", async () => {
    const h = await withRetention(30);
    await h.module.outbox.drain();

    const purged = await h.module.services.ingest.applyRetention(h.ctx, SHORT_LIVED);

    assert.equal(purged, 2);
    assert.equal(await h.module.repos.facts.count(h.ctx.tenantId, SHORT_LIVED), 1);
    assert.deepEqual(await publishedTypes(h), [ReportingEventTypes.FactsPurged]);
  });

  it("keeps everything when retention is unset, and stays quiet", async () => {
    const h = await withRetention(0);
    await h.module.outbox.drain();

    assert.equal(await h.module.services.ingest.applyRetention(h.ctx, SHORT_LIVED), 0);
    assert.equal(await h.module.repos.facts.count(h.ctx.tenantId, SHORT_LIVED), 3);
    assert.deepEqual(await publishedTypes(h), []);
  });

  it("is a no-op for a cube that does not exist", async () => {
    const h = harness();
    assert.equal(await h.module.services.ingest.applyRetention(h.ctx, "nope"), 0);
  });

  it("reports the supported event types so operators can see coverage", async () => {
    const h = harness();
    const types = h.module.services.ingest.supportedEventTypes();
    assert.ok(types.includes("sales.order.confirmed"));
    assert.ok(types.includes("quality.ncr.opened"));
    assert.ok(types.length > 25);
  });
});
