/**
 * Shared test fixtures: a hub wired with a deterministic clock, a scripted
 * webhook transport and predictable secrets, plus builders for the shapes the
 * hub consumes.
 */
import {
  brand,
  createTenantContext,
  envelope,
  type EventEnvelope,
  type TenantContext,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { InMemoryEventBus, ImmediateScheduler, retryPolicy } from "@enterprise-suite/event-bus";
import type { RecordingEventPublisher } from "../src/infrastructure/bus-publisher.js";
import { FixedClock } from "../src/infrastructure/in-memory/clock.js";
import { SequentialSecretGenerator } from "../src/infrastructure/in-memory/secrets.js";
import {
  createIntegrationHubModule,
  type IntegrationHubModule,
} from "../src/infrastructure/module.js";
import { RecordingWebhookTransport } from "../src/infrastructure/transport.js";

export interface TestHarness {
  readonly hub: IntegrationHubModule;
  readonly clock: FixedClock;
  readonly transport: RecordingWebhookTransport;
  readonly bus: InMemoryEventBus;
  readonly recorder: RecordingEventPublisher;
  readonly ctx: TenantContext;
  readonly adminCtx: TenantContext;
}

/** Short, deterministic retry ladder so tests can walk it explicitly. */
export const TEST_RETRY = retryPolicy({
  maxAttempts: 3,
  initialDelayMs: 1_000,
  multiplier: 4,
  maxDelayMs: 60_000,
  jitter: "none",
});

export function harness(overrides: { maxAttempts?: number } = {}): TestHarness {
  const clock = new FixedClock("2026-08-12T09:00:00.000Z");
  const transport = new RecordingWebhookTransport();
  const bus = new InMemoryEventBus({ scheduler: new ImmediateScheduler() });
  const hub = createIntegrationHubModule({
    clock,
    bus,
    transport,
    secrets: new SequentialSecretGenerator(),
    retry: overrides.maxAttempts ? { ...TEST_RETRY, maxAttempts: overrides.maxAttempts } : TEST_RETRY,
    recordEvents: true,
  });
  return {
    hub,
    clock,
    transport,
    bus,
    recorder: hub.recorder!,
    ctx: createTenantContext("tenant-acme", "user-ops", ["integration-operator"]),
    adminCtx: createTenantContext("tenant-acme", "user-admin", ["admin"]),
  };
}

export function otherTenantCtx(): TenantContext {
  return createTenantContext("tenant-other", "user-other", ["integration-operator"]);
}

/** Builds a domain event as a producing service would. */
export function domainEvent<TPayload extends object>(
  ctx: TenantContext,
  eventType: string,
  payload: TPayload,
  options: { aggregateId?: string; aggregateType?: string } = {},
): EventEnvelope<TPayload> {
  return envelope({
    eventType,
    aggregateType: options.aggregateType ?? eventType.split(".")[1] ?? "aggregate",
    aggregateId: brand<string, "Ulid">(options.aggregateId ?? `agg_${eventType.replace(/\./g, "_")}`),
    tenantId: ctx.tenantId as TenantId,
    payload,
  });
}

export function ncrOpened(ctx: TenantContext, ncrNumber = "NCR-2026-000001"): EventEnvelope {
  return domainEvent(
    ctx,
    "quality.ncr.opened",
    { ncrNumber, severity: "critical", supplierId: "SUP-001", quantityAffected: 120 },
    { aggregateId: `ncr_${ncrNumber}`, aggregateType: "NonConformanceReport" },
  );
}

export function orderPlaced(ctx: TenantContext, orderId = "SO-1001", total = 25_000): EventEnvelope {
  return domainEvent(
    ctx,
    "sales.order.placed",
    { orderId, total: { amount: total, currency: "EUR" }, customerId: "CUST-9", region: "EU" },
    { aggregateId: `so_${orderId}`, aggregateType: "SalesOrder" },
  );
}

export function ulid(value: string): Ulid {
  return brand<string, "Ulid">(value);
}

/** Registers an always-active webhook and returns its id and secret. */
export async function activeWebhook(
  h: TestHarness,
  options: { name?: string; patterns?: string[]; endpoint?: string; maxAttempts?: number } = {},
): Promise<{ id: Ulid; secret: string }> {
  const { subscription, secret } = await h.hub.services.webhooks.create(h.ctx, {
    name: options.name ?? "partner-erp",
    endpointUrl: options.endpoint ?? "https://partner.example.com/hooks/events",
    eventPatterns: options.patterns ?? ["quality.**"],
    maxAttempts: options.maxAttempts ?? 3,
  });
  return { id: subscription.id, secret };
}
