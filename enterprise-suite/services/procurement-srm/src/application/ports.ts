import type {
  EventEnvelope,
  IsoDateTime,
  TenantId,
  Ulid,
} from "@enterprise-suite/shared-kernel";
import type { AggregateRoot } from "@enterprise-suite/shared-kernel";
import type { IsoDate } from "../domain/common.js";
import type { ApprovalPolicy, ApprovalRequest, ApprovalRequestStatus } from "../domain/approval.js";
import type { BlanketAgreement, AgreementStatus } from "../domain/blanket-agreement.js";
import type { DocumentSeries } from "../domain/numbering.js";
import type { GoodsReceipt } from "../domain/receipt.js";
import type { PurchaseOrder, PurchaseOrderStatus } from "../domain/purchase-order.js";
import type { PurchaseRequisition, RequisitionStatus } from "../domain/requisition.js";
import type { RequestForQuote, RfqStatus } from "../domain/rfq.js";
import type { SupplierInvoice, InvoiceStatus } from "../domain/invoice.js";
import type { SupplierQuote } from "../domain/quote.js";
import type { SupplierRecord, SupplierStatus } from "../domain/supplier.js";
import type { DocumentType } from "../domain/common.js";

/**
 * Deterministic time source. Production uses SystemClock; tests use FixedClock
 * so deadline, SLA and expiry rules can be exercised around any date.
 */
export interface Clock {
  today(): IsoDate;
  now(): IsoDateTime;
}

/**
 * Transactional-outbox port. Services append the events pulled from aggregates
 * after persisting them; a dispatcher (integration-hub) drains.
 */
export interface EventOutbox {
  append(events: readonly EventEnvelope[]): void;
  /** Removes and returns all undispatched events, oldest first. */
  drain(): EventEnvelope[];
  /** Non-destructive view of undispatched events. */
  peek(): readonly EventEnvelope[];
}

/**
 * Allocates human-readable document numbers (`PO-2026-000042`) per tenant,
 * series and year. Postgres implementations back this with a sequence table.
 */
export interface DocumentNumberGenerator {
  next(tenantId: TenantId, series: DocumentSeries, year: number): string;
}

/** Base repository shape shared by every aggregate in this context. */
export interface Repository<T> {
  save(entity: T): void;
  findById(tenantId: TenantId, id: Ulid): T | undefined;
  listByTenant(tenantId: TenantId): T[];
}

export interface SupplierDirectoryRepository extends Repository<SupplierRecord> {
  findByNumber(tenantId: TenantId, supplierNumber: string): SupplierRecord | undefined;
  findByExternalId(tenantId: TenantId, externalId: Ulid): SupplierRecord | undefined;
  listByStatus(tenantId: TenantId, status: SupplierStatus): SupplierRecord[];
  listByCategory(tenantId: TenantId, categoryCode: string): SupplierRecord[];
}

export interface RequisitionRepository extends Repository<PurchaseRequisition> {
  findByNumber(tenantId: TenantId, requisitionNumber: string): PurchaseRequisition | undefined;
  listByStatus(tenantId: TenantId, status: RequisitionStatus): PurchaseRequisition[];
  listByRequester(tenantId: TenantId, requesterId: Ulid): PurchaseRequisition[];
  listByCostCenter(tenantId: TenantId, costCenter: string): PurchaseRequisition[];
}

export interface ApprovalPolicyRepository extends Repository<ApprovalPolicy> {
  findByCode(tenantId: TenantId, code: string): ApprovalPolicy | undefined;
  listByDocumentType(tenantId: TenantId, documentType: DocumentType): ApprovalPolicy[];
}

export interface ApprovalRequestRepository extends Repository<ApprovalRequest> {
  findByDocument(tenantId: TenantId, documentId: Ulid): ApprovalRequest[];
  listByStatus(tenantId: TenantId, status: ApprovalRequestStatus): ApprovalRequest[];
  /** Requests whose current step is decidable by one of `roles`. */
  listPendingForRoles(tenantId: TenantId, roles: readonly string[]): ApprovalRequest[];
  listPendingForApprover(tenantId: TenantId, approverId: Ulid): ApprovalRequest[];
}

export interface RfqRepository extends Repository<RequestForQuote> {
  findByNumber(tenantId: TenantId, rfqNumber: string): RequestForQuote | undefined;
  listByStatus(tenantId: TenantId, status: RfqStatus): RequestForQuote[];
  listBySupplier(tenantId: TenantId, supplierId: Ulid): RequestForQuote[];
  listByRequisition(tenantId: TenantId, requisitionId: Ulid): RequestForQuote[];
}

export interface QuoteRepository extends Repository<SupplierQuote> {
  findByNumber(tenantId: TenantId, quoteNumber: string): SupplierQuote | undefined;
  listByRfq(tenantId: TenantId, rfqId: Ulid): SupplierQuote[];
  listBySupplier(tenantId: TenantId, supplierId: Ulid): SupplierQuote[];
  findByRfqAndSupplier(tenantId: TenantId, rfqId: Ulid, supplierId: Ulid): SupplierQuote | undefined;
}

export interface PurchaseOrderRepository extends Repository<PurchaseOrder> {
  findByNumber(tenantId: TenantId, orderNumber: string): PurchaseOrder | undefined;
  listByStatus(tenantId: TenantId, status: PurchaseOrderStatus): PurchaseOrder[];
  listBySupplier(tenantId: TenantId, supplierId: Ulid): PurchaseOrder[];
  listByRequisition(tenantId: TenantId, requisitionId: Ulid): PurchaseOrder[];
  listByAgreement(tenantId: TenantId, agreementId: Ulid): PurchaseOrder[];
  /** Issued/acknowledged/partially received orders — the receivable backlog. */
  listOpen(tenantId: TenantId): PurchaseOrder[];
}

export interface ReceiptRepository extends Repository<GoodsReceipt> {
  findByNumber(tenantId: TenantId, receiptNumber: string): GoodsReceipt | undefined;
  listByPurchaseOrder(tenantId: TenantId, purchaseOrderId: Ulid): GoodsReceipt[];
  listBySupplier(tenantId: TenantId, supplierId: Ulid): GoodsReceipt[];
  listPosted(tenantId: TenantId): GoodsReceipt[];
}

export interface InvoiceRepository extends Repository<SupplierInvoice> {
  findByNumber(tenantId: TenantId, invoiceNumber: string): SupplierInvoice | undefined;
  listByStatus(tenantId: TenantId, status: InvoiceStatus): SupplierInvoice[];
  listBySupplier(tenantId: TenantId, supplierId: Ulid): SupplierInvoice[];
  listByPurchaseOrder(tenantId: TenantId, purchaseOrderId: Ulid): SupplierInvoice[];
  /** Same supplier and normalised reference — the duplicate-invoice guard. */
  findDuplicates(
    tenantId: TenantId,
    supplierId: Ulid,
    normalizedReference: string,
    excludeInvoiceId?: Ulid,
  ): SupplierInvoice[];
}

export interface AgreementRepository extends Repository<BlanketAgreement> {
  findByNumber(tenantId: TenantId, agreementNumber: string): BlanketAgreement | undefined;
  listByStatus(tenantId: TenantId, status: AgreementStatus): BlanketAgreement[];
  listBySupplier(tenantId: TenantId, supplierId: Ulid): BlanketAgreement[];
  /** Active agreements covering `today`, cheapest-price lookup candidates. */
  listActiveOn(tenantId: TenantId, today: IsoDate): BlanketAgreement[];
}

/** Every persistence port bundled for service construction. */
export interface ProcurementRepositories {
  suppliers: SupplierDirectoryRepository;
  requisitions: RequisitionRepository;
  approvalPolicies: ApprovalPolicyRepository;
  approvalRequests: ApprovalRequestRepository;
  rfqs: RfqRepository;
  quotes: QuoteRepository;
  purchaseOrders: PurchaseOrderRepository;
  receipts: ReceiptRepository;
  invoices: InvoiceRepository;
  agreements: AgreementRepository;
}

/**
 * Persist an aggregate and move its pending events into the outbox. Services
 * call this instead of touching repositories directly so no code path can save
 * state while dropping the events that describe it.
 */
export function commit<T extends AggregateRoot<object>>(
  repository: Repository<T>,
  outbox: EventOutbox,
  aggregate: T,
): T {
  repository.save(aggregate);
  outbox.append(aggregate.pullEvents());
  return aggregate;
}
