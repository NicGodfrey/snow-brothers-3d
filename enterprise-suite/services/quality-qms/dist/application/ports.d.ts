/**
 * Application-level ports: outbox publishing, document numbering, clock.
 */
import type { EventEnvelope, IsoDateTime, TenantId } from "@enterprise-suite/shared-kernel";
/**
 * Transactional outbox. Application services append events pulled from
 * aggregates right after the repository save; a relay (integration-hub)
 * drains and publishes them. The in-memory implementation keeps ordering
 * per append call.
 */
export interface Outbox {
    append(events: readonly EventEnvelope[]): Promise<void>;
    /** Returns and marks pending events as dispatched. */
    drain(): Promise<EventEnvelope[]>;
    /** Read-only view of undispatched events (diagnostics / tests). */
    pending(): Promise<readonly EventEnvelope[]>;
}
/**
 * Tenant-scoped, gap-free-enough document numbering, e.g.
 * NCR-2026-000001, CAPA-2026-000014, LOT-2026-000102.
 */
export interface NumberSeries {
    next(tenantId: TenantId, seriesCode: string): Promise<string>;
}
export interface Clock {
    now(): IsoDateTime;
}
export declare const documentSeries: {
    readonly inspectionLot: "LOT";
    readonly ncr: "NCR";
    readonly capa: "CAPA";
    readonly scar: "SCAR";
    readonly audit: "AUD";
};
//# sourceMappingURL=ports.d.ts.map