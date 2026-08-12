/**
 * Supplier quality use-cases: recording events, SCAR lifecycle, and the
 * per-supplier summary consumed by SRM scorecards.
 */
import { type IsoDateTime, type TenantContext, type Ulid } from "@enterprise-suite/shared-kernel";
import type { SupplierQualityEventRepository } from "../domain/repositories.js";
import { SupplierQualityEvent, type QmsLinkage, type SupplierEventSeverity, type SupplierEventStatus, type SupplierEventType } from "../domain/supplier-quality.js";
import { type Clock, type NumberSeries, type Outbox } from "./ports.js";
export interface RecordSupplierEventCommand {
    supplierId: string;
    supplierName?: string;
    eventType: SupplierEventType;
    severity: SupplierEventSeverity;
    description: string;
    linkage?: QmsLinkage;
    demeritPointsOverride?: number;
    occurredAt?: IsoDateTime;
}
/** Vendor-rating band derived from demerit points over the window. */
export type SupplierQualityBand = "A" | "B" | "C" | "D";
export interface SupplierQualitySummary {
    supplierId: string;
    totalEvents: number;
    openEvents: number;
    totalDemerits: number;
    bySeverity: Record<SupplierEventSeverity, number>;
    byType: Partial<Record<SupplierEventType, number>>;
    openScars: number;
    overdueScars: number;
    band: SupplierQualityBand;
}
export declare class SupplierQualityService {
    private readonly events;
    private readonly outbox;
    private readonly numbers;
    private readonly clock;
    constructor(events: SupplierQualityEventRepository, outbox: Outbox, numbers: NumberSeries, clock: Clock);
    private flush;
    recordEvent(ctx: TenantContext, cmd: RecordSupplierEventCommand): Promise<SupplierQualityEvent>;
    acknowledge(ctx: TenantContext, eventId: Ulid): Promise<SupplierQualityEvent>;
    issueScar(ctx: TenantContext, eventId: Ulid, input: {
        dueAt: IsoDateTime;
    }): Promise<SupplierQualityEvent>;
    recordScarResponse(ctx: TenantContext, eventId: Ulid, input: {
        responseSummary: string;
        accepted: boolean;
    }): Promise<SupplierQualityEvent>;
    resolve(ctx: TenantContext, eventId: Ulid, note?: string): Promise<SupplierQualityEvent>;
    writeOff(ctx: TenantContext, eventId: Ulid, reason: string): Promise<SupplierQualityEvent>;
    getEvent(ctx: TenantContext, eventId: Ulid): Promise<SupplierQualityEvent>;
    listEvents(ctx: TenantContext, filter?: {
        status?: SupplierEventStatus;
        supplierId?: string;
    }): Promise<SupplierQualityEvent[]>;
    supplierSummary(ctx: TenantContext, supplierId: string): Promise<SupplierQualitySummary>;
}
//# sourceMappingURL=supplier-quality-service.d.ts.map