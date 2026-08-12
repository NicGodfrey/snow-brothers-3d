import type { Money, Ulid } from "@enterprise-suite/shared-kernel";
import type { DocumentType, IsoDate, Quantity, UomCode } from "./common.js";

/**
 * Canonical event types emitted by the procurement bounded context.
 * Names follow `procurement.<aggregate>.<past-tense-verb>` so consumers can
 * subscribe with prefix filters (e.g. everything under `procurement.po.`).
 */
export const ProcurementEvents = {
  SupplierRegistered: "procurement.supplier.registered",
  SupplierSynced: "procurement.supplier.synced",
  SupplierBlocked: "procurement.supplier.blocked",
  SupplierUnblocked: "procurement.supplier.unblocked",

  RequisitionCreated: "procurement.requisition.created",
  RequisitionSubmitted: "procurement.requisition.submitted",
  RequisitionWithdrawn: "procurement.requisition.withdrawn",
  RequisitionApproved: "procurement.requisition.approved",
  RequisitionRejected: "procurement.requisition.rejected",
  RequisitionLineSourcing: "procurement.requisition.line_sourcing",
  RequisitionLineOrdered: "procurement.requisition.line_ordered",
  RequisitionLineCancelled: "procurement.requisition.line_cancelled",
  RequisitionOrdered: "procurement.requisition.ordered",
  RequisitionClosed: "procurement.requisition.closed",
  RequisitionCancelled: "procurement.requisition.cancelled",

  ApprovalRequested: "procurement.approval.requested",
  ApprovalStepApproved: "procurement.approval.step_approved",
  ApprovalStepRejected: "procurement.approval.step_rejected",
  ApprovalDelegated: "procurement.approval.delegated",
  ApprovalEscalated: "procurement.approval.escalated",
  ApprovalCompleted: "procurement.approval.completed",
  ApprovalCancelled: "procurement.approval.cancelled",
  ApprovalPolicyPublished: "procurement.approval_policy.published",

  RfqCreated: "procurement.rfq.created",
  RfqSupplierInvited: "procurement.rfq.supplier_invited",
  RfqIssued: "procurement.rfq.issued",
  RfqAmended: "procurement.rfq.amended",
  RfqDeadlineExtended: "procurement.rfq.deadline_extended",
  RfqSupplierDeclined: "procurement.rfq.supplier_declined",
  RfqClosed: "procurement.rfq.closed",
  RfqAwarded: "procurement.rfq.awarded",
  RfqCancelled: "procurement.rfq.cancelled",

  QuoteSubmitted: "procurement.quote.submitted",
  QuoteRevised: "procurement.quote.revised",
  QuoteWithdrawn: "procurement.quote.withdrawn",
  QuoteShortlisted: "procurement.quote.shortlisted",
  QuoteRejected: "procurement.quote.rejected",
  QuoteAccepted: "procurement.quote.accepted",
  QuoteExpired: "procurement.quote.expired",

  PurchaseOrderCreated: "procurement.po.created",
  PurchaseOrderSubmitted: "procurement.po.submitted",
  PurchaseOrderApproved: "procurement.po.approved",
  PurchaseOrderRejected: "procurement.po.rejected",
  PurchaseOrderIssued: "procurement.po.issued",
  PurchaseOrderAcknowledged: "procurement.po.acknowledged",
  PurchaseOrderRevised: "procurement.po.revised",
  PurchaseOrderLineClosed: "procurement.po.line_closed",
  PurchaseOrderLineCancelled: "procurement.po.line_cancelled",
  PurchaseOrderPartiallyReceived: "procurement.po.partially_received",
  PurchaseOrderReceived: "procurement.po.received",
  PurchaseOrderClosed: "procurement.po.closed",
  PurchaseOrderCancelled: "procurement.po.cancelled",

  ReceiptDrafted: "procurement.receipt.drafted",
  ReceiptPosted: "procurement.receipt.posted",
  ReceiptInspected: "procurement.receipt.inspected",
  ReceiptReversed: "procurement.receipt.reversed",
  ReceiptReturnedToVendor: "procurement.receipt.returned_to_vendor",

  InvoiceRegistered: "procurement.invoice.registered",
  InvoiceMatched: "procurement.invoice.matched",
  InvoiceMatchExceptionRaised: "procurement.invoice.match_exception_raised",
  InvoiceExceptionResolved: "procurement.invoice.exception_resolved",
  InvoiceApprovedForPayment: "procurement.invoice.approved_for_payment",
  InvoiceHeld: "procurement.invoice.held",
  InvoiceCancelled: "procurement.invoice.cancelled",

  AgreementCreated: "procurement.agreement.created",
  AgreementActivated: "procurement.agreement.activated",
  AgreementPriceTierAdded: "procurement.agreement.price_tier_added",
  AgreementReleased: "procurement.agreement.released",
  AgreementReleaseReturned: "procurement.agreement.release_returned",
  AgreementCommitmentReached: "procurement.agreement.commitment_reached",
  AgreementSuspended: "procurement.agreement.suspended",
  AgreementResumed: "procurement.agreement.resumed",
  AgreementExpired: "procurement.agreement.expired",
  AgreementClosed: "procurement.agreement.closed",
} as const;

export type ProcurementEventType = (typeof ProcurementEvents)[keyof typeof ProcurementEvents];

// ---------------------------------------------------------------------------
// Payload contracts for integration-relevant events. Downstream contexts
// (finance AP, inventory, supply chain, reporting) code against these shapes.
// ---------------------------------------------------------------------------

export interface RequisitionApprovedPayload {
  requisitionId: Ulid;
  requisitionNumber: string;
  requesterId: Ulid;
  costCenter: string;
  estimatedTotal: Money;
  neededBy: IsoDate;
  lineCount: number;
}

export interface ApprovalCompletedPayload {
  approvalRequestId: Ulid;
  documentType: DocumentType;
  documentId: Ulid;
  documentNumber: string;
  outcome: "approved" | "rejected";
  amount: Money;
  policyCode: string;
  decidedBy: readonly Ulid[];
  reason?: string;
}

export interface RfqAwardedPayload {
  rfqId: Ulid;
  rfqNumber: string;
  awards: ReadonlyArray<{
    quoteId: Ulid;
    supplierId: Ulid;
    lineNumbers: readonly number[];
    awardedValue: Money;
  }>;
  estimatedSavings?: Money;
}

export interface PurchaseOrderIssuedPayload {
  purchaseOrderId: Ulid;
  orderNumber: string;
  revision: number;
  supplierId: Ulid;
  buyerId: Ulid;
  currency: string;
  orderTotal: Money;
  incoterm: string;
  paymentTermsDays: number;
  shipTo: string;
  lines: ReadonlyArray<{
    lineNumber: number;
    itemCode?: string;
    description: string;
    quantity: Quantity;
    uom: UomCode;
    unitPrice: Money;
    needBy: IsoDate;
  }>;
}

export interface ReceiptPostedPayload {
  receiptId: Ulid;
  receiptNumber: string;
  purchaseOrderId: Ulid;
  orderNumber: string;
  supplierId: Ulid;
  receiptDate: IsoDate;
  lines: ReadonlyArray<{
    purchaseOrderLineNumber: number;
    itemCode?: string;
    receivedQuantity: Quantity;
    acceptedQuantity: Quantity;
    rejectedQuantity: Quantity;
    uom: UomCode;
    storageLocation?: string;
    lotNumber?: string;
  }>;
}

export interface InvoiceMatchPayload {
  invoiceId: Ulid;
  invoiceNumber: string;
  supplierId: Ulid;
  purchaseOrderId?: Ulid;
  status: "matched" | "exception";
  invoiceTotal: Money;
  exceptionCodes: readonly string[];
}

/**
 * Hand-off to finance AP. `stub: true` marks that this context stops at
 * "approved for payment" — posting, payment runs and remittance live in
 * finance-erp.
 */
export interface InvoiceApprovedForPaymentPayload {
  invoiceId: Ulid;
  invoiceNumber: string;
  supplierId: Ulid;
  purchaseOrderId?: Ulid;
  amount: Money;
  dueDate: IsoDate;
  approvedBy: Ulid;
  stub: true;
}

export interface AgreementReleasedPayload {
  agreementId: Ulid;
  agreementNumber: string;
  supplierId: Ulid;
  purchaseOrderId: Ulid;
  releaseValue: Money;
  releasedToDate: Money;
  remainingValue: Money;
}
