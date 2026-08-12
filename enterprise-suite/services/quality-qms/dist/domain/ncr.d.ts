/**
 * Non-Conformance Report (NCR) aggregate.
 *
 * An NCR documents a deviation: what is wrong, how much material is
 * affected, where it came from (inspection lot, production, supplier,
 * customer complaint, audit) and how the material is dispositioned.
 *
 * Workflow:
 *   draft -> open -> containment -> disposition -> closed
 *                 \______________/^
 *   (minor NCRs may skip containment: open -> disposition)
 *   any non-terminal state -> cancelled
 *
 * Rules encoded here:
 *  - containment can only finish when all containment actions are done
 *  - "use-as-is" and "regrade" dispositions always require approval;
 *    any disposition on a critical NCR requires approval
 *  - closing requires an approved disposition (when approval is required)
 *  - escalation to CAPA links the NCR and is recorded as an event
 */
import { AggregateRoot, type EntityProps, type IsoDateTime, type TenantId, type Ulid, type UserId } from "@enterprise-suite/shared-kernel";
export type NcrStatus = "draft" | "open" | "containment" | "disposition" | "closed" | "cancelled";
export type NcrSource = "inspection" | "production" | "customer-complaint" | "supplier" | "audit" | "internal";
export type NcrSeverity = "critical" | "major" | "minor";
export type DispositionType = "use-as-is" | "rework" | "repair" | "scrap" | "return-to-supplier" | "regrade";
export interface ContainmentAction {
    readonly id: Ulid;
    readonly description: string;
    readonly owner: UserId;
    readonly dueAt: IsoDateTime;
    readonly status: "open" | "done";
    readonly completedAt?: IsoDateTime;
    readonly completionNote?: string;
}
export interface Disposition {
    readonly type: DispositionType;
    readonly justification: string;
    readonly requiresApproval: boolean;
    readonly decidedBy: UserId;
    readonly decidedAt: IsoDateTime;
    readonly approvedBy?: UserId;
    readonly approvedAt?: IsoDateTime;
}
export interface NcrLinkage {
    readonly inspectionLotId?: Ulid;
    readonly supplierId?: string;
    readonly purchaseOrderRef?: string;
    readonly workOrderRef?: string;
    readonly customerRef?: string;
    readonly auditId?: Ulid;
}
interface NcrProps {
    ncrNumber: string;
    title: string;
    description: string;
    source: NcrSource;
    severity: NcrSeverity;
    status: NcrStatus;
    defectCode?: string;
    quantityAffected?: number;
    uom?: string;
    materialCode?: string;
    linkage: NcrLinkage;
    containmentActions: ContainmentAction[];
    disposition?: Disposition;
    capaId?: Ulid;
    closure?: {
        closedBy: UserId;
        closedAt: IsoDateTime;
        note?: string;
    };
    cancellation?: {
        cancelledBy: UserId;
        cancelledAt: IsoDateTime;
        reason: string;
    };
}
export declare class NonConformanceReport extends AggregateRoot<NcrProps> {
    private constructor();
    static create(tenantId: TenantId, input: {
        ncrNumber: string;
        title: string;
        description: string;
        source: NcrSource;
        severity: NcrSeverity;
        defectCode?: string;
        quantityAffected?: number;
        uom?: string;
        materialCode?: string;
        linkage?: NcrLinkage;
    }): NonConformanceReport;
    static rehydrate(tenantId: TenantId, props: NcrProps, existing: Partial<EntityProps>): NonConformanceReport;
    get ncrNumber(): string;
    get status(): NcrStatus;
    get severity(): NcrSeverity;
    get source(): NcrSource;
    get linkage(): NcrLinkage;
    get containmentActions(): readonly ContainmentAction[];
    get disposition(): Disposition | undefined;
    get capaId(): Ulid | undefined;
    get quantityAffected(): number | undefined;
    get materialCode(): string | undefined;
    get title(): string;
    get description(): string;
    submit(): void;
    startContainment(): void;
    addContainmentAction(input: {
        description: string;
        owner: UserId;
        dueAt: IsoDateTime;
    }): ContainmentAction;
    completeContainmentAction(actionId: Ulid, note?: string): ContainmentAction;
    moveToDisposition(): void;
    recordDisposition(input: {
        type: DispositionType;
        justification: string;
        decidedBy: UserId;
    }): Disposition;
    approveDisposition(approvedBy: UserId): void;
    linkCapa(capaId: Ulid): void;
    close(closedBy: UserId, note?: string): void;
    cancel(cancelledBy: UserId, reason: string): void;
}
export {};
//# sourceMappingURL=ncr.d.ts.map