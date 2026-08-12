import { newId, nowIso, type IsoDateTime, type Ulid } from "./brand.js";
import type { TenantId } from "./tenant.js";

/** Shape-compatible with @enterprise-suite/shared-kernel EventEnvelope. */
export interface EventEnvelope<TPayload = unknown> {
  readonly eventId: Ulid;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: Ulid;
  readonly tenantId: TenantId;
  readonly occurredAt: IsoDateTime;
  readonly schemaVersion: number;
  readonly payload: TPayload;
  readonly correlationId?: Ulid;
  readonly causationId?: Ulid;
}

export function envelope<TPayload>(input: {
  eventType: string;
  aggregateType: string;
  aggregateId: Ulid;
  tenantId: TenantId;
  payload: TPayload;
  schemaVersion?: number;
  correlationId?: Ulid;
  causationId?: Ulid;
}): EventEnvelope<TPayload> {
  return {
    eventId: newId("evt"),
    eventType: input.eventType,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    tenantId: input.tenantId,
    occurredAt: nowIso(),
    schemaVersion: input.schemaVersion ?? 1,
    payload: input.payload,
    correlationId: input.correlationId,
    causationId: input.causationId,
  };
}
