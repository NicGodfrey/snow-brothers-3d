import {
  AggregateRoot,
  DomainError,
  envelope,
  nowIso,
  type IsoDateTime,
  type Money,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { compareDates, type IsoDate } from "./common.js";
import { HcmEvents } from "./events.js";

export type ContractType = "permanent" | "fixed_term" | "contractor" | "intern";
export type ContractStatus = "draft" | "active" | "terminated" | "expired";
export type PayFrequency = "monthly" | "biweekly" | "weekly";

const MAX_WEEKLY_HOURS = 60;

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

export class EmploymentContract extends AggregateRoot<EmploymentContractProps> {
  private constructor(tenantId: TenantId, props: EmploymentContractProps) {
    super(tenantId, props);
  }

  static draft(
    tenantId: TenantId,
    input: {
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
    },
  ): EmploymentContract {
    const fte = input.fte ?? 1;
    const weeklyHours = input.weeklyHours ?? Math.round(40 * fte);
    EmploymentContract.validateTerms({
      contractType: input.contractType,
      startDate: input.startDate,
      endDate: input.endDate,
      probationEndDate: input.probationEndDate,
      fte,
      weeklyHours,
      baseSalary: input.baseSalary,
    });
    const contract = new EmploymentContract(tenantId, {
      employeeId: input.employeeId,
      positionId: input.positionId,
      contractType: input.contractType,
      startDate: input.startDate,
      endDate: input.endDate,
      probationEndDate: input.probationEndDate,
      fte,
      weeklyHours,
      baseSalary: input.baseSalary,
      payFrequency: input.payFrequency ?? "monthly",
      status: "draft",
      amendments: [],
    });
    contract.raise(
      envelope({
        eventType: HcmEvents.ContractDrafted,
        aggregateType: "EmploymentContract",
        aggregateId: contract.id,
        tenantId,
        payload: {
          employeeId: input.employeeId,
          positionId: input.positionId,
          contractType: input.contractType,
          startDate: input.startDate,
        },
      }),
    );
    return contract;
  }

  private static validateTerms(input: {
    contractType: ContractType;
    startDate: IsoDate;
    endDate?: IsoDate;
    probationEndDate?: IsoDate;
    fte: number;
    weeklyHours: number;
    baseSalary: Money;
  }): void {
    const fixedDuration = input.contractType === "fixed_term" || input.contractType === "intern";
    if (fixedDuration && !input.endDate) {
      throw new DomainError(
        `A ${input.contractType} contract requires an end date`,
        "CONTRACT_END_DATE_REQUIRED",
      );
    }
    if (input.contractType === "permanent" && input.endDate) {
      throw new DomainError("A permanent contract cannot have an end date", "CONTRACT_END_DATE_FORBIDDEN");
    }
    if (input.endDate && compareDates(input.endDate, input.startDate) <= 0) {
      throw new DomainError(
        `Contract end date ${input.endDate} must be after start date ${input.startDate}`,
        "INVALID_CONTRACT_DATES",
      );
    }
    if (input.probationEndDate && compareDates(input.probationEndDate, input.startDate) <= 0) {
      throw new DomainError("Probation end date must be after contract start date", "INVALID_PROBATION_DATE");
    }
    if (input.fte <= 0 || input.fte > 1) {
      throw new DomainError(`Contract FTE must be in (0, 1], got ${input.fte}`, "INVALID_FTE");
    }
    if (input.weeklyHours <= 0 || input.weeklyHours > MAX_WEEKLY_HOURS) {
      throw new DomainError(
        `Weekly hours must be in (0, ${MAX_WEEKLY_HOURS}], got ${input.weeklyHours}`,
        "INVALID_WEEKLY_HOURS",
      );
    }
    if (input.baseSalary.amountMinor <= 0) {
      throw new DomainError("Base salary must be positive", "INVALID_SALARY");
    }
  }

  get employeeId(): Ulid {
    return this.props.employeeId;
  }
  get positionId(): Ulid {
    return this.props.positionId;
  }
  get contractType(): ContractType {
    return this.props.contractType;
  }
  get status(): ContractStatus {
    return this.props.status;
  }
  get startDate(): IsoDate {
    return this.props.startDate;
  }
  get endDate(): IsoDate | undefined {
    return this.props.endDate;
  }
  get baseSalary(): Money {
    return this.props.baseSalary;
  }
  get payFrequency(): PayFrequency {
    return this.props.payFrequency;
  }
  get fte(): number {
    return this.props.fte;
  }
  get weeklyHours(): number {
    return this.props.weeklyHours;
  }
  get amendments(): readonly ContractAmendment[] {
    return this.props.amendments;
  }

  isActive(): boolean {
    return this.props.status === "active";
  }

  activate(): void {
    if (this.props.status !== "draft") {
      throw new DomainError(
        `Only draft contracts can be activated (status: ${this.props.status})`,
        "CONTRACT_NOT_DRAFT",
        409,
      );
    }
    this.props.status = "active";
    this.raise(
      envelope({
        eventType: HcmEvents.ContractActivated,
        aggregateType: "EmploymentContract",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          employeeId: this.props.employeeId,
          positionId: this.props.positionId,
          startDate: this.props.startDate,
          baseSalary: this.props.baseSalary,
        },
      }),
    );
  }

  /**
   * Records a versioned amendment to an active contract. Only whitelisted
   * terms can change; each amendment captures the delta and audit fields.
   */
  amend(input: {
    effectiveDate: IsoDate;
    amendedBy: Ulid;
    changes: Partial<AmendableTerms>;
    note?: string;
  }): ContractAmendment {
    if (this.props.status !== "active") {
      throw new DomainError(
        `Only active contracts can be amended (status: ${this.props.status})`,
        "CONTRACT_NOT_ACTIVE",
        409,
      );
    }
    const { changes } = input;
    if (Object.keys(changes).length === 0) {
      throw new DomainError("Amendment must change at least one term", "EMPTY_AMENDMENT");
    }
    if (compareDates(input.effectiveDate, this.props.startDate) < 0) {
      throw new DomainError("Amendment cannot take effect before the contract start", "INVALID_AMENDMENT_DATE");
    }
    const last = this.props.amendments[this.props.amendments.length - 1];
    if (last && compareDates(input.effectiveDate, last.effectiveDate) < 0) {
      throw new DomainError(
        `Amendment effective date ${input.effectiveDate} precedes previous amendment (${last.effectiveDate})`,
        "AMENDMENT_OUT_OF_ORDER",
      );
    }

    EmploymentContract.validateTerms({
      contractType: this.props.contractType,
      startDate: this.props.startDate,
      endDate: changes.endDate ?? this.props.endDate,
      probationEndDate: this.props.probationEndDate,
      fte: changes.fte ?? this.props.fte,
      weeklyHours: changes.weeklyHours ?? this.props.weeklyHours,
      baseSalary: changes.baseSalary ?? this.props.baseSalary,
    });
    if (changes.baseSalary && changes.baseSalary.currency !== this.props.baseSalary.currency) {
      throw new DomainError(
        `Amendment cannot change salary currency (${this.props.baseSalary.currency} → ${changes.baseSalary.currency})`,
        "CURRENCY_MISMATCH",
      );
    }

    const amendment: ContractAmendment = {
      amendmentNumber: this.props.amendments.length + 1,
      effectiveDate: input.effectiveDate,
      amendedAt: nowIso(),
      amendedBy: input.amendedBy,
      changes: { ...changes },
      note: input.note,
    };
    this.props.amendments.push(amendment);
    if (changes.fte !== undefined) this.props.fte = changes.fte;
    if (changes.weeklyHours !== undefined) this.props.weeklyHours = changes.weeklyHours;
    if (changes.endDate !== undefined) this.props.endDate = changes.endDate;
    if (changes.baseSalary !== undefined) this.props.baseSalary = changes.baseSalary;

    this.raise(
      envelope({
        eventType: HcmEvents.ContractAmended,
        aggregateType: "EmploymentContract",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          employeeId: this.props.employeeId,
          amendmentNumber: amendment.amendmentNumber,
          effectiveDate: amendment.effectiveDate,
          changes: amendment.changes,
        },
      }),
    );
    return amendment;
  }

  terminate(input: { terminationDate: IsoDate; note?: string }): void {
    if (this.props.status !== "active") {
      throw new DomainError(
        `Only active contracts can be terminated (status: ${this.props.status})`,
        "CONTRACT_NOT_ACTIVE",
        409,
      );
    }
    if (compareDates(input.terminationDate, this.props.startDate) < 0) {
      throw new DomainError("Contract termination date precedes its start date", "INVALID_TERMINATION_DATE");
    }
    this.props.status = "terminated";
    this.props.terminatedDate = input.terminationDate;
    this.props.terminationNote = input.note;
    this.raise(
      envelope({
        eventType: HcmEvents.ContractTerminated,
        aggregateType: "EmploymentContract",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          employeeId: this.props.employeeId,
          positionId: this.props.positionId,
          terminationDate: input.terminationDate,
        },
      }),
    );
  }

  /**
   * Fixed-term contracts pass their end date; called by a scheduled job /
   * service sweep. Returns true when the contract transitioned to expired.
   */
  markExpired(asOf: IsoDate): boolean {
    if (this.props.status !== "active") return false;
    if (!this.props.endDate || compareDates(asOf, this.props.endDate) <= 0) return false;
    this.props.status = "expired";
    this.raise(
      envelope({
        eventType: HcmEvents.ContractExpired,
        aggregateType: "EmploymentContract",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { employeeId: this.props.employeeId, endDate: this.props.endDate },
      }),
    );
    return true;
  }
}
