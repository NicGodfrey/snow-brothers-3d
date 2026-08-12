import {
  NotFoundError,
  money,
  type Money,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { currencyCode, quantity, yearOf, type IsoDate, type Quantity } from "../domain/common.js";
import { ValidationError } from "../domain/errors.js";
import {
  PurchaseRequisition,
  type RequisitionLine,
  type RequisitionLineInput,
  type RequisitionPriority,
  type RequisitionStatus,
} from "../domain/requisition.js";
import type { ApprovalService } from "./approval-service.js";
import {
  commit,
  type Clock,
  type DocumentNumberGenerator,
  type EventOutbox,
  type RequisitionRepository,
  type SupplierDirectoryRepository,
} from "./ports.js";

export interface CreateRequisitionInput {
  title: string;
  requesterId: Ulid;
  costCenter: string;
  currency: string;
  neededBy: IsoDate;
  deliverTo: string;
  priority?: RequisitionPriority;
  justification?: string;
  budgetCode?: string;
  projectCode?: string;
  notes?: string;
  lines?: readonly RequisitionLineInput[];
}

export interface RequisitionFilters {
  status?: RequisitionStatus;
  requesterId?: Ulid;
  costCenter?: string;
}

/**
 * Use cases for the demand side of procurement. Submitting a requisition hands
 * it to the approval engine; the outcome comes back through the handler wired
 * in the composition root, so this service never calls approvals back.
 */
export class RequisitionService {
  constructor(
    private readonly requisitions: RequisitionRepository,
    private readonly suppliers: SupplierDirectoryRepository,
    private readonly approvals: ApprovalService,
    private readonly numbers: DocumentNumberGenerator,
    private readonly outbox: EventOutbox,
    private readonly clock: Clock,
  ) {}

  /** Wired by the composition root so approvals can drive the aggregate. */
  registerApprovalHandler(): () => void {
    return this.approvals.onOutcome("requisition", ({ tenantId, request, outcome, reason }) => {
      const requisition = this.requisitions.findById(tenantId, request.documentId);
      if (!requisition || requisition.status !== "pending_approval") return;
      if (outcome === "approved") requisition.approve(request.approvers);
      else requisition.reject(reason ?? "Rejected during approval");
      commit(this.requisitions, this.outbox, requisition);
    });
  }

  create(tenantId: TenantId, input: CreateRequisitionInput): PurchaseRequisition {
    const today = this.clock.today();
    const requisition = PurchaseRequisition.create(tenantId, {
      ...input,
      currency: currencyCode(input.currency),
      requisitionNumber: this.numbers.next(tenantId, "PR", yearOf(today)),
    });
    return commit(this.requisitions, this.outbox, requisition);
  }

  get(tenantId: TenantId, requisitionId: Ulid): PurchaseRequisition {
    const requisition = this.requisitions.findById(tenantId, requisitionId);
    if (!requisition) throw new NotFoundError("PurchaseRequisition", requisitionId);
    return requisition;
  }

  getByNumber(tenantId: TenantId, requisitionNumber: string): PurchaseRequisition {
    const requisition = this.requisitions.findByNumber(tenantId, requisitionNumber);
    if (!requisition) throw new NotFoundError("PurchaseRequisition", requisitionNumber);
    return requisition;
  }

  list(tenantId: TenantId, filters: RequisitionFilters = {}): PurchaseRequisition[] {
    let results = filters.status
      ? this.requisitions.listByStatus(tenantId, filters.status)
      : this.requisitions.listByTenant(tenantId);
    if (filters.requesterId) {
      results = results.filter((requisition) => requisition.requesterId === filters.requesterId);
    }
    if (filters.costCenter) {
      results = results.filter((requisition) => requisition.costCenter === filters.costCenter);
    }
    return results.sort((a, b) => a.requisitionNumber.localeCompare(b.requisitionNumber));
  }

  /** Approved requisitions with quantity still to be sourced. */
  listSourceable(tenantId: TenantId): PurchaseRequisition[] {
    return [
      ...this.requisitions.listByStatus(tenantId, "approved"),
      ...this.requisitions.listByStatus(tenantId, "partially_ordered"),
    ].sort((a, b) => a.neededBy.localeCompare(b.neededBy));
  }

  addLine(tenantId: TenantId, requisitionId: Ulid, input: RequisitionLineInput): RequisitionLine {
    const requisition = this.get(tenantId, requisitionId);
    if (input.suggestedSupplierId) {
      this.assertSupplierExists(tenantId, input.suggestedSupplierId);
    }
    const line = requisition.addLine(input);
    commit(this.requisitions, this.outbox, requisition);
    return line;
  }

  updateLine(
    tenantId: TenantId,
    requisitionId: Ulid,
    lineId: Ulid,
    patch: {
      description?: string;
      quantity?: number;
      estimatedUnitPrice?: Money;
      neededBy?: IsoDate;
      categoryCode?: string;
      suggestedSupplierId?: Ulid;
      notes?: string;
    },
  ): RequisitionLine {
    const requisition = this.get(tenantId, requisitionId);
    if (patch.suggestedSupplierId) this.assertSupplierExists(tenantId, patch.suggestedSupplierId);
    const line = requisition.updateLine(lineId, patch);
    commit(this.requisitions, this.outbox, requisition);
    return line;
  }

  removeLine(tenantId: TenantId, requisitionId: Ulid, lineId: Ulid): PurchaseRequisition {
    const requisition = this.get(tenantId, requisitionId);
    requisition.removeLine(lineId);
    return commit(this.requisitions, this.outbox, requisition);
  }

  cancelLine(tenantId: TenantId, requisitionId: Ulid, lineId: Ulid, reason: string): RequisitionLine {
    const requisition = this.get(tenantId, requisitionId);
    const line = requisition.cancelLine(lineId, reason);
    commit(this.requisitions, this.outbox, requisition);
    return line;
  }

  /**
   * Submits for approval. The estimated total, categories and cost centre pick
   * the policy, so a low-value requisition can come back already approved.
   */
  submit(tenantId: TenantId, requisitionId: Ulid, policyCode?: string): PurchaseRequisition {
    const requisition = this.get(tenantId, requisitionId);
    requisition.submit(this.clock.today());
    commit(this.requisitions, this.outbox, requisition);

    const request = this.approvals.requestApproval(tenantId, {
      documentType: "requisition",
      documentId: requisition.id,
      documentNumber: requisition.requisitionNumber,
      amount: requisition.estimatedTotal,
      requestedBy: requisition.requesterId,
      categoryCodes: requisition.categoryCodes,
      costCenter: requisition.costCenter,
      policyCode,
      context: { neededBy: requisition.neededBy, priority: requisition.priority },
    });
    requisition.attachApprovalRequest(request.id);
    return commit(this.requisitions, this.outbox, requisition);
  }

  withdraw(tenantId: TenantId, requisitionId: Ulid, reason: string): PurchaseRequisition {
    const requisition = this.get(tenantId, requisitionId);
    requisition.withdraw(reason);
    commit(this.requisitions, this.outbox, requisition);
    this.approvals.cancelForDocument(tenantId, requisition.id, `Requisition withdrawn: ${reason}`);
    return requisition;
  }

  /** Marks a line as out to tender; called by the sourcing service. */
  markLineSourcing(
    tenantId: TenantId,
    requisitionId: Ulid,
    lineId: Ulid,
    rfqId: Ulid,
  ): RequisitionLine {
    const requisition = this.get(tenantId, requisitionId);
    const line = requisition.markLineSourcing(lineId, rfqId);
    commit(this.requisitions, this.outbox, requisition);
    return line;
  }

  /** Records purchase order coverage; called by the purchase order service. */
  recordOrdered(
    tenantId: TenantId,
    requisitionId: Ulid,
    lineId: Ulid,
    orderedQty: Quantity,
    purchaseOrderId: Ulid,
  ): RequisitionLine {
    const requisition = this.get(tenantId, requisitionId);
    const line = requisition.recordOrdered(lineId, orderedQty, purchaseOrderId);
    commit(this.requisitions, this.outbox, requisition);
    return line;
  }

  releaseOrdered(
    tenantId: TenantId,
    requisitionId: Ulid,
    lineId: Ulid,
    releasedQty: Quantity,
    purchaseOrderId: Ulid,
  ): RequisitionLine {
    const requisition = this.get(tenantId, requisitionId);
    const line = requisition.releaseOrdered(lineId, releasedQty, purchaseOrderId);
    commit(this.requisitions, this.outbox, requisition);
    return line;
  }

  close(tenantId: TenantId, requisitionId: Ulid, reason: string): PurchaseRequisition {
    const requisition = this.get(tenantId, requisitionId);
    requisition.close(reason);
    return commit(this.requisitions, this.outbox, requisition);
  }

  cancel(tenantId: TenantId, requisitionId: Ulid, reason: string): PurchaseRequisition {
    const requisition = this.get(tenantId, requisitionId);
    requisition.cancel(reason);
    commit(this.requisitions, this.outbox, requisition);
    this.approvals.cancelForDocument(tenantId, requisition.id, `Requisition cancelled: ${reason}`);
    return requisition;
  }

  /** Open demand grouped by category — the input to a sourcing plan. */
  demandByCategory(
    tenantId: TenantId,
  ): Array<{ categoryCode: string; lineCount: number; estimatedValue: Money; currency: string }> {
    const buckets = new Map<string, { lineCount: number; valueMinor: number; currency: string }>();
    for (const requisition of this.listSourceable(tenantId)) {
      for (const line of requisition.lines) {
        if (line.status === "cancelled" || line.status === "ordered") continue;
        const key = `${line.categoryCode}|${requisition.currency}`;
        const bucket = buckets.get(key) ?? {
          lineCount: 0,
          valueMinor: 0,
          currency: requisition.currency,
        };
        bucket.lineCount += 1;
        bucket.valueMinor += Math.round(line.estimatedUnitPrice.amountMinor * line.remainingQuantity);
        buckets.set(key, bucket);
      }
    }
    return [...buckets.entries()]
      .map(([key, bucket]) => ({
        categoryCode: key.split("|")[0],
        lineCount: bucket.lineCount,
        estimatedValue: money(bucket.valueMinor, bucket.currency),
        currency: bucket.currency,
      }))
      .sort((a, b) => b.estimatedValue.amountMinor - a.estimatedValue.amountMinor);
  }

  /** Requisition lines whose need-by date has passed without full coverage. */
  overdueDemand(tenantId: TenantId): Array<{ requisition: PurchaseRequisition; line: RequisitionLine }> {
    const today = this.clock.today();
    const overdue: Array<{ requisition: PurchaseRequisition; line: RequisitionLine }> = [];
    for (const requisition of this.listSourceable(tenantId)) {
      for (const line of requisition.lines) {
        if (line.status === "cancelled" || line.status === "ordered") continue;
        const due = line.neededBy ?? requisition.neededBy;
        if (due < today) overdue.push({ requisition, line });
      }
    }
    return overdue;
  }

  private assertSupplierExists(tenantId: TenantId, supplierId: Ulid): void {
    if (!this.suppliers.findById(tenantId, supplierId)) {
      throw ValidationError.single("suggestedSupplierId", `supplier ${supplierId} is not in the directory`);
    }
  }
}

/** Builds a line input from primitives (HTTP bodies, fixtures, imports). */
export function lineInput(input: {
  description: string;
  categoryCode: string;
  quantity: number;
  uom: string;
  unitPriceMinor: number;
  currency: string;
  neededBy?: IsoDate;
  itemCode?: string;
  suggestedSupplierId?: Ulid;
  glAccount?: string;
}): RequisitionLineInput {
  return {
    description: input.description,
    categoryCode: input.categoryCode,
    quantity: quantity(input.quantity),
    uom: input.uom,
    estimatedUnitPrice: money(input.unitPriceMinor, input.currency),
    neededBy: input.neededBy,
    itemCode: input.itemCode,
    suggestedSupplierId: input.suggestedSupplierId,
    glAccount: input.glAccount,
  };
}
