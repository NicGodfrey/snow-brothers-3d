/**
 * CAPA (Corrective / Preventive Action) aggregate.
 *
 * A CAPA case drives systematic problem solving beyond the immediate
 * disposition of an NCR: root cause analysis, planned actions, verified
 * implementation, and an effectiveness check before closure.
 *
 * Workflow:
 *   draft -> open -> investigation -> action-planning -> implementation
 *         -> verification -> closed
 *   verification -> action-planning   (effectiveness check failed)
 *   any non-terminal -> cancelled
 *
 * Guards (the heart of the model):
 *  - investigation -> action-planning requires a recorded root cause analysis
 *  - action-planning -> implementation requires >= 1 corrective/preventive action
 *  - implementation -> verification requires every action completed or cancelled
 *  - verification -> closed requires an "effective" effectiveness check
 */
import { AggregateRoot, type EntityProps, type IsoDateTime, type TenantId, type Ulid, type UserId } from "@enterprise-suite/shared-kernel";
export type CapaStatus = "draft" | "open" | "investigation" | "action-planning" | "implementation" | "verification" | "closed" | "cancelled";
export type CapaType = "corrective" | "preventive";
export type CapaPriority = "low" | "medium" | "high" | "urgent";
export type RootCauseMethod = "5-whys" | "fishbone" | "8d" | "fault-tree" | "other";
export type CapaActionType = "containment" | "corrective" | "preventive";
export type CapaActionStatus = "open" | "in-progress" | "completed" | "cancelled";
export interface RiskRating {
    /** 1 (negligible) .. 5 (catastrophic) */
    readonly severity: number;
    /** 1 (rare) .. 5 (frequent) */
    readonly occurrence: number;
    /** 1 (certain detection) .. 5 (undetectable) */
    readonly detection: number;
    /** Risk priority number = severity * occurrence * detection (1..125). */
    readonly rpn: number;
}
export interface RootCauseAnalysis {
    readonly method: RootCauseMethod;
    readonly summary: string;
    readonly causes: readonly {
        readonly category?: string;
        readonly description: string;
    }[];
    readonly completedBy: UserId;
    readonly completedAt: IsoDateTime;
}
export interface CapaAction {
    readonly id: Ulid;
    readonly type: CapaActionType;
    readonly description: string;
    readonly owner: UserId;
    readonly dueAt: IsoDateTime;
    readonly status: CapaActionStatus;
    readonly completedAt?: IsoDateTime;
    readonly completionNote?: string;
}
export interface EffectivenessCheck {
    readonly criteria: string;
    readonly dueAt: IsoDateTime;
    readonly outcome?: "effective" | "not-effective";
    readonly verifiedBy?: UserId;
    readonly verifiedAt?: IsoDateTime;
    readonly note?: string;
}
export interface CapaSourceLinkage {
    readonly ncrIds: Ulid[];
    readonly auditId?: Ulid;
    readonly supplierEventId?: Ulid;
    readonly supplierId?: string;
    readonly customerRef?: string;
}
interface CapaProps {
    capaNumber: string;
    type: CapaType;
    title: string;
    description: string;
    priority: CapaPriority;
    status: CapaStatus;
    riskRating?: RiskRating;
    source: CapaSourceLinkage;
    rootCause?: RootCauseAnalysis;
    actions: CapaAction[];
    effectiveness?: EffectivenessCheck;
    owner: UserId;
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
    /** Count of verification failures that sent the case back to planning. */
    reworkCycles: number;
}
export declare function riskRating(severity: number, occurrence: number, detection: number): RiskRating;
export declare class CapaCase extends AggregateRoot<CapaProps> {
    private constructor();
    static create(tenantId: TenantId, input: {
        capaNumber: string;
        type: CapaType;
        title: string;
        description: string;
        priority: CapaPriority;
        owner: UserId;
        riskRating?: RiskRating;
        source?: Partial<CapaSourceLinkage>;
    }): CapaCase;
    static rehydrate(tenantId: TenantId, props: CapaProps, existing: Partial<EntityProps>): CapaCase;
    get capaNumber(): string;
    get status(): CapaStatus;
    get type(): CapaType;
    get priority(): CapaPriority;
    get owner(): UserId;
    get rootCause(): RootCauseAnalysis | undefined;
    get actions(): readonly CapaAction[];
    get effectiveness(): EffectivenessCheck | undefined;
    get source(): CapaSourceLinkage;
    get riskRating(): RiskRating | undefined;
    get reworkCycles(): number;
    private transition;
    submit(): void;
    startInvestigation(): void;
    recordRootCause(input: {
        method: RootCauseMethod;
        summary: string;
        causes: readonly {
            category?: string;
            description: string;
        }[];
        completedBy: UserId;
    }): void;
    moveToActionPlanning(): void;
    addAction(input: {
        type: CapaActionType;
        description: string;
        owner: UserId;
        dueAt: IsoDateTime;
    }): CapaAction;
    startAction(actionId: Ulid): CapaAction;
    completeAction(actionId: Ulid, note?: string): CapaAction;
    cancelAction(actionId: Ulid, reason: string): CapaAction;
    private updateAction;
    beginImplementation(): void;
    defineEffectivenessCheck(input: {
        criteria: string;
        dueAt: IsoDateTime;
    }): void;
    requestVerification(): void;
    recordEffectiveness(input: {
        outcome: "effective" | "not-effective";
        verifiedBy: UserId;
        note?: string;
    }): void;
    /** Verification failed: go back to planning for another cycle. */
    returnToPlanning(): void;
    close(closedBy: UserId, note?: string): void;
    cancel(cancelledBy: UserId, reason: string): void;
    linkNcr(ncrId: Ulid): void;
    overdueActions(now: IsoDateTime): CapaAction[];
}
export {};
//# sourceMappingURL=capa.d.ts.map