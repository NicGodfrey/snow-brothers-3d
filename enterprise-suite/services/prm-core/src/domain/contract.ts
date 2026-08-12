import {
  AggregateRoot,
  envelope,
  newId,
  type EntityProps,
  type IsoDateTime,
  type Money,
  type TenantId,
  type Ulid,
  type UserId,
} from "@enterprise-suite/shared-kernel";
import { addMonths, assertOrderedRange, isAfter, isBefore, parseIso, withinRange } from "./dates.js";
import { InvalidStateError, SegregationOfDutiesError, ValidationError, type ValidationIssue } from "./errors.js";
import { PrmEventTypes } from "./events.js";
import { requireNonNegative } from "./money.js";

/**
 * Partner contract aggregate: the paper that makes a partner a partner.
 *
 *   draft → pending_signature → active → expired
 *      \           \               \→ terminated
 *       \→ cancelled ←/
 *
 * Terms are freely editable while drafting. Once both parties have signed and
 * the contract is active, commercial terms change only through *amendments* —
 * an append-only list that carries its own effective date, so historical
 * pricing stays reconstructible. The discount schedule is scope-based:
 * `"*"` is the fallback, a category code overrides it.
 */

export type ContractType = "reseller" | "distribution" | "referral" | "msp" | "nda" | "mdf_terms";

export const CONTRACT_TYPES: readonly ContractType[] = [
  "reseller",
  "distribution",
  "referral",
  "msp",
  "nda",
  "mdf_terms",
];

/** Contract types that grant the right to transact; one active at a time. */
export const TRADING_CONTRACT_TYPES: readonly ContractType[] = ["reseller", "distribution", "msp", "referral"];

export type ContractStatus =
  | "draft"
  | "pending_signature"
  | "active"
  | "expired"
  | "terminated"
  | "cancelled";

export const CONTRACT_STATUSES: readonly ContractStatus[] = [
  "draft",
  "pending_signature",
  "active",
  "expired",
  "terminated",
  "cancelled",
];

export type SignatureParty = "partner" | "vendor";

export interface ContractSignature {
  readonly party: SignatureParty;
  readonly signatoryName: string;
  readonly signatoryEmail: string;
  readonly signatoryTitle?: string;
  readonly signedAt: IsoDateTime;
  readonly recordedBy: UserId;
}

export interface DiscountLine {
  readonly id: Ulid;
  /** `"*"` or a product-category code from PLM. */
  readonly scope: string;
  readonly discountBps: number;
  /** Volume gate: the line applies once the partner books this much in the term. */
  readonly minAnnualVolume?: Money;
  readonly note?: string;
}

export type ObligationStatus = "pending" | "met" | "waived" | "breached";

export interface ContractObligation {
  readonly id: Ulid;
  readonly code: string;
  readonly description: string;
  readonly dueAt?: IsoDateTime;
  readonly status: ObligationStatus;
  readonly evidence?: string;
  readonly recordedAt?: IsoDateTime;
  readonly recordedBy?: UserId;
}

export interface ContractAmendment {
  readonly id: Ulid;
  readonly sequence: number;
  readonly summary: string;
  readonly effectiveFrom: IsoDateTime;
  readonly previousBaseDiscountBps: number;
  readonly baseDiscountBps: number;
  readonly previousEffectiveTo: IsoDateTime;
  readonly effectiveTo: IsoDateTime;
  readonly amendedBy: UserId;
  readonly amendedAt: IsoDateTime;
}

export interface ContractTerms {
  effectiveFrom: IsoDateTime;
  effectiveTo: IsoDateTime;
  autoRenew: boolean;
  renewalTermMonths: number;
  /** Days of written notice required to terminate or to stop auto-renewal. */
  noticeDays: number;
  paymentTermsDays: number;
  baseDiscountBps: number;
  mdfEligible: boolean;
  mdfAccrualBps: number;
  revenueCommitment?: Money;
  governingLaw?: string;
}

export interface ContractProps extends ContractTerms {
  number: string;
  partnerId: Ulid;
  type: ContractType;
  status: ContractStatus;
  currency: string;
  title: string;
  discountSchedule: DiscountLine[];
  obligations: ContractObligation[];
  signatures: ContractSignature[];
  amendments: ContractAmendment[];
  renewalCount: number;
  sentForSignatureAt?: IsoDateTime;
  activatedAt?: IsoDateTime;
  expiredAt?: IsoDateTime;
  terminatedAt?: IsoDateTime;
  terminationReason?: string;
  cancelledReason?: string;
  breachFlaggedAt?: IsoDateTime;
}

export interface CreateContractInput {
  readonly number: string;
  readonly partnerId: Ulid;
  readonly type: ContractType;
  readonly title?: string;
  readonly currency: string;
  readonly effectiveFrom: IsoDateTime;
  readonly effectiveTo: IsoDateTime;
  readonly autoRenew?: boolean;
  readonly renewalTermMonths?: number;
  readonly noticeDays?: number;
  readonly paymentTermsDays?: number;
  readonly baseDiscountBps?: number;
  readonly mdfEligible?: boolean;
  readonly mdfAccrualBps?: number;
  readonly revenueCommitment?: Money;
  readonly governingLaw?: string;
}

export interface UpdateContractTermsInput {
  readonly effectiveFrom?: IsoDateTime;
  readonly effectiveTo?: IsoDateTime;
  readonly autoRenew?: boolean;
  readonly renewalTermMonths?: number;
  readonly noticeDays?: number;
  readonly paymentTermsDays?: number;
  readonly baseDiscountBps?: number;
  readonly mdfEligible?: boolean;
  readonly mdfAccrualBps?: number;
  readonly revenueCommitment?: Money;
  readonly governingLaw?: string;
}

function assertBps(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 10_000) {
    throw ValidationError.single(field, "must be an integer between 0 and 10000");
  }
  return value;
}

function assertPositiveInt(value: number, field: string, max = 3650): number {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw ValidationError.single(field, `must be an integer between 0 and ${max}`);
  }
  return value;
}

function normalizeScope(scope: string): string {
  const value = scope.trim().toLowerCase();
  if (value.length === 0) throw ValidationError.single("scope", "is required");
  if (value !== "*" && !/^[a-z0-9][a-z0-9_-]{1,40}$/.test(value)) {
    throw ValidationError.single("scope", 'must be "*" or a category code');
  }
  return value;
}

export class PartnerContract extends AggregateRoot<ContractProps> {
  static create(tenantId: TenantId, input: CreateContractInput): PartnerContract {
    if (!CONTRACT_TYPES.includes(input.type)) {
      throw ValidationError.single("type", `must be one of [${CONTRACT_TYPES.join(", ")}]`);
    }
    const currency = input.currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw ValidationError.single("currency", "must be a 3-letter ISO currency code");
    }
    const effectiveFrom = parseIso(input.effectiveFrom, "effectiveFrom");
    const effectiveTo = parseIso(input.effectiveTo, "effectiveTo");
    assertOrderedRange(effectiveFrom, effectiveTo, "effectiveTo");
    const mdfAccrualBps = assertBps(input.mdfAccrualBps ?? 0, "mdfAccrualBps");
    const mdfEligible = input.mdfEligible ?? mdfAccrualBps > 0;
    if (mdfAccrualBps > 0 && !mdfEligible) {
      throw ValidationError.single("mdfEligible", "must be true when an accrual rate is set");
    }
    if (input.revenueCommitment) {
      requireNonNegative(input.revenueCommitment, "revenueCommitment");
      if (input.revenueCommitment.currency !== currency) {
        throw ValidationError.single("revenueCommitment.currency", `must match the contract currency ${currency}`);
      }
    }

    const contract = new PartnerContract(tenantId, {
      number: input.number,
      partnerId: input.partnerId,
      type: input.type,
      status: "draft",
      currency,
      title: (input.title ?? `${input.type} agreement`).trim(),
      effectiveFrom,
      effectiveTo,
      autoRenew: input.autoRenew ?? false,
      renewalTermMonths: assertPositiveInt(input.renewalTermMonths ?? 12, "renewalTermMonths", 120),
      noticeDays: assertPositiveInt(input.noticeDays ?? 30, "noticeDays", 365),
      paymentTermsDays: assertPositiveInt(input.paymentTermsDays ?? 30, "paymentTermsDays", 365),
      baseDiscountBps: assertBps(input.baseDiscountBps ?? 0, "baseDiscountBps"),
      mdfEligible,
      mdfAccrualBps,
      revenueCommitment: input.revenueCommitment,
      governingLaw: input.governingLaw?.trim() || undefined,
      discountSchedule: [],
      obligations: [],
      signatures: [],
      amendments: [],
      renewalCount: 0,
    });
    contract.raise(contract.identityEvent(PrmEventTypes.ContractDrafted));
    return contract;
  }

  static fromSnapshot(snapshot: EntityProps & ContractProps): PartnerContract {
    const { id, tenantId, createdAt, updatedAt, version, ...props } = snapshot;
    return new PartnerContract(
      tenantId,
      {
        ...props,
        discountSchedule: [...props.discountSchedule],
        obligations: [...props.obligations],
        signatures: [...props.signatures],
        amendments: [...props.amendments],
      },
      { id, createdAt, updatedAt, version },
    );
  }

  // --- accessors -------------------------------------------------------------

  get number(): string {
    return this.props.number;
  }
  get partnerId(): Ulid {
    return this.props.partnerId;
  }
  get type(): ContractType {
    return this.props.type;
  }
  get status(): ContractStatus {
    return this.props.status;
  }
  get currency(): string {
    return this.props.currency;
  }
  get effectiveFrom(): IsoDateTime {
    return this.props.effectiveFrom;
  }
  get effectiveTo(): IsoDateTime {
    return this.props.effectiveTo;
  }
  get autoRenew(): boolean {
    return this.props.autoRenew;
  }
  get baseDiscountBps(): number {
    return this.props.baseDiscountBps;
  }
  get mdfEligible(): boolean {
    return this.props.mdfEligible;
  }
  get mdfAccrualBps(): number {
    return this.props.mdfAccrualBps;
  }
  get discountSchedule(): readonly DiscountLine[] {
    return this.props.discountSchedule;
  }
  get obligations(): readonly ContractObligation[] {
    return this.props.obligations;
  }
  get signatures(): readonly ContractSignature[] {
    return this.props.signatures;
  }
  get amendments(): readonly ContractAmendment[] {
    return this.props.amendments;
  }
  get renewalCount(): number {
    return this.props.renewalCount;
  }
  get terminationReason(): string | undefined {
    return this.props.terminationReason;
  }

  isFullySigned(): boolean {
    return (
      this.props.signatures.some((s) => s.party === "partner") &&
      this.props.signatures.some((s) => s.party === "vendor")
    );
  }

  /** Active *and* inside its term at the given instant. */
  isEffectiveAt(at: IsoDateTime): boolean {
    return (
      this.props.status === "active" &&
      withinRange({ from: this.props.effectiveFrom, to: this.props.effectiveTo }, at)
    );
  }

  /** Most specific discount wins: an exact scope match, otherwise the `*` line, otherwise base. */
  effectiveDiscountBps(scope = "*"): number {
    const wanted = scope.trim().toLowerCase();
    const exact = this.props.discountSchedule.find((l) => l.scope === wanted);
    if (exact) return exact.discountBps;
    const fallback = this.props.discountSchedule.find((l) => l.scope === "*");
    return fallback?.discountBps ?? this.props.baseDiscountBps;
  }

  hasOpenObligations(): boolean {
    return this.props.obligations.some((o) => o.status === "pending" || o.status === "breached");
  }

  // --- drafting --------------------------------------------------------------

  updateTerms(input: UpdateContractTermsInput): void {
    this.assertDraftLike("update terms");
    const next: ContractTerms = {
      effectiveFrom: input.effectiveFrom ? parseIso(input.effectiveFrom, "effectiveFrom") : this.props.effectiveFrom,
      effectiveTo: input.effectiveTo ? parseIso(input.effectiveTo, "effectiveTo") : this.props.effectiveTo,
      autoRenew: input.autoRenew ?? this.props.autoRenew,
      renewalTermMonths:
        input.renewalTermMonths !== undefined
          ? assertPositiveInt(input.renewalTermMonths, "renewalTermMonths", 120)
          : this.props.renewalTermMonths,
      noticeDays:
        input.noticeDays !== undefined
          ? assertPositiveInt(input.noticeDays, "noticeDays", 365)
          : this.props.noticeDays,
      paymentTermsDays:
        input.paymentTermsDays !== undefined
          ? assertPositiveInt(input.paymentTermsDays, "paymentTermsDays", 365)
          : this.props.paymentTermsDays,
      baseDiscountBps:
        input.baseDiscountBps !== undefined
          ? assertBps(input.baseDiscountBps, "baseDiscountBps")
          : this.props.baseDiscountBps,
      mdfEligible: input.mdfEligible ?? this.props.mdfEligible,
      mdfAccrualBps:
        input.mdfAccrualBps !== undefined
          ? assertBps(input.mdfAccrualBps, "mdfAccrualBps")
          : this.props.mdfAccrualBps,
      revenueCommitment: input.revenueCommitment ?? this.props.revenueCommitment,
      governingLaw: input.governingLaw?.trim() ?? this.props.governingLaw,
    };
    assertOrderedRange(next.effectiveFrom, next.effectiveTo, "effectiveTo");
    if (next.mdfAccrualBps > 0 && !next.mdfEligible) {
      throw ValidationError.single("mdfEligible", "must be true when an accrual rate is set");
    }
    if (next.revenueCommitment && next.revenueCommitment.currency !== this.props.currency) {
      throw ValidationError.single(
        "revenueCommitment.currency",
        `must match the contract currency ${this.props.currency}`,
      );
    }
    Object.assign(this.props, next);
    this.touch();
  }

  addDiscountLine(input: {
    readonly scope: string;
    readonly discountBps: number;
    readonly minAnnualVolume?: Money;
    readonly note?: string;
  }): DiscountLine {
    this.assertDraftLike("change the discount schedule");
    const scope = normalizeScope(input.scope);
    if (this.props.discountSchedule.some((l) => l.scope === scope)) {
      throw new InvalidStateError(`Discount scope "${scope}" is already on contract ${this.props.number}`);
    }
    if (input.minAnnualVolume) {
      requireNonNegative(input.minAnnualVolume, "minAnnualVolume");
      if (input.minAnnualVolume.currency !== this.props.currency) {
        throw ValidationError.single(
          "minAnnualVolume.currency",
          `must match the contract currency ${this.props.currency}`,
        );
      }
    }
    const line: DiscountLine = {
      id: newId("disc"),
      scope,
      discountBps: assertBps(input.discountBps, "discountBps"),
      minAnnualVolume: input.minAnnualVolume,
      note: input.note?.trim() || undefined,
    };
    this.props.discountSchedule.push(line);
    this.touch();
    return line;
  }

  removeDiscountLine(lineId: Ulid): void {
    this.assertDraftLike("change the discount schedule");
    const index = this.props.discountSchedule.findIndex((l) => l.id === lineId);
    if (index === -1) throw new InvalidStateError(`Discount line ${lineId} not found`);
    this.props.discountSchedule.splice(index, 1);
    this.touch();
  }

  addObligation(input: { readonly code: string; readonly description: string; readonly dueAt?: IsoDateTime }): ContractObligation {
    if (this.props.status === "expired" || this.props.status === "terminated" || this.props.status === "cancelled") {
      throw new InvalidStateError(`Cannot add obligations to a ${this.props.status} contract`);
    }
    const code = input.code.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{1,40}$/.test(code)) {
      throw ValidationError.single("code", "must be a lowercase obligation code");
    }
    if (this.props.obligations.some((o) => o.code === code)) {
      throw new InvalidStateError(`Obligation "${code}" already exists on ${this.props.number}`);
    }
    if (input.description.trim().length === 0) {
      throw ValidationError.single("description", "is required");
    }
    const obligation: ContractObligation = {
      id: newId("oblig"),
      code,
      description: input.description.trim(),
      dueAt: input.dueAt ? parseIso(input.dueAt, "dueAt") : undefined,
      status: "pending",
    };
    this.props.obligations.push(obligation);
    this.touch();
    return obligation;
  }

  recordObligation(input: {
    readonly code: string;
    readonly status: Exclude<ObligationStatus, "pending">;
    readonly evidence?: string;
    readonly at: IsoDateTime;
    readonly by: UserId;
  }): ContractObligation {
    const index = this.props.obligations.findIndex((o) => o.code === input.code.trim().toLowerCase());
    if (index === -1) throw new InvalidStateError(`Obligation "${input.code}" not found on ${this.props.number}`);
    if (input.status === "met" && (!input.evidence || input.evidence.trim().length === 0)) {
      throw ValidationError.single("evidence", "evidence is required when marking an obligation met");
    }
    const updated: ContractObligation = {
      ...this.props.obligations[index]!,
      status: input.status,
      evidence: input.evidence?.trim() || undefined,
      recordedAt: input.at,
      recordedBy: input.by,
    };
    this.props.obligations[index] = updated;
    this.raise(
      envelope({
        eventType:
          input.status === "breached" ? PrmEventTypes.ContractBreachFlagged : PrmEventTypes.ContractObligationRecorded,
        aggregateType: "PartnerContract",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          contractId: this.id,
          number: this.props.number,
          partnerId: this.props.partnerId,
          type: this.props.type,
          obligationCode: updated.code,
          status: updated.status,
        },
      }),
    );
    if (input.status === "breached") this.props.breachFlaggedAt = input.at;
    return updated;
  }

  // --- signature & lifecycle -------------------------------------------------

  sendForSignature(at: IsoDateTime): void {
    if (this.props.status !== "draft") {
      throw new InvalidStateError(`Contract ${this.props.number} is ${this.props.status}, not draft`);
    }
    const issues: ValidationIssue[] = [];
    if (this.props.type !== "nda" && this.props.discountSchedule.length === 0 && this.props.baseDiscountBps === 0) {
      issues.push({ field: "discountSchedule", message: "commercial contracts need a discount or a schedule" });
    }
    if (issues.length > 0) throw new ValidationError("Contract is not ready for signature", issues);
    this.props.status = "pending_signature";
    this.props.sentForSignatureAt = at;
    this.raise(this.identityEvent(PrmEventTypes.ContractSentForSignature));
  }

  /**
   * Records one party's signature. The same person may not sign for both
   * sides, and a party may not sign twice; the second signature does not
   * activate the contract by itself — activation is an explicit act so the
   * effective date can be respected.
   */
  sign(input: {
    readonly party: SignatureParty;
    readonly signatoryName: string;
    readonly signatoryEmail: string;
    readonly signatoryTitle?: string;
    readonly at: IsoDateTime;
    readonly by: UserId;
  }): ContractSignature {
    if (this.props.status !== "pending_signature") {
      throw new InvalidStateError(
        `Contract ${this.props.number} is ${this.props.status}; only contracts out for signature can be signed`,
      );
    }
    if (this.props.signatures.some((s) => s.party === input.party)) {
      throw new InvalidStateError(`The ${input.party} has already signed ${this.props.number}`);
    }
    const email = input.signatoryEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw ValidationError.single("signatoryEmail", "must be a valid email address");
    }
    const counterparty = this.props.signatures[0];
    if (counterparty && counterparty.signatoryEmail === email) {
      throw new SegregationOfDutiesError(
        `${email} already signed as the ${counterparty.party}; both sides cannot be the same person`,
      );
    }
    if (input.signatoryName.trim().length === 0) {
      throw ValidationError.single("signatoryName", "is required");
    }
    const signature: ContractSignature = {
      party: input.party,
      signatoryName: input.signatoryName.trim(),
      signatoryEmail: email,
      signatoryTitle: input.signatoryTitle?.trim() || undefined,
      signedAt: parseIso(input.at, "at"),
      recordedBy: input.by,
    };
    this.props.signatures.push(signature);
    this.raise(
      envelope({
        eventType: PrmEventTypes.ContractSigned,
        aggregateType: "PartnerContract",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          contractId: this.id,
          number: this.props.number,
          partnerId: this.props.partnerId,
          type: this.props.type,
          party: signature.party,
          signatoryEmail: signature.signatoryEmail,
          fullySigned: this.isFullySigned(),
        },
      }),
    );
    return signature;
  }

  activate(at: IsoDateTime): void {
    if (this.props.status !== "pending_signature") {
      throw new InvalidStateError(`Contract ${this.props.number} is ${this.props.status}, not pending signature`);
    }
    if (!this.isFullySigned()) {
      throw new InvalidStateError(`Contract ${this.props.number} needs both signatures before activation`);
    }
    if (isAfter(at, this.props.effectiveTo)) {
      throw new InvalidStateError(`Contract ${this.props.number} expired on ${this.props.effectiveTo}`);
    }
    this.props.status = "active";
    this.props.activatedAt = at;
    this.raise(
      envelope({
        eventType: PrmEventTypes.ContractActivated,
        aggregateType: "PartnerContract",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          contractId: this.id,
          number: this.props.number,
          partnerId: this.props.partnerId,
          type: this.props.type,
          effectiveFrom: this.props.effectiveFrom,
          effectiveTo: this.props.effectiveTo,
          autoRenew: this.props.autoRenew,
          baseDiscountBps: this.props.baseDiscountBps,
          mdfEligible: this.props.mdfEligible,
        },
      }),
    );
  }

  cancel(reason: string): void {
    if (this.props.status !== "draft" && this.props.status !== "pending_signature") {
      throw new InvalidStateError(`Only draft or unsigned contracts can be cancelled (${this.props.status})`);
    }
    if (reason.trim().length === 0) throw ValidationError.single("reason", "is required");
    this.props.status = "cancelled";
    this.props.cancelledReason = reason.trim();
    this.touch();
  }

  /**
   * Amends an active contract: changes the base discount and/or extends the
   * term, recorded as a numbered amendment with its own effective date.
   */
  amend(input: {
    readonly summary: string;
    readonly effectiveFrom: IsoDateTime;
    readonly baseDiscountBps?: number;
    readonly effectiveTo?: IsoDateTime;
    readonly by: UserId;
    readonly at: IsoDateTime;
  }): ContractAmendment {
    if (this.props.status !== "active") {
      throw new InvalidStateError(`Only active contracts can be amended (${this.props.status})`);
    }
    if (input.summary.trim().length === 0) {
      throw ValidationError.single("summary", "an amendment summary is required");
    }
    const effectiveFrom = parseIso(input.effectiveFrom, "effectiveFrom");
    if (isBefore(effectiveFrom, this.props.effectiveFrom)) {
      throw ValidationError.single("effectiveFrom", "cannot predate the contract term");
    }
    const nextEffectiveTo = input.effectiveTo ? parseIso(input.effectiveTo, "effectiveTo") : this.props.effectiveTo;
    assertOrderedRange(effectiveFrom, nextEffectiveTo, "effectiveTo");
    const nextBase =
      input.baseDiscountBps !== undefined
        ? assertBps(input.baseDiscountBps, "baseDiscountBps")
        : this.props.baseDiscountBps;
    if (nextBase === this.props.baseDiscountBps && nextEffectiveTo === this.props.effectiveTo) {
      throw ValidationError.single("summary", "an amendment must change the discount or the term");
    }

    const amendment: ContractAmendment = {
      id: newId("amend"),
      sequence: this.props.amendments.length + 1,
      summary: input.summary.trim(),
      effectiveFrom,
      previousBaseDiscountBps: this.props.baseDiscountBps,
      baseDiscountBps: nextBase,
      previousEffectiveTo: this.props.effectiveTo,
      effectiveTo: nextEffectiveTo,
      amendedBy: input.by,
      amendedAt: parseIso(input.at, "at"),
    };
    this.props.amendments.push(amendment);
    this.props.baseDiscountBps = nextBase;
    this.props.effectiveTo = nextEffectiveTo;
    this.raise(
      envelope({
        eventType: PrmEventTypes.ContractTermsAmended,
        aggregateType: "PartnerContract",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          contractId: this.id,
          number: this.props.number,
          partnerId: this.props.partnerId,
          type: this.props.type,
          sequence: amendment.sequence,
          summary: amendment.summary,
          baseDiscountBps: nextBase,
          effectiveTo: nextEffectiveTo,
        },
      }),
    );
    return amendment;
  }

  /**
   * Extends the term by the renewal period. Auto-renew contracts roll forward
   * on their own (the service sweeps them at expiry); a manual renewal is
   * allowed at any time inside the term.
   */
  renew(input: { readonly at: IsoDateTime; readonly months?: number; readonly by: UserId }): void {
    if (this.props.status !== "active") {
      throw new InvalidStateError(`Only active contracts can be renewed (${this.props.status})`);
    }
    if (this.hasOpenObligations()) {
      throw new InvalidStateError(
        `Contract ${this.props.number} has unmet obligations; resolve or waive them before renewal`,
        { obligations: this.props.obligations.filter((o) => o.status !== "met" && o.status !== "waived") },
      );
    }
    const months = input.months ?? this.props.renewalTermMonths;
    if (!Number.isInteger(months) || months < 1 || months > 120) {
      throw ValidationError.single("months", "must be an integer between 1 and 120");
    }
    const previousEffectiveTo = this.props.effectiveTo;
    this.props.effectiveTo = addMonths(previousEffectiveTo, months);
    this.props.renewalCount += 1;
    this.raise(
      envelope({
        eventType: PrmEventTypes.ContractRenewed,
        aggregateType: "PartnerContract",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          contractId: this.id,
          number: this.props.number,
          partnerId: this.props.partnerId,
          type: this.props.type,
          previousEffectiveTo,
          effectiveTo: this.props.effectiveTo,
          renewalCount: this.props.renewalCount,
        },
      }),
    );
  }

  /** Marks a past-term contract expired. Returns false when it is not due yet. */
  expireIfDue(at: IsoDateTime): boolean {
    if (this.props.status !== "active") return false;
    if (isBefore(at, this.props.effectiveTo)) return false;
    this.props.status = "expired";
    this.props.expiredAt = at;
    this.raise(this.identityEvent(PrmEventTypes.ContractExpired));
    return true;
  }

  terminate(input: { readonly at: IsoDateTime; readonly by: UserId; readonly reason: string }): void {
    if (this.props.status !== "active" && this.props.status !== "pending_signature") {
      throw new InvalidStateError(`Contract ${this.props.number} is ${this.props.status} and cannot be terminated`);
    }
    if (input.reason.trim().length === 0) {
      throw ValidationError.single("reason", "a termination reason is required");
    }
    this.props.status = "terminated";
    this.props.terminatedAt = parseIso(input.at, "at");
    this.props.terminationReason = input.reason.trim();
    this.raise(
      envelope({
        eventType: PrmEventTypes.ContractTerminated,
        aggregateType: "PartnerContract",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          contractId: this.id,
          number: this.props.number,
          partnerId: this.props.partnerId,
          type: this.props.type,
          reason: this.props.terminationReason,
          terminatedAt: this.props.terminatedAt,
          noticeDays: this.props.noticeDays,
        },
      }),
    );
  }

  // --- internals -------------------------------------------------------------

  private identityEvent(eventType: string) {
    return envelope({
      eventType,
      aggregateType: "PartnerContract",
      aggregateId: this.id,
      tenantId: this.tenantId,
      payload: {
        contractId: this.id,
        number: this.props.number,
        partnerId: this.props.partnerId,
        type: this.props.type,
      },
    });
  }

  private assertDraftLike(action: string): void {
    if (this.props.status !== "draft") {
      throw new InvalidStateError(
        `Cannot ${action}: contract ${this.props.number} is ${this.props.status}` +
          (this.props.status === "active" ? " — use an amendment" : ""),
      );
    }
  }
}
