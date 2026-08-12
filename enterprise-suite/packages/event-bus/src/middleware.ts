/**
 * Publish-side middleware. Each middleware may inspect, rewrite or veto an
 * event before it reaches the subscription router by choosing not to call
 * `next`.
 */
import type { EventEnvelope, TenantId, Ulid } from "@enterprise-suite/shared-kernel";

export type PublishNext = (event: EventEnvelope) => Promise<void>;
export type PublishMiddleware = (event: EventEnvelope, next: PublishNext) => Promise<void>;

/** Folds middlewares into one function, executed left to right. */
export function composeMiddleware(
  middlewares: readonly PublishMiddleware[],
  terminal: PublishNext,
): PublishNext {
  return middlewares.reduceRight<PublishNext>(
    (next, middleware) => (event) => middleware(event, next),
    terminal,
  );
}

export interface BusLogger {
  debug(message: string, fields?: Record<string, unknown>): void;
}

export function loggingMiddleware(logger: BusLogger): PublishMiddleware {
  return async (event, next) => {
    logger.debug("event.publish", {
      eventId: event.eventId,
      eventType: event.eventType,
      tenantId: event.tenantId,
      aggregateId: event.aggregateId,
    });
    await next(event);
  };
}

/** Drops events that do not satisfy the predicate. */
export function filterMiddleware(predicate: (event: EventEnvelope) => boolean): PublishMiddleware {
  return async (event, next) => {
    if (predicate(event)) await next(event);
  };
}

/** Rejects events published without a tenant, a common wiring bug. */
export function requireTenantMiddleware(): PublishMiddleware {
  return async (event, next) => {
    if (!event.tenantId) {
      throw new Error(`Event ${event.eventType} (${event.eventId}) has no tenantId`);
    }
    await next(event);
  };
}

/** Stamps a correlation id onto events that lack one. */
export function correlationMiddleware(correlationIdFor: (event: EventEnvelope) => Ulid): PublishMiddleware {
  return async (event, next) => {
    await next(event.correlationId ? event : { ...event, correlationId: correlationIdFor(event) });
  };
}

/** Read-only side effect (audit trail, projections, test capture). */
export function tapMiddleware(tap: (event: EventEnvelope) => void): PublishMiddleware {
  return async (event, next) => {
    tap(event);
    await next(event);
  };
}

/** Restricts a bus instance to a single tenant, e.g. in a tenant-scoped worker. */
export function tenantScopeMiddleware(tenantId: TenantId): PublishMiddleware {
  return filterMiddleware((event) => event.tenantId === tenantId);
}
