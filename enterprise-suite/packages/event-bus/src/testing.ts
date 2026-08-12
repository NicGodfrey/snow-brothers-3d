/**
 * Helpers for testing code that publishes events. Ship them in the package so
 * every service can assert on bus behaviour the same way.
 */
import { brand, envelope, type EventEnvelope, type TenantId, type Ulid } from "@enterprise-suite/shared-kernel";
import type { EventBus, Subscription } from "./types.js";

export interface Collector {
  readonly events: EventEnvelope[];
  readonly subscription: Subscription;
  types(): string[];
  ofType(eventType: string): EventEnvelope[];
  clear(): void;
}

/** Subscribes a recording handler and exposes what it saw. */
export function collect(bus: EventBus, pattern: string | readonly string[], name = "collector"): Collector {
  const events: EventEnvelope[] = [];
  const subscription = bus.subscribe(
    pattern,
    (event) => {
      events.push(event as EventEnvelope);
    },
    { name },
  );
  return {
    events,
    subscription,
    types: () => events.map((event) => event.eventType),
    ofType: (eventType: string) => events.filter((event) => event.eventType === eventType),
    clear: () => {
      events.length = 0;
    },
  };
}

/**
 * A handler that fails its first `failures` invocations, then succeeds.
 * Exposes the number of calls so retry behaviour can be asserted.
 */
export function flakyHandler(
  failures: number,
  error = new Error("boom"),
): (() => Promise<void>) & { readonly calls: number } {
  let calls = 0;
  const handler = async (): Promise<void> => {
    calls++;
    if (calls <= failures) throw error;
  };
  // defineProperty, not Object.assign: assign would snapshot the counter.
  return Object.defineProperty(handler, "calls", {
    get: () => calls,
    enumerable: true,
  }) as (() => Promise<void>) & { readonly calls: number };
}

/** Minimal envelope builder for tests. */
export function testEvent<TPayload>(
  eventType: string,
  payload: TPayload,
  options: { tenantId?: string; aggregateId?: string; aggregateType?: string } = {},
): EventEnvelope<TPayload> {
  return envelope({
    eventType,
    aggregateType: options.aggregateType ?? eventType.split(".")[1] ?? "test",
    aggregateId: brand<string, "Ulid">(options.aggregateId ?? "agg_test") as Ulid,
    tenantId: brand<string, "TenantId">(options.tenantId ?? "tenant-test") as TenantId,
    payload,
  });
}
