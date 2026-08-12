import {
  brand,
  type EventEnvelope,
  type IsoDateTime,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import type { ApprovalPolicy, ApprovalRequest, ApprovalRequestStatus } from "../domain/approval.js";
import type { AgreementStatus, BlanketAgreement } from "../domain/blanket-agreement.js";
import { isoDate, type DocumentType, type IsoDate } from "../domain/common.js";
import type { InvoiceStatus, SupplierInvoice } from "../domain/invoice.js";
import { formatDocumentNumber, type DocumentSeries } from "../domain/numbering.js";
import type { PurchaseOrder, PurchaseOrderStatus } from "../domain/purchase-order.js";
import type { GoodsReceipt } from "../domain/receipt.js";
import type { PurchaseRequisition, RequisitionStatus } from "../domain/requisition.js";
import type { RequestForQuote, RfqStatus } from "../domain/rfq.js";
import type { SupplierQuote } from "../domain/quote.js";
import type { SupplierRecord, SupplierStatus } from "../domain/supplier.js";
import type {
  AgreementRepository,
  ApprovalPolicyRepository,
  ApprovalRequestRepository,
  Clock,
  DocumentNumberGenerator,
  EventOutbox,
  InvoiceRepository,
  ProcurementRepositories,
  PurchaseOrderRepository,
  QuoteRepository,
  ReceiptRepository,
  Repository,
  RequisitionRepository,
  RfqRepository,
  SupplierDirectoryRepository,
} from "../application/ports.js";

// ---------------------------------------------------------------------------
// Clocks
// ---------------------------------------------------------------------------

export class SystemClock implements Clock {
  today(): IsoDate {
    return brand<string, "IsoDate">(new Date().toISOString().slice(0, 10));
  }
  now(): IsoDateTime {
    return brand<string, "IsoDateTime">(new Date().toISOString());
  }
}

/** Deterministic clock for tests, replays and SLA experiments. */
export class FixedClock implements Clock {
  private instant: Date;

  constructor(date: IsoDate | string, timeOfDay = "09:00:00") {
    this.instant = new Date(`${String(date).slice(0, 10)}T${timeOfDay}Z`);
  }

  today(): IsoDate {
    return brand<string, "IsoDate">(this.instant.toISOString().slice(0, 10));
  }

  now(): IsoDateTime {
    return brand<string, "IsoDateTime">(this.instant.toISOString());
  }

  set(date: IsoDate | string, timeOfDay = "09:00:00"): void {
    this.instant = new Date(`${String(date).slice(0, 10)}T${timeOfDay}Z`);
  }

  advanceDays(days: number): void {
    this.instant = new Date(this.instant.getTime() + days * 86_400_000);
  }

  advanceHours(hours: number): void {
    this.instant = new Date(this.instant.getTime() + hours * 3_600_000);
  }
}

// ---------------------------------------------------------------------------
// Outbox
// ---------------------------------------------------------------------------

/**
 * In-memory transactional outbox. `append` runs in the same logical
 * transaction as the repository write; `drain` hands events to a dispatcher
 * exactly once. Subscribers see events synchronously on append (handy for
 * projections and tests) but never consume them.
 */
export class InMemoryOutbox implements EventOutbox {
  private events: EventEnvelope[] = [];
  private readonly subscribers: Array<(event: EventEnvelope) => void> = [];

  append(events: readonly EventEnvelope[]): void {
    for (const event of events) {
      this.events.push(event);
      for (const subscriber of this.subscribers) subscriber(event);
    }
  }

  drain(): EventEnvelope[] {
    const drained = this.events;
    this.events = [];
    return drained;
  }

  peek(): readonly EventEnvelope[] {
    return this.events;
  }

  subscribe(listener: (event: EventEnvelope) => void): () => void {
    this.subscribers.push(listener);
    return () => {
      const index = this.subscribers.indexOf(listener);
      if (index >= 0) this.subscribers.splice(index, 1);
    };
  }
}

// ---------------------------------------------------------------------------
// Document numbering
// ---------------------------------------------------------------------------

/** Per-tenant, per-series, per-year counters mirroring a Postgres sequence table. */
export class InMemoryDocumentNumbers implements DocumentNumberGenerator {
  private readonly counters = new Map<string, number>();

  next(tenantId: TenantId, series: DocumentSeries, year: number): string {
    const key = `${tenantId}|${series}|${year}`;
    const value = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, value);
    return formatDocumentNumber(series, year, value);
  }

  /** Current high-water mark, for tests and diagnostics. */
  peek(tenantId: TenantId, series: DocumentSeries, year: number): number {
    return this.counters.get(`${tenantId}|${series}|${year}`) ?? 0;
  }
}

// ---------------------------------------------------------------------------
// Generic tenant-partitioned store
// ---------------------------------------------------------------------------

interface Identified {
  readonly id: Ulid;
  readonly tenantId: TenantId;
}

class InMemoryStore<T extends Identified> implements Repository<T> {
  protected readonly byTenant = new Map<TenantId, Map<Ulid, T>>();

  save(entity: T): void {
    let tenantMap = this.byTenant.get(entity.tenantId);
    if (!tenantMap) {
      tenantMap = new Map();
      this.byTenant.set(entity.tenantId, tenantMap);
    }
    tenantMap.set(entity.id, entity);
  }

  findById(tenantId: TenantId, id: Ulid): T | undefined {
    return this.byTenant.get(tenantId)?.get(id);
  }

  listByTenant(tenantId: TenantId): T[] {
    return [...(this.byTenant.get(tenantId)?.values() ?? [])];
  }

  protected filter(tenantId: TenantId, predicate: (entity: T) => boolean): T[] {
    return this.listByTenant(tenantId).filter(predicate);
  }
}

// ---------------------------------------------------------------------------
// Repositories
// ---------------------------------------------------------------------------

export class InMemorySupplierRepository
  extends InMemoryStore<SupplierRecord>
  implements SupplierDirectoryRepository
{
  findByNumber(tenantId: TenantId, supplierNumber: string): SupplierRecord | undefined {
    return this.listByTenant(tenantId).find((supplier) => supplier.supplierNumber === supplierNumber);
  }
  findByExternalId(tenantId: TenantId, externalId: Ulid): SupplierRecord | undefined {
    return this.listByTenant(tenantId).find(
      (supplier) => supplier.toJSON().externalId === externalId,
    );
  }
  listByStatus(tenantId: TenantId, status: SupplierStatus): SupplierRecord[] {
    return this.filter(tenantId, (supplier) => supplier.status === status);
  }
  listByCategory(tenantId: TenantId, categoryCode: string): SupplierRecord[] {
    return this.filter(tenantId, (supplier) => supplier.handlesCategory(categoryCode));
  }
}

export class InMemoryRequisitionRepository
  extends InMemoryStore<PurchaseRequisition>
  implements RequisitionRepository
{
  findByNumber(tenantId: TenantId, requisitionNumber: string): PurchaseRequisition | undefined {
    return this.listByTenant(tenantId).find(
      (requisition) => requisition.requisitionNumber === requisitionNumber,
    );
  }
  listByStatus(tenantId: TenantId, status: RequisitionStatus): PurchaseRequisition[] {
    return this.filter(tenantId, (requisition) => requisition.status === status);
  }
  listByRequester(tenantId: TenantId, requesterId: Ulid): PurchaseRequisition[] {
    return this.filter(tenantId, (requisition) => requisition.requesterId === requesterId);
  }
  listByCostCenter(tenantId: TenantId, costCenter: string): PurchaseRequisition[] {
    return this.filter(tenantId, (requisition) => requisition.costCenter === costCenter);
  }
}

export class InMemoryApprovalPolicyRepository
  extends InMemoryStore<ApprovalPolicy>
  implements ApprovalPolicyRepository
{
  findByCode(tenantId: TenantId, code: string): ApprovalPolicy | undefined {
    return this.listByTenant(tenantId).find((policy) => policy.code === code);
  }
  listByDocumentType(tenantId: TenantId, documentType: DocumentType): ApprovalPolicy[] {
    return this.filter(tenantId, (policy) => policy.documentType === documentType);
  }
}

export class InMemoryApprovalRequestRepository
  extends InMemoryStore<ApprovalRequest>
  implements ApprovalRequestRepository
{
  findByDocument(tenantId: TenantId, documentId: Ulid): ApprovalRequest[] {
    return this.filter(tenantId, (request) => request.documentId === documentId);
  }
  listByStatus(tenantId: TenantId, status: ApprovalRequestStatus): ApprovalRequest[] {
    return this.filter(tenantId, (request) => request.status === status);
  }
  listPendingForRoles(tenantId: TenantId, roles: readonly string[]): ApprovalRequest[] {
    const normalized = roles.map((role) => role.toLowerCase());
    return this.listByStatus(tenantId, "pending").filter((request) => {
      const step = request.currentStep;
      if (!step) return false;
      return (
        normalized.includes(step.roleCode) ||
        (step.escalatedAt !== undefined &&
          step.escalationRoleCode !== undefined &&
          normalized.includes(step.escalationRoleCode))
      );
    });
  }
  listPendingForApprover(tenantId: TenantId, approverId: Ulid): ApprovalRequest[] {
    return this.listByStatus(tenantId, "pending").filter((request) =>
      request.currentStep?.approverIds.includes(approverId),
    );
  }
}

export class InMemoryRfqRepository extends InMemoryStore<RequestForQuote> implements RfqRepository {
  findByNumber(tenantId: TenantId, rfqNumber: string): RequestForQuote | undefined {
    return this.listByTenant(tenantId).find((rfq) => rfq.rfqNumber === rfqNumber);
  }
  listByStatus(tenantId: TenantId, status: RfqStatus): RequestForQuote[] {
    return this.filter(tenantId, (rfq) => rfq.status === status);
  }
  listBySupplier(tenantId: TenantId, supplierId: Ulid): RequestForQuote[] {
    return this.filter(tenantId, (rfq) => rfq.isInvited(supplierId));
  }
  listByRequisition(tenantId: TenantId, requisitionId: Ulid): RequestForQuote[] {
    return this.filter(tenantId, (rfq) => rfq.requisitionIds.includes(requisitionId));
  }
}

export class InMemoryQuoteRepository extends InMemoryStore<SupplierQuote> implements QuoteRepository {
  findByNumber(tenantId: TenantId, quoteNumber: string): SupplierQuote | undefined {
    return this.listByTenant(tenantId).find((quote) => quote.quoteNumber === quoteNumber);
  }
  listByRfq(tenantId: TenantId, rfqId: Ulid): SupplierQuote[] {
    return this.filter(tenantId, (quote) => quote.rfqId === rfqId);
  }
  listBySupplier(tenantId: TenantId, supplierId: Ulid): SupplierQuote[] {
    return this.filter(tenantId, (quote) => quote.supplierId === supplierId);
  }
  findByRfqAndSupplier(tenantId: TenantId, rfqId: Ulid, supplierId: Ulid): SupplierQuote | undefined {
    return this.listByRfq(tenantId, rfqId).find((quote) => quote.supplierId === supplierId);
  }
}

export class InMemoryPurchaseOrderRepository
  extends InMemoryStore<PurchaseOrder>
  implements PurchaseOrderRepository
{
  findByNumber(tenantId: TenantId, orderNumber: string): PurchaseOrder | undefined {
    return this.listByTenant(tenantId).find((order) => order.orderNumber === orderNumber);
  }
  listByStatus(tenantId: TenantId, status: PurchaseOrderStatus): PurchaseOrder[] {
    return this.filter(tenantId, (order) => order.status === status);
  }
  listBySupplier(tenantId: TenantId, supplierId: Ulid): PurchaseOrder[] {
    return this.filter(tenantId, (order) => order.supplierId === supplierId);
  }
  listByRequisition(tenantId: TenantId, requisitionId: Ulid): PurchaseOrder[] {
    return this.filter(tenantId, (order) => order.requisitionIds.includes(requisitionId));
  }
  listByAgreement(tenantId: TenantId, agreementId: Ulid): PurchaseOrder[] {
    return this.filter(tenantId, (order) => order.agreementId === agreementId);
  }
  listOpen(tenantId: TenantId): PurchaseOrder[] {
    return this.filter(tenantId, (order) =>
      ["issued", "acknowledged", "partially_received"].includes(order.status),
    );
  }
}

export class InMemoryReceiptRepository extends InMemoryStore<GoodsReceipt> implements ReceiptRepository {
  findByNumber(tenantId: TenantId, receiptNumber: string): GoodsReceipt | undefined {
    return this.listByTenant(tenantId).find((receipt) => receipt.receiptNumber === receiptNumber);
  }
  listByPurchaseOrder(tenantId: TenantId, purchaseOrderId: Ulid): GoodsReceipt[] {
    return this.filter(tenantId, (receipt) => receipt.purchaseOrderId === purchaseOrderId);
  }
  listBySupplier(tenantId: TenantId, supplierId: Ulid): GoodsReceipt[] {
    return this.filter(tenantId, (receipt) => receipt.supplierId === supplierId);
  }
  listPosted(tenantId: TenantId): GoodsReceipt[] {
    return this.filter(tenantId, (receipt) => receipt.status === "posted");
  }
}

export class InMemoryInvoiceRepository
  extends InMemoryStore<SupplierInvoice>
  implements InvoiceRepository
{
  findByNumber(tenantId: TenantId, invoiceNumber: string): SupplierInvoice | undefined {
    return this.listByTenant(tenantId).find((invoice) => invoice.invoiceNumber === invoiceNumber);
  }
  listByStatus(tenantId: TenantId, status: InvoiceStatus): SupplierInvoice[] {
    return this.filter(tenantId, (invoice) => invoice.status === status);
  }
  listBySupplier(tenantId: TenantId, supplierId: Ulid): SupplierInvoice[] {
    return this.filter(tenantId, (invoice) => invoice.supplierId === supplierId);
  }
  listByPurchaseOrder(tenantId: TenantId, purchaseOrderId: Ulid): SupplierInvoice[] {
    return this.filter(tenantId, (invoice) => invoice.purchaseOrderId === purchaseOrderId);
  }
  findDuplicates(
    tenantId: TenantId,
    supplierId: Ulid,
    normalizedReference: string,
    excludeInvoiceId?: Ulid,
  ): SupplierInvoice[] {
    return this.filter(
      tenantId,
      (invoice) =>
        invoice.supplierId === supplierId &&
        invoice.normalizedReference === normalizedReference &&
        invoice.id !== excludeInvoiceId,
    );
  }
}

export class InMemoryAgreementRepository
  extends InMemoryStore<BlanketAgreement>
  implements AgreementRepository
{
  findByNumber(tenantId: TenantId, agreementNumber: string): BlanketAgreement | undefined {
    return this.listByTenant(tenantId).find(
      (agreement) => agreement.agreementNumber === agreementNumber,
    );
  }
  listByStatus(tenantId: TenantId, status: AgreementStatus): BlanketAgreement[] {
    return this.filter(tenantId, (agreement) => agreement.status === status);
  }
  listBySupplier(tenantId: TenantId, supplierId: Ulid): BlanketAgreement[] {
    return this.filter(tenantId, (agreement) => agreement.supplierId === supplierId);
  }
  listActiveOn(tenantId: TenantId, today: IsoDate): BlanketAgreement[] {
    return this.filter(tenantId, (agreement) => agreement.isReleasable(today));
  }
}

export function createInMemoryRepositories(): ProcurementRepositories {
  return {
    suppliers: new InMemorySupplierRepository(),
    requisitions: new InMemoryRequisitionRepository(),
    approvalPolicies: new InMemoryApprovalPolicyRepository(),
    approvalRequests: new InMemoryApprovalRequestRepository(),
    rfqs: new InMemoryRfqRepository(),
    quotes: new InMemoryQuoteRepository(),
    purchaseOrders: new InMemoryPurchaseOrderRepository(),
    receipts: new InMemoryReceiptRepository(),
    invoices: new InMemoryInvoiceRepository(),
    agreements: new InMemoryAgreementRepository(),
  };
}

/** Parses a date for callers holding raw strings (fixtures, HTTP, config). */
export function asIsoDate(value: string): IsoDate {
  return isoDate(value);
}
