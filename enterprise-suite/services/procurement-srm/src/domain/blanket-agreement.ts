import {
  AggregateRoot,
  envelope,
  money,
  newId,
  nowIso,
  type EntityProps,
  type IsoDateTime,
  type Money,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import {
  addQty,
  assertDateOrder,
  code,
  compareDates,
  currencyCode,
  daysBetween,
  incoterm,
  isWithin,
  paymentTermsDays as validPaymentTerms,
  positiveQuantity,
  qtyAtLeast,
  quantity,
  requiredText,
  subMoney,
  subQty,
  uom,
  varianceBps,
  ZERO_QTY,
  zeroMoney,
  type Incoterm,
  type IsoDate,
  type Quantity,
  type UomCode,
} from "./common.js";
import { AgreementLimitError, InvalidStateError, invariant, ValidationError } from "./errors.js";
import { ProcurementEvents } from "./events.js";

export type AgreementStatus =
  | "draft"
  | "active"
  | "suspended"
  | "expired"
  | "closed"
  | "cancelled";

export const AGREEMENT_STATUSES: readonly AgreementStatus[] = [
  "draft",
  "active",
  "suspended",
  "expired",
  "closed",
  "cancelled",
];

export type AgreementType = "blanket" | "contract" | "standing";

export const AGREEMENT_TYPES: readonly AgreementType[] = ["blanket", "contract", "standing"];

/**
 * Volume price break: the unit price that applies once a single release
 * reaches `minQuantity`. Tiers may also be date-scoped for staged price
 * changes agreed up front.
 */
export interface PriceTier {
  readonly minQuantity: Quantity;
  readonly unitPrice: Money;
  readonly effectiveFrom?: IsoDate;
  readonly effectiveTo?: IsoDate;
}

export interface AgreementLineInput {
  description: string;
  categoryCode: string;
  uom: string;
  unitPrice: Money;
  itemCode?: string;
  contractedQuantity?: number;
  maximumQuantity?: number;
  leadTimeDays?: number;
  priceTiers?: readonly PriceTier[];
}

export class AgreementLine {
  readonly id: Ulid;
  readonly lineNumber: number;
  description: string;
  categoryCode: string;
  uom: UomCode;
  itemCode?: string;
  /** Tier list, always sorted ascending by `minQuantity`. */
  priceTiers: PriceTier[];
  contractedQuantity?: Quantity;
  maximumQuantity?: Quantity;
  releasedQuantity: Quantity;
  leadTimeDays?: number;

  constructor(lineNumber: number, input: AgreementLineInput) {
    this.id = newId("bpaline");
    this.lineNumber = lineNumber;
    this.description = requiredText(input.description, "description", 3, 500);
    this.categoryCode = code(input.categoryCode, "categoryCode");
    this.uom = uom(input.uom);
    this.itemCode = input.itemCode ? code(input.itemCode, "itemCode", 60) : undefined;
    invariant(input.unitPrice.amountMinor > 0, "unitPrice", "must be greater than zero");
    this.priceTiers = [{ minQuantity: ZERO_QTY, unitPrice: input.unitPrice }];
    this.contractedQuantity =
      input.contractedQuantity === undefined
        ? undefined
        : positiveQuantity(input.contractedQuantity, "contractedQuantity");
    this.maximumQuantity =
      input.maximumQuantity === undefined
        ? undefined
        : positiveQuantity(input.maximumQuantity, "maximumQuantity");
    if (
      this.contractedQuantity !== undefined &&
      this.maximumQuantity !== undefined &&
      this.maximumQuantity < this.contractedQuantity
    ) {
      throw ValidationError.single(
        "maximumQuantity",
        `must be at least the contracted quantity ${this.contractedQuantity}`,
      );
    }
    if (input.leadTimeDays !== undefined) {
      invariant(
        Number.isInteger(input.leadTimeDays) && input.leadTimeDays >= 0 && input.leadTimeDays <= 730,
        "leadTimeDays",
        "must be an integer within [0, 730]",
      );
    }
    this.leadTimeDays = input.leadTimeDays;
    this.releasedQuantity = ZERO_QTY;
  }

  get baseUnitPrice(): Money {
    return this.priceTiers[0].unitPrice;
  }

  get currency(): string {
    return this.baseUnitPrice.currency;
  }

  get remainingQuantity(): Quantity | undefined {
    if (this.maximumQuantity === undefined) return undefined;
    return subQty(this.maximumQuantity, this.releasedQuantity);
  }

  /** Progress against the contracted volume, in basis points. */
  get fulfilmentBps(): number | undefined {
    if (this.contractedQuantity === undefined || this.contractedQuantity <= 0) return undefined;
    return Math.round((this.releasedQuantity / this.contractedQuantity) * 10_000);
  }

  addPriceTier(tier: PriceTier): void {
    if (tier.unitPrice.currency !== this.currency) {
      throw ValidationError.single("unitPrice", `must be in the agreement currency ${this.currency}`);
    }
    invariant(tier.unitPrice.amountMinor > 0, "unitPrice", "must be greater than zero");
    if (tier.effectiveFrom && tier.effectiveTo) {
      assertDateOrder(tier.effectiveFrom, tier.effectiveTo, "priceTier");
    }
    const duplicate = this.priceTiers.some(
      (existing) =>
        existing.minQuantity === tier.minQuantity &&
        existing.effectiveFrom === tier.effectiveFrom &&
        existing.effectiveTo === tier.effectiveTo,
    );
    if (duplicate) {
      throw ValidationError.single(
        "minQuantity",
        `a tier for ${tier.minQuantity} ${this.uom} over the same period already exists`,
      );
    }
    this.priceTiers.push(tier);
    this.priceTiers.sort((a, b) => a.minQuantity - b.minQuantity);
  }

  /**
   * Best (lowest) price the buyer is entitled to for `qty` on `onDate`.
   * Tiers whose date window excludes the date are ignored, so a temporary
   * promotional tier expires by itself.
   */
  priceFor(qty: Quantity, onDate?: IsoDate): Money {
    const applicable = this.priceTiers.filter((tier) => {
      if (qty < tier.minQuantity) return false;
      if (!onDate) return tier.effectiveFrom === undefined && tier.effectiveTo === undefined;
      if (tier.effectiveFrom && compareDates(onDate, tier.effectiveFrom) < 0) return false;
      if (tier.effectiveTo && compareDates(onDate, tier.effectiveTo) > 0) return false;
      return true;
    });
    if (applicable.length === 0) return this.baseUnitPrice;
    return applicable.reduce(
      (best, tier) => (tier.unitPrice.amountMinor < best.amountMinor ? tier.unitPrice : best),
      applicable[0].unitPrice,
    );
  }

  toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      lineNumber: this.lineNumber,
      description: this.description,
      categoryCode: this.categoryCode,
      uom: this.uom,
      itemCode: this.itemCode,
      priceTiers: this.priceTiers.map((tier) => ({ ...tier })),
      baseUnitPrice: this.baseUnitPrice,
      contractedQuantity: this.contractedQuantity,
      maximumQuantity: this.maximumQuantity,
      releasedQuantity: this.releasedQuantity,
      remainingQuantity: this.remainingQuantity,
      fulfilmentBps: this.fulfilmentBps,
      leadTimeDays: this.leadTimeDays,
    };
  }
}

export interface AgreementRelease {
  readonly id: Ulid;
  readonly purchaseOrderId: Ulid;
  readonly orderNumber: string;
  readonly releasedAt: IsoDateTime;
  readonly releasedBy: Ulid;
  readonly valueMinor: number;
  readonly lines: ReadonlyArray<{ lineNumber: number; quantity: Quantity; unitPriceMinor: number }>;
  cancelled?: boolean;
}

export interface BlanketAgreementProps {
  agreementNumber: string;
  title: string;
  supplierId: Ulid;
  ownerId: Ulid;
  agreementType: AgreementType;
  currency: string;
  status: AgreementStatus;
  effectiveFrom: IsoDate;
  effectiveTo: IsoDate;
  paymentTermsDays: number;
  incoterm: Incoterm;
  lines: AgreementLine[];
  releases: AgreementRelease[];
  releasedValueMinor: number;
  /** Cap on the total value that may be released; required for blankets. */
  maximumValue: Money;
  minimumCommitment?: Money;
  /** Cap on a single release; releases above it need a standalone order. */
  releaseLimit?: Money;
  /** Releases within the limits skip the standard purchase-order approval. */
  autoReleaseApproved: boolean;
  renewalNoticeDays: number;
  commitmentNotified: boolean;
  notes?: string;
  activatedAt?: IsoDateTime;
  suspendedReason?: string;
  closedAt?: IsoDateTime;
  closeReason?: string;
}

export type BlanketAgreementView = EntityProps &
  BlanketAgreementProps & {
    releasedValue: Money;
    remainingValue: Money;
    commitmentProgressBps?: number;
    activeReleaseCount: number;
  };

/**
 * Blanket purchase agreement: negotiated prices and volumes that purchase
 * orders draw down against.
 *
 *   draft → active ⇄ suspended → expired / closed
 *
 * Releases reserve value and quantity up front; cancelling the resulting
 * purchase order returns both to the agreement.
 */
export class BlanketAgreement extends AggregateRoot<BlanketAgreementProps> {
  private constructor(tenantId: TenantId, props: BlanketAgreementProps) {
    super(tenantId, props);
  }

  static create(
    tenantId: TenantId,
    input: {
      agreementNumber: string;
      title: string;
      supplierId: Ulid;
      ownerId: Ulid;
      currency: string;
      effectiveFrom: IsoDate;
      effectiveTo: IsoDate;
      maximumValue: Money;
      agreementType?: AgreementType;
      minimumCommitment?: Money;
      releaseLimit?: Money;
      paymentTermsDays?: number;
      incoterm?: string;
      autoReleaseApproved?: boolean;
      renewalNoticeDays?: number;
      notes?: string;
      lines?: readonly AgreementLineInput[];
    },
  ): BlanketAgreement {
    const currency = currencyCode(input.currency);
    assertDateOrder(input.effectiveFrom, input.effectiveTo, "effectivePeriod");
    if (input.maximumValue.currency !== currency) {
      throw ValidationError.single("maximumValue", `must be in the agreement currency ${currency}`);
    }
    invariant(input.maximumValue.amountMinor > 0, "maximumValue", "must be greater than zero");
    if (input.minimumCommitment) {
      if (input.minimumCommitment.currency !== currency) {
        throw ValidationError.single("minimumCommitment", `must be in the agreement currency ${currency}`);
      }
      if (input.minimumCommitment.amountMinor > input.maximumValue.amountMinor) {
        throw ValidationError.single(
          "minimumCommitment",
          `cannot exceed the maximum value ${input.maximumValue.amountMinor}`,
        );
      }
    }
    if (input.releaseLimit && input.releaseLimit.currency !== currency) {
      throw ValidationError.single("releaseLimit", `must be in the agreement currency ${currency}`);
    }
    const renewalNoticeDays = input.renewalNoticeDays ?? 30;
    invariant(
      Number.isInteger(renewalNoticeDays) && renewalNoticeDays >= 0 && renewalNoticeDays <= 365,
      "renewalNoticeDays",
      "must be an integer within [0, 365]",
    );
    const agreement = new BlanketAgreement(tenantId, {
      agreementNumber: input.agreementNumber,
      title: requiredText(input.title, "title", 3, 200),
      supplierId: input.supplierId,
      ownerId: input.ownerId,
      agreementType: input.agreementType ?? "blanket",
      currency,
      status: "draft",
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo,
      paymentTermsDays: validPaymentTerms(input.paymentTermsDays ?? 30),
      incoterm: incoterm(input.incoterm ?? "DAP"),
      lines: [],
      releases: [],
      releasedValueMinor: 0,
      maximumValue: input.maximumValue,
      minimumCommitment: input.minimumCommitment,
      releaseLimit: input.releaseLimit,
      autoReleaseApproved: input.autoReleaseApproved ?? false,
      renewalNoticeDays,
      commitmentNotified: false,
      notes: input.notes,
    });
    for (const line of input.lines ?? []) agreement.addLine(line);
    agreement.raise(
      envelope({
        eventType: ProcurementEvents.AgreementCreated,
        aggregateType: "BlanketAgreement",
        aggregateId: agreement.id,
        tenantId,
        payload: {
          agreementId: agreement.id,
          agreementNumber: agreement.props.agreementNumber,
          supplierId: input.supplierId,
          currency,
          effectiveFrom: input.effectiveFrom,
          effectiveTo: input.effectiveTo,
          maximumValue: input.maximumValue,
        },
      }),
    );
    return agreement;
  }

  get agreementNumber(): string {
    return this.props.agreementNumber;
  }
  get title(): string {
    return this.props.title;
  }
  get supplierId(): Ulid {
    return this.props.supplierId;
  }
  get ownerId(): Ulid {
    return this.props.ownerId;
  }
  get agreementType(): AgreementType {
    return this.props.agreementType;
  }
  get currency(): string {
    return this.props.currency;
  }
  get status(): AgreementStatus {
    return this.props.status;
  }
  get effectiveFrom(): IsoDate {
    return this.props.effectiveFrom;
  }
  get effectiveTo(): IsoDate {
    return this.props.effectiveTo;
  }
  get paymentTermsDays(): number {
    return this.props.paymentTermsDays;
  }
  get incoterm(): Incoterm {
    return this.props.incoterm;
  }
  get lines(): readonly AgreementLine[] {
    return this.props.lines;
  }
  get releases(): readonly AgreementRelease[] {
    return this.props.releases;
  }
  get maximumValue(): Money {
    return this.props.maximumValue;
  }
  get minimumCommitment(): Money | undefined {
    return this.props.minimumCommitment;
  }
  get releaseLimit(): Money | undefined {
    return this.props.releaseLimit;
  }
  get autoReleaseApproved(): boolean {
    return this.props.autoReleaseApproved;
  }

  get releasedValue(): Money {
    return money(this.props.releasedValueMinor, this.props.currency);
  }

  get remainingValue(): Money {
    return subMoney(this.props.maximumValue, this.releasedValue);
  }

  get commitmentProgressBps(): number | undefined {
    const commitment = this.props.minimumCommitment;
    if (!commitment || commitment.amountMinor === 0) return undefined;
    return Math.round((this.props.releasedValueMinor / commitment.amountMinor) * 10_000);
  }

  get activeReleaseCount(): number {
    return this.props.releases.filter((release) => !release.cancelled).length;
  }

  line(lineNumber: number): AgreementLine {
    const found = this.props.lines.find((line) => line.lineNumber === lineNumber);
    if (!found) {
      throw ValidationError.single(
        "lineNumber",
        `${lineNumber} is not a line of ${this.props.agreementNumber}`,
      );
    }
    return found;
  }

  addLine(input: AgreementLineInput): AgreementLine {
    this.assertStatus("add a line to", ["draft", "active"]);
    if (input.unitPrice.currency !== this.props.currency) {
      throw ValidationError.single("unitPrice", `must be in the agreement currency ${this.props.currency}`);
    }
    const line = new AgreementLine(this.nextLineNumber(), input);
    for (const tier of input.priceTiers ?? []) line.addPriceTier(tier);
    this.props.lines.push(line);
    this.touch();
    return line;
  }

  addPriceTier(lineNumber: number, tier: PriceTier): AgreementLine {
    this.assertStatus("add a price tier to", ["draft", "active"]);
    const line = this.line(lineNumber);
    line.addPriceTier(tier);
    this.raise(
      envelope({
        eventType: ProcurementEvents.AgreementPriceTierAdded,
        aggregateType: "BlanketAgreement",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          agreementId: this.id,
          agreementNumber: this.props.agreementNumber,
          lineNumber,
          minQuantity: tier.minQuantity,
          unitPrice: tier.unitPrice,
          effectiveFrom: tier.effectiveFrom,
          effectiveTo: tier.effectiveTo,
          discountVsBaseBps: varianceBps(tier.unitPrice.amountMinor, line.baseUnitPrice.amountMinor),
        },
      }),
    );
    return line;
  }

  activate(today: IsoDate): void {
    this.assertStatus("activate", ["draft"]);
    if (this.props.lines.length === 0) {
      throw ValidationError.single("lines", "an agreement needs at least one priced line");
    }
    if (compareDates(this.props.effectiveTo, today) < 0) {
      throw ValidationError.single(
        "effectiveTo",
        `${this.props.effectiveTo} is already in the past (today is ${today})`,
      );
    }
    this.props.status = "active";
    this.props.activatedAt = nowIso();
    this.raise(
      envelope({
        eventType: ProcurementEvents.AgreementActivated,
        aggregateType: "BlanketAgreement",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          agreementId: this.id,
          agreementNumber: this.props.agreementNumber,
          supplierId: this.props.supplierId,
          effectiveFrom: this.props.effectiveFrom,
          effectiveTo: this.props.effectiveTo,
          maximumValue: this.props.maximumValue,
          lineCount: this.props.lines.length,
        },
      }),
    );
  }

  isReleasable(today: IsoDate): boolean {
    return this.props.status === "active" && isWithin(today, this.props.effectiveFrom, this.props.effectiveTo);
  }

  assertReleasable(today: IsoDate): void {
    if (this.props.status !== "active") {
      throw InvalidStateError.transition("agreement", "release against", this.props.status, ["active"]);
    }
    if (!isWithin(today, this.props.effectiveFrom, this.props.effectiveTo)) {
      throw new AgreementLimitError(
        `Agreement ${this.props.agreementNumber} is only valid from ${this.props.effectiveFrom} to ${this.props.effectiveTo} (today is ${today})`,
        "OUT_OF_PERIOD",
        { effectiveFrom: this.props.effectiveFrom, effectiveTo: this.props.effectiveTo },
      );
    }
  }

  /** Prices a would-be release without reserving anything. */
  quoteRelease(
    requestedLines: ReadonlyArray<{ lineNumber: number; quantity: number }>,
    onDate?: IsoDate,
  ): { lines: Array<{ lineNumber: number; quantity: Quantity; unitPrice: Money; amount: Money }>; total: Money } {
    const priced = requestedLines.map((requested) => {
      const line = this.line(requested.lineNumber);
      const qty = positiveQuantity(requested.quantity, "quantity");
      const unitPrice = line.priceFor(qty, onDate);
      return {
        lineNumber: line.lineNumber,
        quantity: qty,
        unitPrice,
        amount: money(Math.round(unitPrice.amountMinor * qty), this.props.currency),
      };
    });
    return {
      lines: priced,
      total: money(
        priced.reduce((total, line) => total + line.amount.amountMinor, 0),
        this.props.currency,
      ),
    };
  }

  /**
   * Reserves quantity and value against the agreement for a purchase order.
   * Every cap is checked before anything mutates, so a rejected release leaves
   * the agreement untouched.
   */
  recordRelease(input: {
    purchaseOrderId: Ulid;
    orderNumber: string;
    releasedBy: Ulid;
    today: IsoDate;
    lines: ReadonlyArray<{ lineNumber: number; quantity: number }>;
  }): AgreementRelease {
    this.assertReleasable(input.today);
    if (input.lines.length === 0) {
      throw ValidationError.single("lines", "a release needs at least one line");
    }
    const priced = this.quoteRelease(input.lines, input.today);

    for (const pricedLine of priced.lines) {
      const line = this.line(pricedLine.lineNumber);
      if (line.maximumQuantity !== undefined) {
        const projected = addQty(line.releasedQuantity, pricedLine.quantity);
        if (!qtyAtLeast(line.maximumQuantity, projected)) {
          throw new AgreementLimitError(
            `Releasing ${pricedLine.quantity} ${line.uom} would take line ${line.lineNumber} to ${projected} against a maximum of ${line.maximumQuantity}`,
            "LINE_QUANTITY_CAP",
            {
              lineNumber: line.lineNumber,
              maximumQuantity: line.maximumQuantity,
              releasedQuantity: line.releasedQuantity,
            },
          );
        }
      }
    }

    if (this.props.releaseLimit && priced.total.amountMinor > this.props.releaseLimit.amountMinor) {
      throw new AgreementLimitError(
        `Release value ${priced.total.amountMinor} exceeds the per-release limit ${this.props.releaseLimit.amountMinor} on ${this.props.agreementNumber}`,
        "RELEASE_LIMIT",
        { releaseLimit: this.props.releaseLimit, requested: priced.total },
      );
    }

    const projectedValue = this.props.releasedValueMinor + priced.total.amountMinor;
    if (projectedValue > this.props.maximumValue.amountMinor) {
      throw new AgreementLimitError(
        `Release value ${priced.total.amountMinor} would take ${this.props.agreementNumber} to ${projectedValue} against a maximum of ${this.props.maximumValue.amountMinor}`,
        "MAXIMUM_VALUE",
        {
          maximumValue: this.props.maximumValue,
          releasedValue: this.releasedValue,
          requested: priced.total,
        },
      );
    }

    for (const pricedLine of priced.lines) {
      const line = this.line(pricedLine.lineNumber);
      line.releasedQuantity = addQty(line.releasedQuantity, pricedLine.quantity);
    }
    this.props.releasedValueMinor = projectedValue;

    const release: AgreementRelease = {
      id: newId("bparel"),
      purchaseOrderId: input.purchaseOrderId,
      orderNumber: input.orderNumber,
      releasedAt: nowIso(),
      releasedBy: input.releasedBy,
      valueMinor: priced.total.amountMinor,
      lines: priced.lines.map((line) => ({
        lineNumber: line.lineNumber,
        quantity: line.quantity,
        unitPriceMinor: line.unitPrice.amountMinor,
      })),
    };
    this.props.releases.push(release);
    this.raise(
      envelope({
        eventType: ProcurementEvents.AgreementReleased,
        aggregateType: "BlanketAgreement",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          agreementId: this.id,
          agreementNumber: this.props.agreementNumber,
          supplierId: this.props.supplierId,
          purchaseOrderId: input.purchaseOrderId,
          releaseValue: priced.total,
          releasedToDate: this.releasedValue,
          remainingValue: this.remainingValue,
        },
      }),
    );
    this.checkCommitment();
    return release;
  }

  /** Returns a release's value and quantity when its purchase order is cancelled. */
  cancelRelease(purchaseOrderId: Ulid, reason: string): AgreementRelease {
    const release = this.props.releases.find(
      (candidate) => candidate.purchaseOrderId === purchaseOrderId && !candidate.cancelled,
    );
    if (!release) {
      throw ValidationError.single(
        "purchaseOrderId",
        `no active release of ${this.props.agreementNumber} references ${purchaseOrderId}`,
      );
    }
    for (const releaseLine of release.lines) {
      const line = this.line(releaseLine.lineNumber);
      line.releasedQuantity = subQty(line.releasedQuantity, releaseLine.quantity);
    }
    this.props.releasedValueMinor = Math.max(0, this.props.releasedValueMinor - release.valueMinor);
    release.cancelled = true;
    this.raise(
      envelope({
        eventType: ProcurementEvents.AgreementReleaseReturned,
        aggregateType: "BlanketAgreement",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          agreementId: this.id,
          agreementNumber: this.props.agreementNumber,
          purchaseOrderId,
          returnedValue: money(release.valueMinor, this.props.currency),
          releasedToDate: this.releasedValue,
          reason: requiredText(reason, "reason", 3, 500),
        },
      }),
    );
    return release;
  }

  suspend(reason: string): void {
    this.assertStatus("suspend", ["active"]);
    this.props.status = "suspended";
    this.props.suspendedReason = requiredText(reason, "reason", 3, 500);
    this.raise(
      envelope({
        eventType: ProcurementEvents.AgreementSuspended,
        aggregateType: "BlanketAgreement",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          agreementId: this.id,
          agreementNumber: this.props.agreementNumber,
          supplierId: this.props.supplierId,
          reason: this.props.suspendedReason,
        },
      }),
    );
  }

  resume(): void {
    this.assertStatus("resume", ["suspended"]);
    this.props.status = "active";
    this.props.suspendedReason = undefined;
    this.raise(
      envelope({
        eventType: ProcurementEvents.AgreementResumed,
        aggregateType: "BlanketAgreement",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { agreementId: this.id, agreementNumber: this.props.agreementNumber },
      }),
    );
  }

  /** Sweep helper: expires the agreement once its end date has passed. */
  expire(today: IsoDate): boolean {
    if (this.props.status !== "active" && this.props.status !== "suspended") return false;
    if (compareDates(today, this.props.effectiveTo) <= 0) return false;
    this.props.status = "expired";
    this.raise(
      envelope({
        eventType: ProcurementEvents.AgreementExpired,
        aggregateType: "BlanketAgreement",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          agreementId: this.id,
          agreementNumber: this.props.agreementNumber,
          supplierId: this.props.supplierId,
          effectiveTo: this.props.effectiveTo,
          releasedValue: this.releasedValue,
          minimumCommitment: this.props.minimumCommitment,
          commitmentMet:
            this.props.minimumCommitment === undefined ||
            this.props.releasedValueMinor >= this.props.minimumCommitment.amountMinor,
        },
      }),
    );
    return true;
  }

  close(reason: string): void {
    if (["closed", "cancelled"].includes(this.props.status)) {
      throw InvalidStateError.transition("agreement", "close", this.props.status);
    }
    this.props.status = "closed";
    this.props.closedAt = nowIso();
    this.props.closeReason = requiredText(reason, "reason", 3, 500);
    this.raise(
      envelope({
        eventType: ProcurementEvents.AgreementClosed,
        aggregateType: "BlanketAgreement",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          agreementId: this.id,
          agreementNumber: this.props.agreementNumber,
          supplierId: this.props.supplierId,
          reason: this.props.closeReason,
          releasedValue: this.releasedValue,
        },
      }),
    );
  }

  /** Days until expiry; negative once expired. */
  daysToExpiry(today: IsoDate): number {
    return daysBetween(today, this.props.effectiveTo);
  }

  isRenewalDue(today: IsoDate): boolean {
    if (this.props.status !== "active") return false;
    const days = this.daysToExpiry(today);
    return days >= 0 && days <= this.props.renewalNoticeDays;
  }

  toJSON(): BlanketAgreementView {
    return {
      ...super.toJSON(),
      releasedValue: this.releasedValue,
      remainingValue: this.remainingValue,
      commitmentProgressBps: this.commitmentProgressBps,
      activeReleaseCount: this.activeReleaseCount,
    };
  }

  private checkCommitment(): void {
    const commitment = this.props.minimumCommitment;
    if (!commitment || this.props.commitmentNotified) return;
    if (this.props.releasedValueMinor < commitment.amountMinor) return;
    this.props.commitmentNotified = true;
    this.raise(
      envelope({
        eventType: ProcurementEvents.AgreementCommitmentReached,
        aggregateType: "BlanketAgreement",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          agreementId: this.id,
          agreementNumber: this.props.agreementNumber,
          supplierId: this.props.supplierId,
          minimumCommitment: commitment,
          releasedValue: this.releasedValue,
        },
      }),
    );
  }

  private nextLineNumber(): number {
    return this.props.lines.reduce((max, line) => Math.max(max, line.lineNumber), 0) + 10;
  }

  private assertStatus(action: string, expected: readonly AgreementStatus[]): void {
    if (!expected.includes(this.props.status)) {
      throw InvalidStateError.transition("agreement", action, this.props.status, expected);
    }
  }
}

/** Price tier helper for fixtures and HTTP payloads. */
export function priceTier(input: {
  minQuantity: number;
  unitPriceMinor: number;
  currency: string;
  effectiveFrom?: IsoDate;
  effectiveTo?: IsoDate;
}): PriceTier {
  return {
    minQuantity: quantity(input.minQuantity),
    unitPrice: money(input.unitPriceMinor, input.currency),
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo,
  };
}

export function zeroAgreementValue(currency: string): Money {
  return zeroMoney(currency);
}
