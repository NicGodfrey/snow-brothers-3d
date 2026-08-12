import { AggregateRoot, type TenantId, type Ulid } from "@enterprise-suite/shared-kernel";
export type PositionStatus = "open" | "filled" | "frozen" | "eliminated";
/** Individual-contributor and management grade ladders. */
export declare const GRADES: readonly ["IC1", "IC2", "IC3", "IC4", "IC5", "IC6", "IC7", "M1", "M2", "M3", "M4", "M5"];
export type Grade = (typeof GRADES)[number];
export interface PositionProps {
    orgUnitId: Ulid;
    title: string;
    jobFamily: string;
    grade: Grade;
    fte: number;
    reportsToPositionId?: Ulid;
    status: PositionStatus;
    currentEmployeeId?: Ulid;
}
export declare class Position extends AggregateRoot<PositionProps> {
    private constructor();
    static open(tenantId: TenantId, input: {
        orgUnitId: Ulid;
        title: string;
        jobFamily: string;
        grade: Grade;
        fte?: number;
        reportsToPositionId?: Ulid;
    }): Position;
    get orgUnitId(): Ulid;
    get title(): string;
    get grade(): Grade;
    get status(): PositionStatus;
    get currentEmployeeId(): Ulid | undefined;
    get reportsToPositionId(): Ulid | undefined;
    get fte(): number;
    isFillable(): boolean;
    fill(employeeId: Ulid): void;
    vacate(): void;
    freeze(reason: string): void;
    unfreeze(): void;
    eliminate(): void;
    changeReportsTo(reportsToPositionId: Ulid | undefined): void;
}
//# sourceMappingURL=position.d.ts.map