/**
 * Supplier Quality Event aggregate.
 *
 * The QMS-side record of a quality incident attributed to a supplier.
 * These events are the integration surface towards SRM (srm-core
 * scorecards consume `quality.supplier-event.*` envelopes): each event
 * carries linkage fields back to the originating QMS document
 * (inspection lot, NCR, CAPA, audit) plus procurement references
 * (purchase order), and a demerit-point weight used for vendor rating.
 *
 * Optionally a SCAR (Supplier Corrective Action Request) is issued
 * against the event; the supplier's response is tracked with due dates
 * and acceptance.
 *
 * Workflow: open -> acknowledged -> in-remediation -> resolved
 *           open -> written-off (e.g. disputed and accepted as not
 *           supplier-caused; carries zero demerits thereafter)
 */
import { AggregateRoot, type EntityProps, type IsoDateTime, type TenantId, type Ulid, type UserId } from "@enterprise-suite/shared-kernel";
export type SupplierEventType = "incoming-inspection-failure" | "ncr-issued" | "audit-finding" | "certification-lapse" | "delivery-quality" | "field-failure";
export type SupplierEventSeverity = "critical" | "major" | "minor";
export type SupplierEventStatus = "open" | "acknowledged" | "in-remediation" | "resolved" | "written-off";
export declare function defaultDemeritPoints(eventType: SupplierEventType, severity: SupplierEventSeverity): number;
export interface QmsLinkage {
    readonly inspectionLotId?: Ulid;
    readonly ncrId?: Ulid;
    readonly capaId?: Ulid;
    readonly auditId?: Ulid;
    readonly purchaseOrderRef?: string;
    readonly materialCode?: string;
}
export interface Scar {
    readonly scarNumber: string;
    readonly issuedAt: IsoDateTime;
    readonly issuedBy: UserId;
    readonly dueAt: IsoDateTime;
    readonly respondedAt?: IsoDateTime;
    readonly responseSummary?: string;
    readonly responseAccepted?: boolean;
    readonly reviewedBy?: UserId;
}
interface SupplierQualityEventProps {
    supplierId: string;
    supplierName?: string;
    eventType: SupplierEventType;
    severity: SupplierEventSeverity;
    description: string;
    status: SupplierEventStatus;
    demeritPoints: number;
    linkage: QmsLinkage;
    scar?: Scar;
    occurredAt: IsoDateTime;
    resolution?: {
        resolvedBy: UserId;
        resolvedAt: IsoDateTime;
        note?: string;
    };
    writeOff?: {
        writtenOffBy: UserId;
        writtenOffAt: IsoDateTime;
        reason: string;
    };
}
export declare class SupplierQualityEvent extends AggregateRoot<SupplierQualityEventProps> {
    private constructor();
    static create(tenantId: TenantId, input: {
        supplierId: string;
        supplierName?: string;
        eventType: SupplierEventType;
        severity: SupplierEventSeverity;
        description: string;
        linkage?: QmsLinkage;
        demeritPointsOverride?: number;
        occurredAt?: IsoDateTime;
    }): SupplierQualityEvent;
    static rehydrate(tenantId: TenantId, props: SupplierQualityEventProps, existing: Partial<EntityProps>): SupplierQualityEvent;
    get supplierId(): string;
    get eventType(): SupplierEventType;
    get severity(): SupplierEventSeverity;
    get status(): SupplierEventStatus;
    get demeritPoints(): number;
    get linkage(): QmsLinkage;
    get scar(): Scar | undefined;
    get occurredAt(): IsoDateTime;
    acknowledge(): void;
    issueScar(input: {
        scarNumber: string;
        issuedBy: UserId;
        dueAt: IsoDateTime;
    }): Scar;
    recordScarResponse(input: {
        responseSummary: string;
        accepted: boolean;
        reviewedBy: UserId;
    }): Scar;
    resolve(resolvedBy: UserId, note?: string): void;
    writeOff(writtenOffBy: UserId, reason: string): void;
    isScarOverdue(now: IsoDateTime): boolean;
}
export {};
//# sourceMappingURL=supplier-quality.d.ts.map