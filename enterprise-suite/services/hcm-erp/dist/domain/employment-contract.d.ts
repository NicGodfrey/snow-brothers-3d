import { AggregateRoot, type IsoDateTime, type Money, type TenantId, type Ulid } from "@enterprise-suite/shared-kernel";
import { type IsoDate } from "./common.js";
export type ContractType = "permanent" | "fixed_term" | "contractor" | "intern";
export type ContractStatus = "draft" | "active" | "terminated" | "expired";
export type PayFrequency = "monthly" | "biweekly" | "weekly";
/** One recorded change to an active contract's terms. */
export interface ContractAmendment {
    readonly amendmentNumber: number;
    readonly effectiveDate: IsoDate;
    readonly amendedAt: IsoDateTime;
    readonly amendedBy: Ulid;
    readonly changes: Readonly<Partial<AmendableTerms>>;
    readonly note?: string;
}
export interface AmendableTerms {
    fte: number;
    weeklyHours: number;
    endDate: IsoDate;
    baseSalary: Money;
}
export interface EmploymentContractProps {
    employeeId: Ulid;
    positionId: Ulid;
    contractType: ContractType;
    startDate: IsoDate;
    endDate?: IsoDate;
    probationEndDate?: IsoDate;
    fte: number;
    weeklyHours: number;
    baseSalary: Money;
    payFrequency: PayFrequency;
    status: ContractStatus;
    terminatedDate?: IsoDate;
    terminationNote?: string;
    amendments: ContractAmendment[];
}
export declare class EmploymentContract extends AggregateRoot<EmploymentContractProps> {
    private constructor();
    static draft(tenantId: TenantId, input: {
        employeeId: Ulid;
        positionId: Ulid;
        contractType: ContractType;
        startDate: IsoDate;
        endDate?: IsoDate;
        probationEndDate?: IsoDate;
        fte?: number;
        weeklyHours?: number;
        baseSalary: Money;
        payFrequency?: PayFrequency;
    }): EmploymentContract;
    private static validateTerms;
    get employeeId(): Ulid;
    get positionId(): Ulid;
    get contractType(): ContractType;
    get status(): ContractStatus;
    get startDate(): IsoDate;
    get endDate(): IsoDate | undefined;
    get baseSalary(): Money;
    get payFrequency(): PayFrequency;
    get fte(): number;
    get weeklyHours(): number;
    get amendments(): readonly ContractAmendment[];
    isActive(): boolean;
    activate(): void;
    /**
     * Records a versioned amendment to an active contract. Only whitelisted
     * terms can change; each amendment captures the delta and audit fields.
     */
    amend(input: {
        effectiveDate: IsoDate;
        amendedBy: Ulid;
        changes: Partial<AmendableTerms>;
        note?: string;
    }): ContractAmendment;
    terminate(input: {
        terminationDate: IsoDate;
        note?: string;
    }): void;
    /**
     * Fixed-term contracts pass their end date; called by a scheduled job /
     * service sweep. Returns true when the contract transitioned to expired.
     */
    markExpired(asOf: IsoDate): boolean;
}
//# sourceMappingURL=employment-contract.d.ts.map