import { AggregateRoot, type IsoDateTime, type Money, type TenantId, type Ulid } from "@enterprise-suite/shared-kernel";
import type { IsoDate } from "./common.js";
export type RequisitionStatus = "draft" | "pending_approval" | "open" | "on_hold" | "filled" | "cancelled";
export interface RequisitionApproval {
    readonly approverId: Ulid;
    readonly decision: "approved" | "rejected";
    readonly decidedAt: IsoDateTime;
    readonly comment?: string;
}
export interface SalaryBand {
    readonly min: Money;
    readonly max: Money;
}
export interface HiringRequisitionProps {
    positionId: Ulid;
    orgUnitId: Ulid;
    title: string;
    headcount: number;
    hiringManagerId: Ulid;
    recruiterId?: Ulid;
    justification: string;
    salaryBand?: SalaryBand;
    targetStartDate?: IsoDate;
    status: RequisitionStatus;
    approvals: RequisitionApproval[];
    hiredEmployeeIds: Ulid[];
    openedAt?: IsoDateTime;
    filledAt?: IsoDateTime;
    holdNote?: string;
    cancellationNote?: string;
}
/**
 * Requisition lifecycle:
 *   draft → pending_approval → open ⇄ on_hold → filled
 * with cancellation possible from every non-terminal state.
 */
export declare class HiringRequisition extends AggregateRoot<HiringRequisitionProps> {
    private constructor();
    static createDraft(tenantId: TenantId, input: {
        positionId: Ulid;
        orgUnitId: Ulid;
        title: string;
        headcount?: number;
        hiringManagerId: Ulid;
        recruiterId?: Ulid;
        justification: string;
        salaryBand?: SalaryBand;
        targetStartDate?: IsoDate;
    }): HiringRequisition;
    get positionId(): Ulid;
    get orgUnitId(): Ulid;
    get title(): string;
    get status(): RequisitionStatus;
    get headcount(): number;
    get hiringManagerId(): Ulid;
    get approvals(): readonly RequisitionApproval[];
    get hiredEmployeeIds(): readonly Ulid[];
    get salaryBand(): SalaryBand | undefined;
    get remainingHeadcount(): number;
    submitForApproval(): void;
    approve(approverId: Ulid, comment?: string): void;
    reject(approverId: Ulid, comment: string): void;
    hold(note: string): void;
    resume(): void;
    /** Records a completed hire; transitions to filled once headcount is reached. */
    recordHire(employeeId: Ulid): void;
    cancel(note: string): void;
    private assertStatus;
}
//# sourceMappingURL=requisition.d.ts.map