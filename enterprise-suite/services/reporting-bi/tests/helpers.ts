/**
 * Shared fixtures.
 *
 * Two shapes of harness, because the suite asks two different kinds of
 * question:
 *
 *  - `harness()` gives an empty module with a fixed clock, on top of which
 *    each test builds the minimal cube it needs. Aggregation behaviour is
 *    easier to reason about against four hand-written facts than against a
 *    generated warehouse.
 *  - `warehouse()` installs the shipped catalog and seeds it through the
 *    real ingest path, which is what the ingest, KPI and HTTP tests need.
 */
import {
  brand,
  createTenantContext,
  envelope,
  type EventEnvelope,
  type IsoDateTime,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { createFact, type FactRecord } from "../src/domain/fact.js";
import type { SourceEvent } from "../src/domain/ingest.js";
import { installCatalog } from "../src/infrastructure/catalog.js";
import { FixedClock } from "../src/infrastructure/in-memory/clock.js";
import {
  createReportingBiModule,
  type ReportingBiModule,
} from "../src/infrastructure/module.js";
import { seedDemoData } from "../src/infrastructure/seed.js";

export const NOW = "2026-08-12T09:00:00.000Z";

export interface Harness {
  readonly module: ReportingBiModule;
  readonly clock: FixedClock;
  readonly ctx: TenantContext;
}

export function harness(now: string = NOW): Harness {
  const clock = new FixedClock(now);
  return {
    module: createReportingBiModule({ clock, queryCacheSize: 0 }),
    clock,
    ctx: createTenantContext("tenant-acme", "user-analyst", ["analyst", "admin"]),
  };
}

export function otherTenantCtx(): TenantContext {
  return createTenantContext("tenant-other", "user-other", ["analyst"]);
}

/** Catalog + seeded facts + KPI snapshots, as `npm start` would produce. */
export async function warehouse(options?: { days?: number; now?: string }): Promise<Harness> {
  const h = harness(options?.now ?? NOW);
  await installCatalog(h.ctx, h.module);
  await seedDemoData(h.ctx, h.module, { days: options?.days ?? 90, anchor: h.clock.now() });
  return h;
}

// ---------------------------------------------------------------------------
// A minimal purpose-built cube
// ---------------------------------------------------------------------------

export const TEST_CUBE = "test_orders";

/**
 * A two-level product hierarchy, a flat channel, one cube and a metric set
 * covering every aggregation kind plus two levels of derivation.
 */
export async function smallCube(h: Harness): Promise<void> {
  const { services } = h.module;

  await services.dimensions.registerDimension(h.ctx, {
    key: "product",
    label: "Product",
    type: "entity",
    levels: [
      { key: "family", label: "Family" },
      { key: "sku", label: "SKU" },
    ],
  });
  await services.dimensions.loadMembers(h.ctx, "product", [
    { key: "FAM-A", label: "Family A", levelKey: "family" },
    { key: "FAM-B", label: "Family B", levelKey: "family" },
    { key: "SKU-1", label: "Widget", levelKey: "sku", parentKey: "FAM-A" },
    { key: "SKU-2", label: "Gadget", levelKey: "sku", parentKey: "FAM-A" },
    { key: "SKU-3", label: "Gizmo", levelKey: "sku", parentKey: "FAM-B" },
  ]);
  await services.dimensions.registerDimension(h.ctx, { key: "channel", label: "Channel" });

  await services.cubes.defineCube(h.ctx, {
    name: TEST_CUBE,
    title: "Test orders",
    defaultGrain: "month",
    dimensions: [{ factKey: "product" }, { factKey: "channel" }],
    measureFields: [
      { field: "orders", label: "Orders" },
      { field: "revenue_minor", label: "Revenue", isCurrency: true },
      { field: "units", label: "Units" },
    ],
  });
  await services.cubes.publishCube(h.ctx, TEST_CUBE);

  const metrics = [
    { code: "orders", name: "Orders", unit: "count" as const, aggregation: "sum" as const, sourceField: "orders" },
    { code: "revenue", name: "Revenue", unit: "currency" as const, aggregation: "sum" as const, sourceField: "revenue_minor" },
    { code: "units", name: "Units", unit: "quantity" as const, aggregation: "sum" as const, sourceField: "units" },
    { code: "fact_rows", name: "Fact rows", unit: "count" as const, aggregation: "count" as const },
    { code: "biggest_order", name: "Biggest order", unit: "currency" as const, aggregation: "max" as const, sourceField: "revenue_minor" },
    { code: "smallest_order", name: "Smallest order", unit: "currency" as const, aggregation: "min" as const, sourceField: "revenue_minor" },
    { code: "avg_units", name: "Average units", unit: "quantity" as const, aggregation: "avg" as const, sourceField: "units" },
    { code: "skus_sold", name: "SKUs sold", unit: "count" as const, aggregation: "count_distinct" as const, sourceField: "product" },
  ];
  for (const metric of metrics) {
    await h.module.services.metrics.defineMetric(h.ctx, { ...metric, cube: TEST_CUBE });
  }
  await h.module.services.metrics.defineMetric(h.ctx, {
    code: "aov",
    name: "Average order value",
    cube: TEST_CUBE,
    unit: "currency",
    expression: "safe_div(revenue, orders)",
  });
  // Derived on a derived metric: exercises multi-level evaluation order.
  await h.module.services.metrics.defineMetric(h.ctx, {
    code: "aov_per_unit",
    name: "Value per unit",
    cube: TEST_CUBE,
    unit: "currency",
    expression: "safe_div(aov, avg_units)",
  });
  // Base metrics first: a derived metric cannot be published while any
  // dependency is still a draft.
  const defined = await h.module.repos.metrics.list(h.ctx.tenantId);
  for (const metric of defined.filter((m) => m.kind === "base")) {
    await h.module.services.metrics.publishMetric(h.ctx, metric.code);
  }
  await h.module.services.metrics.publishMetric(h.ctx, "aov");
  await h.module.services.metrics.publishMetric(h.ctx, "aov_per_unit");
}

export interface FactSpec {
  at: string;
  product?: string;
  channel?: string;
  orders?: number;
  revenue?: number;
  units?: number;
  cube?: string;
}

/** Appends facts straight to the store, bypassing ingest. */
export async function appendFacts(h: Harness, specs: readonly FactSpec[]): Promise<FactRecord[]> {
  const facts = specs.map((spec, index) =>
    createFact({
      tenantId: h.ctx.tenantId,
      cube: spec.cube ?? TEST_CUBE,
      occurredAt: brand<string, "IsoDateTime">(new Date(spec.at).toISOString()),
      dimensions: { product: spec.product, channel: spec.channel },
      measures: {
        orders: spec.orders ?? 1,
        revenue_minor: spec.revenue ?? 0,
        units: spec.units ?? 0,
      },
      source: {
        eventId: brand<string, "Ulid">(`evt_${index}_${spec.at}`),
        eventType: "test.order.placed",
        aggregateType: "Order",
        aggregateId: brand<string, "Ulid">(`ord_${index}`),
        ingestedAt: h.clock.now(),
        mappingVersion: 1,
      },
    }),
  );
  await h.module.repos.facts.append(facts);
  return facts;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

let sequence = 0;

/** An upstream domain event as the bus would deliver it. */
export function sourceEvent(
  ctx: TenantContext,
  eventType: string,
  payload: unknown,
  options: { at?: string; eventId?: string; aggregateType?: string } = {},
): SourceEvent {
  sequence += 1;
  return {
    eventId: brand<string, "Ulid">(options.eventId ?? `evt_${sequence}`),
    eventType,
    aggregateType: options.aggregateType ?? eventType.split(".")[1] ?? "Aggregate",
    aggregateId: brand<string, "Ulid">(`agg_${sequence}`),
    tenantId: ctx.tenantId,
    occurredAt: brand<string, "IsoDateTime">(new Date(options.at ?? NOW).toISOString()),
    schemaVersion: 1,
    payload,
  };
}

export function domainEnvelope(
  ctx: TenantContext,
  eventType: string,
  payload: object,
): EventEnvelope {
  sequence += 1;
  return envelope({
    eventType,
    aggregateType: eventType.split(".")[1] ?? "Aggregate",
    aggregateId: brand<string, "Ulid">(`agg_env_${sequence}`),
    tenantId: ctx.tenantId,
    payload,
  });
}

export function instant(value: string): IsoDateTime {
  return brand<string, "IsoDateTime">(new Date(value).toISOString());
}

export function ulid(value: string): Ulid {
  return brand<string, "Ulid">(value);
}

/** Event types published to the outbox, in order. */
export async function publishedTypes(h: Harness): Promise<string[]> {
  return (await h.module.outbox.pending()).map((event) => event.eventType);
}
