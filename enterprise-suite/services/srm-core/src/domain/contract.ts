import {
  AggregateRoot,
  envelope,
  money,
  newId,
  type EntityProps,
  type IsoDateTime,
  type Money,
  type TenantId,
  type Ulid,
  type UserId,
} from "@enterprise-suite/shared-kernel";
import { businessCode, currencyCodeOf, incoterm, nonEmpty, paymentTerms, type Incoterm } from "./common.js";
import {
  addMonths,
  assertWindow,
  compareDates,
  daysBetween,
  maxDate,
  windowContains,
  windowsOverlap,
  type DateOnly,
} from "./dates.js";
import { InvalidStateError, ValidationError } from "./errors.js";
import { SrmEventTypes } from "./events.js";
import {
  assertCommitmentShape,
  escalationFor,
  evaluateSla,
  isSlaMetric,
  MEASUREMENT_WINDOWS,
  SLA_METRIC_SPECS,
  type BreachSeverity,
  type MeasurementWindow,
  type PenaltyModel,
  type SlaBreach,
  type SlaCommitment,
  type SlaEscalation,
  type SlaMetric,
} from "./sla.js";

/**
 * Supplier contract: the commercial envelope (term, price, service levels)
 * that procurement transacts inside.
 *
 *   draft -> pending_signature -> signed -> active -> expired
 *                                              |  \-> terminated
 *                                              \-> superseded
 *
 * Three things make this more than a document store:
 *
 *  - **Price tiers.** Price lines are (item, quantity break, validity window)
 *    triples. `priceFor(item, qty, date)` resolves the tier the way a PO would,
 *    and overlapping tiers for the same break are rejected on entry so the
 *    resolution can never be ambiguous.
 *  - **Change control.** An active contract is immutable except through an
 *    amendment, which bumps a revision and records who changed what and why.
 *  - **Service levels.** Commitments live on the contract, and a measured
 *    period produces a breach with a computed credit, a consecutive-breach
 *    count and any escalation the parties agreed to.
 */

export type ContractType = "nda" | "msa" | "framework" | "pricing_agreement" | "sow" | "sla" | "quality_agreement";

export const CONTRACT_TYPES: readonly ContractType[] = [
  "nda",
  "msa",
  "framework",
  "pricing_agreement",
  "sow",
  "sla",
  "quality_agreement",
];

export type ContractStatus =
  | "draft"
  | "pending_signature"
  | "signed"
  | "active"
  | "expired"
  | "terminated"
  | "superseded";

export type SignatoryParty = "buyer" | "supplier";

export interface Signatory {
  readonly id: Ulid;
  readonly party: SignatoryParty;
  readonly name: string;
  readonly title?: string;
  readonly email?: string;
  readonly signedAt?: IsoDateTime;
  readonly signedOn?: DateOnly;
}

export interface PriceLine {
  readonly id: Ulid;
  /** Item SKU or a category-wide rate when `categoryId` is set instead. */
  readonly itemCode?: string;
  readonly categoryId?: Ulid;
  readonly description: string;
  readonly uom: string;
  readonly unitPrice: Money;
  /** Quantity break: this price applies from this quantity upwards. */
  readonly minQuantity: number;
  readonly leadTimeDays?: number;
  readonly validFrom: DateOnly;
  readonly validTo?: DateOnly;
}

export interface Amendment {
  readonly revision: number;
  readonly changeNote: string;
  readonly amendedBy: UserId;
  readonly amendedAt: IsoDateTime;
  readonly effectiveFrom?: DateOnly;
  readonly effectiveTo?: DateOnly;
}

export interface RenewalRecord {
  readonly renewedAt: IsoDateTime;
  readonly previousEffectiveTo: DateOnly;
  readonly newEffectiveTo: DateOnly;
  readonly automatic: boolean;
}

export interface TerminationRecord {
  readonly reason: string;
  readonly terminationDate: DateOnly;
  readonly noticeWaived: boolean;
  readonly terminatedBy: UserId;
  readonly terminatedAt: IsoDateTime;
}

export interface ContractProps {
  number: string;
  supplierId: Ulid;
  supplierCode: string;
  type: ContractType;
  title: string;
  status: ContractStatus;
  currency: string;
  effectiveFrom?: DateOnly;
  effectiveTo?: DateOnly;
  autoRenew: boolean;
  renewalTermMonths: number;
  /** Notice period either party must give before termination. */
  noticeDays: number;
  paymentTermsCode: string;
  incoterm?: Incoterm;
  categoryIds: Ulid[];
  minimumCommitment?: Money;
  spendCap?: Money;
  signatories: Signatory[];
  priceLines: PriceLine[];
  commitments: SlaCommitment[];
  breaches: SlaBreach[];
  /** Current consecutive-breach streak per commitment; reset by a met period. */
  breachStreaks: Record<string, number>;
  amendments: Amendment[];
  renewals: RenewalRecord[];
  revision: number;
  termination?: TerminationRecord;
  parentContractId?: Ulid;
  supersededByContractId?: Ulid;
  expiryWarnedAt?: IsoDateTime;
  ownerUserId?: UserId;
  documentRef?: string;
}

export interface DraftContractInput {
  readonly number: string;
  readonly supplierId: Ulid;
  readonly supplierCode: string;
  readonly type: ContractType;
  readonly title: string;
  readonly currency: string;
  readonly effectiveFrom?: DateOnly;
  readonly effectiveTo?: DateOnly;
  readonly autoRenew?: boolean;
  readonly renewalTermMonths?: number;
  readonly noticeDays?: number;
  readonly paymentTermsCode?: string;
  readonly incoterm?: string;
  readonly categoryIds?: readonly Ulid[];
  readonly minimumCommitmentMinor?: number;
  readonly spendCapMinor?: number;
  readonly parentContractId?: Ulid;
  readonly ownerUserId?: UserId;
  readonly documentRef?: string;
}

export interface AddPriceLineInput {
  readonly description: string;
  readonly uom: string;
  readonly unitPriceMinor: number;
  readonly itemCode?: string;
  readonly categoryId?: Ulid;
  readonly minQuantity?: number;
  readonly leadTimeDays?: number;
  readonly validFrom: DateOnly;
  readonly validTo?: DateOnly;
}

export interface AddCommitmentInput {
  readonly metric: SlaMetric;
  readonly target: number;
  readonly tolerance?: number;
  readonly window?: MeasurementWindow;
  readonly graceBreaches?: number;
  readonly penalty?: PenaltyModel;
  readonly creditCapPercent?: number;
  readonly escalations?: readonly SlaEscalation[];
  readonly description?: string;
  readonly effectiveFrom?: DateOnly;
}

export interface RecordSlaResultInput {
  readonly commitmentId: Ulid;
  readonly periodCode: string;
  readonly measured: number;
  readonly recordedOn: DateOnly;
  readonly periodSpendMinor?: number;
  readonly note?: string;
}

export class Contract extends AggregateRoot<ContractProps> {
  static draft(tenantId: TenantId, input: DraftContractInput): Contract {
    if (!CONTRACT_TYPES.includes(input.type)) {
      throw ValidationError.single("type", `must be one of [${CONTRACT_TYPES.join(", ")}]`);
    }
    const renewalTermMonths = input.renewalTermMonths ?? 12;
    if (!Number.isInteger(renewalTermMonths) || renewalTermMonths < 1 || renewalTermMonths > 120) {
      throw ValidationError.single("renewalTermMonths", "must be an integer between 1 and 120");
    }
    const noticeDays = input.noticeDays ?? 30;
    if (!Number.isInteger(noticeDays) || noticeDays < 0 || noticeDays > 365) {
      throw ValidationError.single("noticeDays", "must be an integer between 0 and 365");
    }
    if (input.effectiveFrom) {
      assertWindow({ from: input.effectiveFrom, to: input.effectiveTo }, "effectiveWindow");
    }
    const currency = currencyCodeOf(input.currency);
    const contract = new Contract(tenantId, {
      number: input.number,
      supplierId: input.supplierId,
      supplierCode: input.supplierCode,
      type: input.type,
      title: nonEmpty(input.title, "title", 300),
      status: "draft",
      currency,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo,
      autoRenew: input.autoRenew ?? false,
      renewalTermMonths,
      noticeDays,
      paymentTermsCode: paymentTerms(input.paymentTermsCode ?? "NET30").code,
      incoterm: input.incoterm ? incoterm(input.incoterm) : undefined,
      categoryIds: [...(input.categoryIds ?? [])],
      minimumCommitment:
        input.minimumCommitmentMinor !== undefined ? money(input.minimumCommitmentMinor, currency) : undefined,
      spendCap: input.spendCapMinor !== undefined ? money(input.spendCapMinor, currency) : undefined,
      signatories: [],
      priceLines: [],
      commitments: [],
      breaches: [],
      breachStreaks: {},
      amendments: [],
      renewals: [],
      revision: 1,
      parentContractId: input.parentContractId,
      ownerUserId: input.ownerUserId,
      documentRef: input.documentRef?.trim() || undefined,
    });
    contract.emit(SrmEventTypes.ContractDrafted);
    return contract;
  }

  static fromSnapshot(snapshot: EntityProps & ContractProps): Contract {
    const { id, tenantId, createdAt, updatedAt, version, ...props } = snapshot;
    return new Contract(
      tenantId,
      {
        ...props,
        categoryIds: [...props.categoryIds],
        signatories: [...props.signatories],
        priceLines: [...props.priceLines],
        commitments: [...props.commitments],
        breaches: [...props.breaches],
        breachStreaks: { ...props.breachStreaks },
        amendments: [...props.amendments],
        renewals: [...props.renewals],
      },
      { id, createdAt, updatedAt, version },
    );
  }

  // --- accessors -----------------------------------------------------------

  get number(): string {
    return this.props.number;
  }
  get supplierId(): Ulid {
    return this.props.supplierId;
  }
  get supplierCode(): string {
    return this.props.supplierCode;
  }
  get type(): ContractType {
    return this.props.type;
  }
  get title(): string {
    return this.props.title;
  }
  get status(): ContractStatus {
    return this.props.status;
  }
  get currency(): string {
    return this.props.currency;
  }
  get effectiveFrom(): DateOnly | undefined {
    return this.props.effectiveFrom;
  }
  get effectiveTo(): DateOnly | undefined {
    return this.props.effectiveTo;
  }
  get revision(): number {
    return this.props.revision;
  }
  get autoRenew(): boolean {
    return this.props.autoRenew;
  }
  get categoryIds(): readonly Ulid[] {
    return this.props.categoryIds;
  }
  get signatories(): readonly Signatory[] {
    return this.props.signatories;
  }
  get priceLines(): readonly PriceLine[] {
    return this.props.priceLines;
  }
  get commitments(): readonly SlaCommitment[] {
    return this.props.commitments;
  }
  get breaches(): readonly SlaBreach[] {
    return this.props.breaches;
  }
  get amendments(): readonly Amendment[] {
    return this.props.amendments;
  }
  get renewals(): readonly RenewalRecord[] {
    return this.props.renewals;
  }
  get termination(): TerminationRecord | undefined {
    return this.props.termination;
  }

  isEffectiveOn(asOf: DateOnly): boolean {
    if (this.props.status !== "active") return false;
    if (!this.props.effectiveFrom) return false;
    return windowContains({ from: this.props.effectiveFrom, to: this.props.effectiveTo }, asOf);
  }

  coversCategory(categoryId: Ulid): boolean {
    return this.props.categoryIds.length === 0 || this.props.categoryIds.includes(categoryId);
  }

  daysToExpiry(asOf: DateOnly): number | undefined {
    return this.props.effectiveTo ? daysBetween(asOf, this.props.effectiveTo) : undefined;
  }

  commitment(commitmentId: Ulid): SlaCommitment | undefined {
    return this.props.commitments.find((entry) => entry.id === commitmentId);
  }

  openBreaches(): readonly SlaBreach[] {
    return this.props.breaches.filter((breach) => breach.status === "open" || breach.status === "acknowledged");
  }

  totalCredits(): Money {
    return this.props.breaches
      .filter((breach) => breach.credit && breach.status !== "waived")
      .reduce<Money>(
        (sum, breach) => money(sum.amountMinor + (breach.credit?.amountMinor ?? 0), this.props.currency),
        money(0, this.props.currency),
      );
  }

  breachStreak(commitmentId: Ulid): number {
    return this.props.breachStreaks[commitmentId] ?? 0;
  }

  /**
   * Resolves the price a PO would pay: the narrowest matching quantity break
   * of the lines valid on the date.
   */
  priceFor(
    lookup: { itemCode?: string; categoryId?: Ulid; quantity: number; asOf: DateOnly },
  ): PriceLine | undefined {
    if (!Number.isFinite(lookup.quantity) || lookup.quantity <= 0) {
      throw ValidationError.single("quantity", "must be greater than 0");
    }
    return this.props.priceLines
      .filter((line) =>
        lookup.itemCode !== undefined
          ? line.itemCode === lookup.itemCode.trim().toUpperCase()
          : line.categoryId !== undefined && line.categoryId === lookup.categoryId,
      )
      .filter((line) => windowContains({ from: line.validFrom, to: line.validTo }, lookup.asOf))
      .filter((line) => lookup.quantity >= line.minQuantity)
      .sort((a, b) => b.minQuantity - a.minQuantity)[0];
  }

  // --- signature & activation ---------------------------------------------

  addSignatory(input: { party: SignatoryParty; name: string; title?: string; email?: string }): Signatory {
    this.assertDraftOrPending("add a signatory");
    if (input.party !== "buyer" && input.party !== "supplier") {
      throw ValidationError.single("party", "must be buyer or supplier");
    }
    const signatory: Signatory = {
      id: newId("sig"),
      party: input.party,
      name: nonEmpty(input.name, "name"),
      title: input.title?.trim() || undefined,
      email: input.email?.trim().toLowerCase() || undefined,
    };
    this.props.signatories.push(signatory);
    this.touch();
    return signatory;
  }

  sendForSignature(): void {
    if (this.props.status !== "draft") {
      throw new InvalidStateError(`Contract ${this.props.number} is ${this.props.status}, expected draft`);
    }
    if (!this.props.effectiveFrom) {
      throw new InvalidStateError(`Contract ${this.props.number} needs an effective start date`);
    }
    const parties = new Set(this.props.signatories.map((signatory) => signatory.party));
    if (!parties.has("buyer") || !parties.has("supplier")) {
      throw new InvalidStateError(`Contract ${this.props.number} needs a signatory on both sides`);
    }
    if (this.props.type === "pricing_agreement" && this.props.priceLines.length === 0) {
      throw new InvalidStateError(`Pricing agreement ${this.props.number} has no price lines`);
    }
    this.props.status = "pending_signature";
    this.emit(SrmEventTypes.ContractSentForSignature);
  }

  sign(signatoryId: Ulid, at: IsoDateTime, signedOn: DateOnly): void {
    if (this.props.status !== "pending_signature") {
      throw new InvalidStateError(`Contract ${this.props.number} is ${this.props.status}; it is not out for signature`);
    }
    const index = this.props.signatories.findIndex((signatory) => signatory.id === signatoryId);
    if (index === -1) {
      throw new InvalidStateError(`Signatory ${signatoryId} is not on contract ${this.props.number}`);
    }
    const signatory = this.props.signatories[index]!;
    if (signatory.signedAt) {
      throw new InvalidStateError(`${signatory.name} already signed contract ${this.props.number}`);
    }
    this.props.signatories[index] = { ...signatory, signedAt: at, signedOn };
    this.emit(SrmEventTypes.ContractSigned, { signatoryId, party: signatory.party, name: signatory.name });
    if (this.props.signatories.every((entry) => entry.signedAt !== undefined)) {
      this.props.status = "signed";
    }
  }

  /**
   * Brings a fully signed contract into force. Activation on a date before
   * the effective start is allowed (contracts are commonly countersigned
   * early); `isEffectiveOn` still gates the commercial use.
   */
  activate(at: IsoDateTime): void {
    if (this.props.status !== "signed") {
      throw new InvalidStateError(
        `Contract ${this.props.number} is ${this.props.status}; every party must sign before activation`,
      );
    }
    this.props.status = "active";
    this.emit(SrmEventTypes.ContractActivated, { activatedAt: at });
  }

  // --- price lines ---------------------------------------------------------

  addPriceLine(input: AddPriceLineInput): PriceLine {
    this.assertMutable("add a price line");
    if (!input.itemCode && !input.categoryId) {
      throw ValidationError.single("itemCode", "either an itemCode or a categoryId is required");
    }
    if (!Number.isInteger(input.unitPriceMinor) || input.unitPriceMinor < 0) {
      throw ValidationError.single("unitPriceMinor", "must be a non-negative integer in minor units");
    }
    const minQuantity = input.minQuantity ?? 1;
    if (!Number.isFinite(minQuantity) || minQuantity <= 0) {
      throw ValidationError.single("minQuantity", "must be greater than 0");
    }
    assertWindow({ from: input.validFrom, to: input.validTo }, "validity");
    const itemCode = input.itemCode ? businessCode(input.itemCode, "itemCode") : undefined;

    const clash = this.props.priceLines.find(
      (line) =>
        line.itemCode === itemCode &&
        line.categoryId === input.categoryId &&
        line.minQuantity === minQuantity &&
        windowsOverlap(
          { from: line.validFrom, to: line.validTo },
          { from: input.validFrom, to: input.validTo },
        ),
    );
    if (clash) {
      throw new InvalidStateError(
        `A price for ${itemCode ?? input.categoryId} at break ${minQuantity} already covers ${input.validFrom}`,
        { conflictingLineId: clash.id },
      );
    }

    const line: PriceLine = {
      id: newId("price"),
      itemCode,
      categoryId: input.categoryId,
      description: nonEmpty(input.description, "description", 300),
      uom: businessCode(input.uom, "uom"),
      unitPrice: money(input.unitPriceMinor, this.props.currency),
      minQuantity,
      leadTimeDays: input.leadTimeDays,
      validFrom: input.validFrom,
      validTo: input.validTo,
    };
    this.props.priceLines.push(line);
    this.emit(SrmEventTypes.ContractPriceLineAdded, {
      priceLineId: line.id,
      itemCode: line.itemCode,
      categoryId: line.categoryId,
      minQuantity: line.minQuantity,
      unitPrice: line.unitPrice,
    });
    return line;
  }

  /** Closes a price line's window instead of deleting negotiated history. */
  expirePriceLine(lineId: Ulid, validTo: DateOnly): PriceLine {
    this.assertMutable("expire a price line");
    const index = this.props.priceLines.findIndex((line) => line.id === lineId);
    if (index === -1) {
      throw new InvalidStateError(`Price line ${lineId} is not on contract ${this.props.number}`);
    }
    const line = this.props.priceLines[index]!;
    if (compareDates(validTo, line.validFrom) < 0) {
      throw ValidationError.single("validTo", `must not precede the line's start ${line.validFrom}`);
    }
    const updated: PriceLine = { ...line, validTo };
    this.props.priceLines[index] = updated;
    this.touch();
    return updated;
  }

  // --- service levels ------------------------------------------------------

  addCommitment(input: AddCommitmentInput): SlaCommitment {
    this.assertMutable("add a service-level commitment");
    if (!isSlaMetric(input.metric)) {
      throw ValidationError.single("metric", `unknown SLA metric "${input.metric}"`);
    }
    const window = input.window ?? "quarterly";
    if (!MEASUREMENT_WINDOWS.includes(window)) {
      throw ValidationError.single("window", `must be one of [${MEASUREMENT_WINDOWS.join(", ")}]`);
    }
    if (this.props.commitments.some((entry) => entry.metric === input.metric && entry.isActive)) {
      throw new InvalidStateError(`Contract ${this.props.number} already commits to ${input.metric}`);
    }
    const spec = SLA_METRIC_SPECS[input.metric];
    const penalty: PenaltyModel = input.penalty ?? { kind: "none" };
    const commitment: SlaCommitment = {
      id: newId("sla"),
      metric: input.metric,
      description: input.description?.trim() || undefined,
      target: input.target,
      unit: spec.unit,
      direction: spec.direction,
      tolerance: input.tolerance ?? 0,
      window,
      graceBreaches: input.graceBreaches ?? 0,
      penalty: penalty.kind === "fixed_credit" ? { ...penalty, currency: this.props.currency } : penalty,
      creditCapPercent: input.creditCapPercent ?? 10,
      escalations: [...(input.escalations ?? [])].sort((a, b) => a.afterBreaches - b.afterBreaches),
      effectiveFrom: input.effectiveFrom ?? this.props.effectiveFrom ?? ("1970-01-01" as DateOnly),
      isActive: true,
    };
    assertCommitmentShape(commitment);
    this.props.commitments.push(commitment);
    this.emit(SrmEventTypes.SlaCommitmentAdded, {
      commitmentId: commitment.id,
      metric: commitment.metric,
      target: commitment.target,
      unit: commitment.unit,
    });
    return commitment;
  }

  /**
   * Records a measured period against a commitment. A met target is a no-op
   * (nothing to record); a miss produces a breach with the credit, the
   * consecutive-breach count and any escalation the parties agreed.
   */
  recordSlaResult(input: RecordSlaResultInput): SlaBreach | undefined {
    if (this.props.status !== "active") {
      throw new InvalidStateError(
        `Contract ${this.props.number} is ${this.props.status}; service levels only apply to an active contract`,
      );
    }
    const commitment = this.commitment(input.commitmentId);
    if (!commitment) {
      throw new InvalidStateError(`Commitment ${input.commitmentId} is not on contract ${this.props.number}`);
    }
    if (!commitment.isActive) {
      throw new InvalidStateError(`Commitment ${commitment.metric} is no longer active`);
    }
    if (this.props.breaches.some((breach) => breach.commitmentId === commitment.id && breach.periodCode === input.periodCode)) {
      throw new InvalidStateError(
        `${commitment.metric} for ${input.periodCode} has already been recorded on ${this.props.number}`,
      );
    }
    const priorBreaches = this.props.breaches.filter(
      (breach) => breach.commitmentId === commitment.id && breach.status !== "waived",
    ).length;
    const evaluation = evaluateSla(commitment, input.measured, {
      periodSpend:
        input.periodSpendMinor !== undefined ? money(input.periodSpendMinor, this.props.currency) : undefined,
      priorBreaches,
    });
    if (!evaluation.breached) {
      // A met period breaks the streak; the breach history itself is kept.
      this.props.breachStreaks[commitment.id] = 0;
      this.touch();
      return undefined;
    }

    const consecutive = (this.props.breachStreaks[commitment.id] ?? 0) + 1;
    this.props.breachStreaks[commitment.id] = consecutive;
    const escalation = escalationFor(commitment.escalations, priorBreaches + 1);
    const breach: SlaBreach = {
      id: newId("breach"),
      commitmentId: commitment.id,
      metric: commitment.metric,
      periodCode: input.periodCode,
      target: commitment.target,
      measured: input.measured,
      deviation: evaluation.deviation,
      severity: evaluation.severity,
      status: "open",
      credit: evaluation.credit,
      recordedOn: input.recordedOn,
      consecutive,
      escalation: escalation?.action,
      note: input.note?.trim() || undefined,
    };
    this.props.breaches.push(breach);
    this.emit(SrmEventTypes.SlaBreachRecorded, {
      breachId: breach.id,
      commitmentId: commitment.id,
      metric: breach.metric,
      periodCode: breach.periodCode,
      target: breach.target,
      measured: breach.measured,
      severity: breach.severity,
      credit: breach.credit,
      consecutiveBreaches: consecutive,
      escalation: breach.escalation,
    });
    return breach;
  }

  acknowledgeBreach(breachId: Ulid, note?: string): SlaBreach {
    const index = this.requireBreachIndex(breachId);
    const breach = this.props.breaches[index]!;
    if (breach.status !== "open") {
      throw new InvalidStateError(`Breach ${breachId} is ${breach.status}`);
    }
    const updated: SlaBreach = { ...breach, status: "acknowledged", note: note?.trim() || breach.note };
    this.props.breaches[index] = updated;
    this.touch();
    return updated;
  }

  /** Issues the agreed service credit; the finance system consumes the event. */
  creditBreach(breachId: Ulid, resolvedOn: DateOnly, note?: string): SlaBreach {
    const index = this.requireBreachIndex(breachId);
    const breach = this.props.breaches[index]!;
    if (breach.status === "credited" || breach.status === "waived") {
      throw new InvalidStateError(`Breach ${breachId} is already ${breach.status}`);
    }
    if (!breach.credit) {
      throw new InvalidStateError(`Breach ${breachId} carries no credit (inside the grace allowance or no penalty)`);
    }
    const updated: SlaBreach = { ...breach, status: "credited", resolvedOn, note: note?.trim() || breach.note };
    this.props.breaches[index] = updated;
    this.emit(SrmEventTypes.SlaCreditIssued, {
      breachId,
      commitmentId: breach.commitmentId,
      metric: breach.metric,
      periodCode: breach.periodCode,
      credit: breach.credit,
    });
    return updated;
  }

  waiveBreach(breachId: Ulid, reason: string, resolvedOn: DateOnly): SlaBreach {
    const index = this.requireBreachIndex(breachId);
    const breach = this.props.breaches[index]!;
    if (breach.status === "credited") {
      throw new InvalidStateError(`Breach ${breachId} has already been credited`);
    }
    const updated: SlaBreach = {
      ...breach,
      status: "waived",
      resolvedOn,
      note: nonEmpty(reason, "reason", 500),
    };
    this.props.breaches[index] = updated;
    this.emit(SrmEventTypes.SlaBreachWaived, {
      breachId,
      commitmentId: breach.commitmentId,
      metric: breach.metric,
      periodCode: breach.periodCode,
      reason: updated.note,
    });
    return updated;
  }

  // --- change control ------------------------------------------------------

  /**
   * The only way to change an active contract. Term extensions, new price
   * lines and new commitments all ride on an amendment so the counterparty
   * record shows a revision history rather than mutated fields.
   */
  amend(
    by: UserId,
    at: IsoDateTime,
    changeNote: string,
    patch: {
      readonly title?: string;
      readonly effectiveTo?: DateOnly;
      readonly autoRenew?: boolean;
      readonly noticeDays?: number;
      readonly minimumCommitmentMinor?: number;
      readonly spendCapMinor?: number;
      readonly categoryIds?: readonly Ulid[];
    } = {},
  ): Amendment {
    if (this.props.status !== "active" && this.props.status !== "signed") {
      throw new InvalidStateError(
        `Contract ${this.props.number} is ${this.props.status}; only a signed or active contract is amended`,
      );
    }
    if (patch.effectiveTo !== undefined && this.props.effectiveFrom) {
      assertWindow({ from: this.props.effectiveFrom, to: patch.effectiveTo }, "effectiveWindow");
    }
    if (patch.title !== undefined) this.props.title = nonEmpty(patch.title, "title", 300);
    if (patch.effectiveTo !== undefined) this.props.effectiveTo = patch.effectiveTo;
    if (patch.autoRenew !== undefined) this.props.autoRenew = patch.autoRenew;
    if (patch.noticeDays !== undefined) {
      if (!Number.isInteger(patch.noticeDays) || patch.noticeDays < 0 || patch.noticeDays > 365) {
        throw ValidationError.single("noticeDays", "must be an integer between 0 and 365");
      }
      this.props.noticeDays = patch.noticeDays;
    }
    if (patch.minimumCommitmentMinor !== undefined) {
      this.props.minimumCommitment = money(patch.minimumCommitmentMinor, this.props.currency);
    }
    if (patch.spendCapMinor !== undefined) {
      this.props.spendCap = money(patch.spendCapMinor, this.props.currency);
    }
    if (patch.categoryIds !== undefined) this.props.categoryIds = [...patch.categoryIds];

    this.props.revision += 1;
    const amendment: Amendment = {
      revision: this.props.revision,
      changeNote: nonEmpty(changeNote, "changeNote", 1000),
      amendedBy: by,
      amendedAt: at,
      effectiveFrom: this.props.effectiveFrom,
      effectiveTo: this.props.effectiveTo,
    };
    this.props.amendments.push(amendment);
    this.props.expiryWarnedAt = undefined;
    this.emit(SrmEventTypes.ContractAmended, {
      revision: amendment.revision,
      changeNote: amendment.changeNote,
      amendedBy: by,
    });
    return amendment;
  }

  /**
   * Extends the term. Automatic renewals fire from the sweep when auto-renew
   * is on and the notice period has passed without either party opting out.
   */
  renew(at: IsoDateTime, options: { readonly automatic?: boolean; readonly termMonths?: number } = {}): RenewalRecord {
    if (this.props.status !== "active" && this.props.status !== "expired") {
      throw new InvalidStateError(`Contract ${this.props.number} is ${this.props.status} and cannot be renewed`);
    }
    if (!this.props.effectiveTo) {
      throw new InvalidStateError(`Contract ${this.props.number} is open-ended; there is nothing to renew`);
    }
    const termMonths = options.termMonths ?? this.props.renewalTermMonths;
    if (!Number.isInteger(termMonths) || termMonths < 1 || termMonths > 120) {
      throw ValidationError.single("termMonths", "must be an integer between 1 and 120");
    }
    const previousEffectiveTo = this.props.effectiveTo;
    const newEffectiveTo = addMonths(previousEffectiveTo, termMonths);
    const record: RenewalRecord = {
      renewedAt: at,
      previousEffectiveTo,
      newEffectiveTo,
      automatic: options.automatic ?? false,
    };
    this.props.effectiveTo = newEffectiveTo;
    this.props.status = "active";
    this.props.renewals.push(record);
    this.props.expiryWarnedAt = undefined;
    this.emit(SrmEventTypes.ContractRenewed, {
      previousEffectiveTo,
      renewalCount: this.props.renewals.length,
      automatic: record.automatic,
    });
    return record;
  }

  /** Sweep hook: warns once inside the notice window before expiry. */
  warnExpiring(asOf: DateOnly, at: IsoDateTime, horizonDays: number): boolean {
    if (this.props.status !== "active" || !this.props.effectiveTo) return false;
    if (this.props.expiryWarnedAt !== undefined) return false;
    const remaining = daysBetween(asOf, this.props.effectiveTo);
    if (remaining < 0 || remaining > horizonDays) return false;
    this.props.expiryWarnedAt = at;
    this.emit(SrmEventTypes.ContractExpiring, { daysToExpiry: remaining, autoRenew: this.props.autoRenew });
    return true;
  }

  expireIfDue(asOf: DateOnly): boolean {
    if (this.props.status !== "active" || !this.props.effectiveTo) return false;
    if (compareDates(this.props.effectiveTo, asOf) >= 0) return false;
    this.props.status = "expired";
    this.emit(SrmEventTypes.ContractExpired, {});
    return true;
  }

  /**
   * Terminates for cause or for convenience. The contractual notice period is
   * enforced against the requested termination date unless it is explicitly
   * waived — waiving is a commercial decision that has to be visible.
   */
  terminate(
    by: UserId,
    at: IsoDateTime,
    input: { reason: string; terminationDate: DateOnly; asOf: DateOnly; waiveNotice?: boolean },
  ): TerminationRecord {
    if (this.props.status !== "active" && this.props.status !== "signed") {
      throw new InvalidStateError(`Contract ${this.props.number} is ${this.props.status} and cannot be terminated`);
    }
    const noticeGiven = daysBetween(input.asOf, input.terminationDate);
    if (noticeGiven < 0) {
      throw ValidationError.single("terminationDate", "must not be in the past");
    }
    if (!input.waiveNotice && noticeGiven < this.props.noticeDays) {
      throw new InvalidStateError(
        `Contract ${this.props.number} requires ${this.props.noticeDays} days' notice; ${noticeGiven} given`,
        { noticeDays: this.props.noticeDays, noticeGiven },
      );
    }
    const record: TerminationRecord = {
      reason: nonEmpty(input.reason, "reason", 1000),
      terminationDate: input.terminationDate,
      noticeWaived: input.waiveNotice === true,
      terminatedBy: by,
      terminatedAt: at,
    };
    this.props.termination = record;
    this.props.status = "terminated";
    // The term ends on the termination date, never later.
    this.props.effectiveTo = this.props.effectiveTo
      ? (compareDates(input.terminationDate, this.props.effectiveTo) < 0 ? input.terminationDate : this.props.effectiveTo)
      : input.terminationDate;
    this.emit(SrmEventTypes.ContractTerminated, {
      reason: record.reason,
      terminationDate: record.terminationDate,
      noticeWaived: record.noticeWaived,
      terminatedBy: by,
    });
    return record;
  }

  /** Links this contract to its replacement and closes it out. */
  supersede(successorContractId: Ulid, asOf: DateOnly): void {
    if (this.props.status !== "active" && this.props.status !== "signed") {
      throw new InvalidStateError(`Contract ${this.props.number} is ${this.props.status} and cannot be superseded`);
    }
    if (successorContractId === this.id) {
      throw ValidationError.single("successorContractId", "a contract cannot supersede itself");
    }
    this.props.status = "superseded";
    this.props.supersededByContractId = successorContractId;
    this.props.effectiveTo = this.props.effectiveFrom
      ? maxDate(this.props.effectiveFrom, asOf)
      : asOf;
    this.emit(SrmEventTypes.ContractSuperseded, { supersededBy: successorContractId });
  }

  // --- helpers -------------------------------------------------------------

  private requireBreachIndex(breachId: Ulid): number {
    const index = this.props.breaches.findIndex((breach) => breach.id === breachId);
    if (index === -1) {
      throw new InvalidStateError(`Breach ${breachId} is not on contract ${this.props.number}`);
    }
    return index;
  }

  private assertDraftOrPending(action: string): void {
    if (this.props.status !== "draft" && this.props.status !== "pending_signature") {
      throw new InvalidStateError(`Cannot ${action}: contract ${this.props.number} is ${this.props.status}`);
    }
  }

  /**
   * Price lines and commitments may be shaped freely while drafting; on a
   * live contract they ride on an amendment, which the service records around
   * the call.
   */
  private assertMutable(action: string): void {
    const mutable: readonly ContractStatus[] = ["draft", "pending_signature", "signed", "active"];
    if (!mutable.includes(this.props.status)) {
      throw new InvalidStateError(`Cannot ${action}: contract ${this.props.number} is ${this.props.status}`);
    }
  }

  private emit(eventType: string, extra: Record<string, unknown> = {}): void {
    this.raise(
      envelope({
        eventType,
        aggregateType: "Contract",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          contractId: this.id,
          contractNumber: this.props.number,
          supplierId: this.props.supplierId,
          supplierCode: this.props.supplierCode,
          type: this.props.type,
          status: this.props.status,
          effectiveFrom: this.props.effectiveFrom,
          effectiveTo: this.props.effectiveTo,
          ...extra,
        },
      }),
    );
  }
}
