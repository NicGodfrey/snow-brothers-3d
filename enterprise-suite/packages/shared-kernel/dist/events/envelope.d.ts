import { type IsoDateTime, type Ulid } from "../types/branded.js";
import type { TenantId } from "../types/tenant.js";
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
export declare function envelope<TPayload>(input: {
    eventType: string;
    aggregateType: string;
    aggregateId: Ulid;
    tenantId: TenantId;
    payload: TPayload;
    schemaVersion?: number;
    correlationId?: Ulid;
    causationId?: Ulid;
}): EventEnvelope<TPayload>;
//# sourceMappingURL=envelope.d.ts.map