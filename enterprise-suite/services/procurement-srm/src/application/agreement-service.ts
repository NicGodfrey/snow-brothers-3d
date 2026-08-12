import {
  NotFoundError,
  money,
  type Money,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import {
  currencyCode,
  positiveQuantity,
  yearOf,
  type IsoDate,
} from "../domain/common.js";
import {
  BlanketAgreement,
  type AgreementLine,
  type AgreementLineInput,
  type AgreementRelease,
  type AgreementStatus,
  type AgreementType,
  type PriceTier,
} from "../domain/blanket-agreement.js";
import { ValidationError } from "../domain/errors.js";
import type { PurchaseOrder, PurchaseOrderLineInput } from "../domain/purchase-order.js";
import type { PurchaseOrderService } from "./purchase-order-service.js";
import type { SupplierDirectoryService } from "./supplier-directory-service.js";
import {
  commit,
  type AgreementRepository,
  type Clock,
  type DocumentNumberGenerator,
  type EventOutbox,
} from "./ports.js";

export interface CreateAgreementInput {
  title: string;
  supplierId: Ulid;
  ownerId: Ulid;
  effectiveFrom: IsoDate;
  effectiveTo: IsoDate;
  maximumValue: Money;
  currency?: string;
  agreementType?: AgreementType;
  minimumCommitment?: Money;
  releaseLimit?: Money;
  paymentTermsDays?: number;
  incoterm?: string;
  autoReleaseApproved?: boolean;
  renewalNoticeDays?: number;
  notes?: string;
  lines?: readonly AgreementLineInput[];
}

export interface ReleaseInput {
  buyerId: Ulid;
  lines: ReadonlyArray<{ lineNumber: number; quantity: number; needBy: IsoDate }>;
  shipTo: string;
  requisitionId?: Ulid;
  notes?: string;
  /** Issues the order immediately when the agreement allows auto-release. */
  autoIssue?: boolean;
}

export interface ReleaseResult {
  agreement: BlanketAgreement;
  order: PurchaseOrder;
  release: AgreementRelease;
}

/**
 * Blanket / contract agreement use cases. A release prices itself from the
 * agreement's tiers, reserves value and quantity, and produces a purchase
 * order that skips the approval chain when it sits inside the negotiated
 * limits.
 */
export class AgreementService {
  constructor(
    private readonly agreements: AgreementRepository,
    private readonly suppliers: SupplierDirectoryService,
    private readonly purchaseOrders: PurchaseOrderService,
    private readonly numbers: DocumentNumberGenerator,
    private readonly outbox: EventOutbox,
    private readonly clock: Clock,
  ) {}

  /** Returns released value when a release's purchase order is cancelled. */
  registerOrderCancellationHandler(): () => void {
    return this.purchaseOrders.onCancelled(({ tenantId, order, reason }) => {
      if (!order.agreementId) return;
      const agreement = this.agreements.findById(tenantId, order.agreementId);
      if (!agreement) return;
      const hasRelease = agreement.releases.some(
        (release) => release.purchaseOrderId === order.id && !release.cancelled,
      );
      if (!hasRelease) return;
      agreement.cancelRelease(order.id, reason);
      commit(this.agreements, this.outbox, agreement);
    });
  }

  create(tenantId: TenantId, input: CreateAgreementInput): BlanketAgreement {
    const supplier = this.suppliers.get(tenantId, input.supplierId);
    supplier.assertSourceable();
    const today = this.clock.today();
    const agreement = BlanketAgreement.create(tenantId, {
      ...input,
      currency: currencyCode(input.currency ?? supplier.currency),
      paymentTermsDays: input.paymentTermsDays ?? supplier.paymentTermsDays,
      incoterm: input.incoterm ?? supplier.defaultIncoterm,
      agreementNumber: this.numbers.next(tenantId, "BPA", yearOf(today)),
    });
    return commit(this.agreements, this.outbox, agreement);
  }

  get(tenantId: TenantId, agreementId: Ulid): BlanketAgreement {
    const agreement = this.agreements.findById(tenantId, agreementId);
    if (!agreement) throw new NotFoundError("BlanketAgreement", agreementId);
    return agreement;
  }

  getByNumber(tenantId: TenantId, agreementNumber: string): BlanketAgreement {
    const agreement = this.agreements.findByNumber(tenantId, agreementNumber);
    if (!agreement) throw new NotFoundError("BlanketAgreement", agreementNumber);
    return agreement;
  }

  list(
    tenantId: TenantId,
    filters: { status?: AgreementStatus; supplierId?: Ulid } = {},
  ): BlanketAgreement[] {
    let results = filters.status
      ? this.agreements.listByStatus(tenantId, filters.status)
      : this.agreements.listByTenant(tenantId);
    if (filters.supplierId) {
      results = results.filter((agreement) => agreement.supplierId === filters.supplierId);
    }
    return results.sort((a, b) => a.agreementNumber.localeCompare(b.agreementNumber));
  }

  addLine(tenantId: TenantId, agreementId: Ulid, input: AgreementLineInput): AgreementLine {
    const agreement = this.get(tenantId, agreementId);
    const line = agreement.addLine(input);
    commit(this.agreements, this.outbox, agreement);
    return line;
  }

  addPriceTier(tenantId: TenantId, agreementId: Ulid, lineNumber: number, tier: PriceTier): AgreementLine {
    const agreement = this.get(tenantId, agreementId);
    const line = agreement.addPriceTier(lineNumber, tier);
    commit(this.agreements, this.outbox, agreement);
    return line;
  }

  activate(tenantId: TenantId, agreementId: Ulid): BlanketAgreement {
    const agreement = this.get(tenantId, agreementId);
    this.suppliers.get(tenantId, agreement.supplierId).assertOrderable();
    agreement.activate(this.clock.today());
    return commit(this.agreements, this.outbox, agreement);
  }

  suspend(tenantId: TenantId, agreementId: Ulid, reason: string): BlanketAgreement {
    const agreement = this.get(tenantId, agreementId);
    agreement.suspend(reason);
    return commit(this.agreements, this.outbox, agreement);
  }

  resume(tenantId: TenantId, agreementId: Ulid): BlanketAgreement {
    const agreement = this.get(tenantId, agreementId);
    agreement.resume();
    return commit(this.agreements, this.outbox, agreement);
  }

  close(tenantId: TenantId, agreementId: Ulid, reason: string): BlanketAgreement {
    const agreement = this.get(tenantId, agreementId);
    agreement.close(reason);
    return commit(this.agreements, this.outbox, agreement);
  }

  /** Prices a prospective release without reserving anything. */
  quote(
    tenantId: TenantId,
    agreementId: Ulid,
    lines: ReadonlyArray<{ lineNumber: number; quantity: number }>,
  ): { lines: Array<{ lineNumber: number; quantity: number; unitPrice: Money; amount: Money }>; total: Money } {
    const agreement = this.get(tenantId, agreementId);
    return agreement.quoteRelease(lines, this.clock.today());
  }

  /**
   * Draws down against the agreement: reserves the value and quantity, raises
   * the purchase order at contracted prices, and pre-approves it when the
   * agreement permits auto-release.
   */
  release(tenantId: TenantId, agreementId: Ulid, input: ReleaseInput): ReleaseResult {
    const agreement = this.get(tenantId, agreementId);
    const today = this.clock.today();
    agreement.assertReleasable(today);
    if (input.lines.length === 0) {
      throw ValidationError.single("lines", "a release needs at least one line");
    }
    const supplier = this.suppliers.get(tenantId, agreement.supplierId);
    supplier.assertOrderable();

    const priced = agreement.quoteRelease(
      input.lines.map((line) => ({ lineNumber: line.lineNumber, quantity: line.quantity })),
      today,
    );
    const orderLines: PurchaseOrderLineInput[] = input.lines.map((requested) => {
      const agreementLine = agreement.line(requested.lineNumber);
      const pricedLine = priced.lines.find((line) => line.lineNumber === requested.lineNumber);
      if (!pricedLine) {
        throw ValidationError.single("lineNumber", `${requested.lineNumber} could not be priced`);
      }
      return {
        description: agreementLine.description,
        categoryCode: agreementLine.categoryCode,
        quantity: positiveQuantity(requested.quantity, "quantity"),
        uom: agreementLine.uom,
        unitPrice: pricedLine.unitPrice,
        needBy: requested.needBy,
        itemCode: agreementLine.itemCode,
        agreementId: agreement.id,
        agreementLineNumber: agreementLine.lineNumber,
        requisitionId: input.requisitionId,
      };
    });

    const order = this.purchaseOrders.create(tenantId, {
      supplierId: agreement.supplierId,
      buyerId: input.buyerId,
      currency: agreement.currency,
      shipTo: input.shipTo,
      incoterm: agreement.incoterm,
      paymentTermsDays: agreement.paymentTermsDays,
      sourceType: "agreement_release",
      agreementId: agreement.id,
      requisitionIds: input.requisitionId ? [input.requisitionId] : undefined,
      supplierReference: agreement.agreementNumber,
      notes: input.notes,
      lines: orderLines,
    });

    // Reserving after the order exists keeps the release row pointing at a
    // real purchase order; a cap breach here rolls the order back.
    let release: AgreementRelease;
    try {
      release = agreement.recordRelease({
        purchaseOrderId: order.id,
        orderNumber: order.orderNumber,
        releasedBy: input.buyerId,
        today,
        lines: input.lines.map((line) => ({ lineNumber: line.lineNumber, quantity: line.quantity })),
      });
    } catch (error) {
      this.purchaseOrders.cancel(tenantId, order.id, "Agreement release rejected by a contract limit");
      throw error;
    }
    commit(this.agreements, this.outbox, agreement);

    if (agreement.autoReleaseApproved) {
      this.purchaseOrders.approveWithoutChain(tenantId, order.id, input.buyerId);
      if (input.autoIssue) this.purchaseOrders.issue(tenantId, order.id);
    }
    return { agreement, order, release };
  }

  /** Expires agreements past their end date; safe to run repeatedly. */
  expireDue(tenantId: TenantId): BlanketAgreement[] {
    const today = this.clock.today();
    const expired: BlanketAgreement[] = [];
    for (const agreement of this.agreements.listByTenant(tenantId)) {
      if (agreement.expire(today)) {
        commit(this.agreements, this.outbox, agreement);
        expired.push(agreement);
      }
    }
    return expired;
  }

  /** Agreements inside their renewal notice window. */
  renewalsDue(tenantId: TenantId): BlanketAgreement[] {
    const today = this.clock.today();
    return this.agreements
      .listByTenant(tenantId)
      .filter((agreement) => agreement.isRenewalDue(today))
      .sort((a, b) => a.effectiveTo.localeCompare(b.effectiveTo));
  }

  /**
   * Best contracted price for an item across active agreements — the lookup a
   * buyer runs before sourcing something that is already under contract.
   */
  bestContractPrice(
    tenantId: TenantId,
    itemCode: string,
    qty: number,
  ): { agreement: BlanketAgreement; lineNumber: number; unitPrice: Money } | undefined {
    const today = this.clock.today();
    const requested = positiveQuantity(qty, "quantity");
    let best: { agreement: BlanketAgreement; lineNumber: number; unitPrice: Money } | undefined;
    for (const agreement of this.agreements.listActiveOn(tenantId, today)) {
      for (const line of agreement.lines) {
        if (line.itemCode !== itemCode) continue;
        const unitPrice = line.priceFor(requested, today);
        if (!best || unitPrice.amountMinor < best.unitPrice.amountMinor) {
          best = { agreement, lineNumber: line.lineNumber, unitPrice };
        }
      }
    }
    return best;
  }

  /** Commitment progress for every active agreement with a minimum. */
  commitmentReport(
    tenantId: TenantId,
  ): Array<{
    agreement: BlanketAgreement;
    releasedValue: Money;
    minimumCommitment: Money;
    progressBps: number;
    daysToExpiry: number;
  }> {
    const today = this.clock.today();
    return this.agreements
      .listByTenant(tenantId)
      .filter((agreement) => agreement.minimumCommitment !== undefined)
      .map((agreement) => ({
        agreement,
        releasedValue: agreement.releasedValue,
        minimumCommitment: agreement.minimumCommitment as Money,
        progressBps: agreement.commitmentProgressBps ?? 0,
        daysToExpiry: agreement.daysToExpiry(today),
      }))
      .sort((a, b) => a.progressBps - b.progressBps);
  }

  /** Total value still available across a supplier's active agreements. */
  availableValue(tenantId: TenantId, supplierId: Ulid, currency: string): Money {
    const target = currencyCode(currency);
    const minor = this.agreements
      .listBySupplier(tenantId, supplierId)
      .filter((agreement) => agreement.status === "active" && agreement.currency === target)
      .reduce((total, agreement) => total + agreement.remainingValue.amountMinor, 0);
    return money(minor, target);
  }
}
