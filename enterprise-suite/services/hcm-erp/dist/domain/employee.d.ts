import { AggregateRoot, type TenantId, type Ulid } from "@enterprise-suite/shared-kernel";
import { type IsoDate } from "./common.js";
export type EmployeeStatus = "active" | "on_leave" | "suspended" | "terminated";
export type TerminationReason = "resignation" | "dismissal" | "redundancy" | "retirement" | "end_of_contract" | "other";
export declare const TERMINATION_REASONS: readonly TerminationReason[];
export interface EmployeeProps {
    employeeNumber: string;
    firstName: string;
    lastName: string;
    email: string;
    hireDate: IsoDate;
    status: EmployeeStatus;
    managerEmployeeId?: Ulid;
    primaryPositionId?: Ulid;
    terminationDate?: IsoDate;
    terminationReason?: TerminationReason;
    rehireEligible?: boolean;
}
export declare class Employee extends AggregateRoot<EmployeeProps> {
    private constructor();
    static hire(tenantId: TenantId, input: {
        employeeNumber: string;
        firstName: string;
        lastName: string;
        email: string;
        hireDate: IsoDate;
        managerEmployeeId?: Ulid;
    }): Employee;
    get employeeNumber(): string;
    get fullName(): string;
    get email(): string;
    get hireDate(): IsoDate;
    get status(): EmployeeStatus;
    get managerEmployeeId(): Ulid | undefined;
    get primaryPositionId(): Ulid | undefined;
    get terminationDate(): IsoDate | undefined;
    isEmployed(): boolean;
    updateContactInfo(input: {
        firstName?: string;
        lastName?: string;
        email?: string;
    }): void;
    /** Manager existence/active checks belong to EmployeeService; local rule: no self-management. */
    changeManager(managerEmployeeId: Ulid | undefined): void;
    assignPrimaryPosition(positionId: Ulid): void;
    clearPrimaryPosition(): void;
    placeOnLeave(): void;
    returnFromLeave(): void;
    suspend(reason: string): void;
    reinstate(): void;
    terminate(input: {
        terminationDate: IsoDate;
        reason: TerminationReason;
        rehireEligible: boolean;
    }): void;
    private assertEmployed;
}
//# sourceMappingURL=employee.d.ts.map