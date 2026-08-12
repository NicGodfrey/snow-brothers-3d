import { AgreementService } from "./application/agreement-service.js";
import { ApprovalService } from "./application/approval-service.js";
import { MatchingService } from "./application/matching-service.js";
import { PurchaseOrderService } from "./application/purchase-order-service.js";
import { ReceiptService } from "./application/receipt-service.js";
import { RequisitionService } from "./application/requisition-service.js";
import { SourcingService } from "./application/sourcing-service.js";
import { SpendAnalyticsService } from "./application/spend-service.js";
import { SupplierDirectoryService } from "./application/supplier-directory-service.js";
import type {
  Clock,
  DocumentNumberGenerator,
  ProcurementRepositories,
} from "./application/ports.js";
import type { MatchTolerances } from "./domain/three-way-match.js";
import {
  createInMemoryRepositories,
  InMemoryDocumentNumbers,
  InMemoryOutbox,
  SystemClock,
} from "./infrastructure/in-memory.js";

export interface ProcurementModule {
  repos: ProcurementRepositories;
  outbox: InMemoryOutbox;
  clock: Clock;
  numbers: DocumentNumberGenerator;
  supplierDirectory: SupplierDirectoryService;
  approvalService: ApprovalService;
  requisitionService: RequisitionService;
  purchaseOrderService: PurchaseOrderService;
  sourcingService: SourcingService;
  receiptService: ReceiptService;
  matchingService: MatchingService;
  agreementService: AgreementService;
  analyticsService: SpendAnalyticsService;
  /** Detaches every cross-service subscription created by this module. */
  dispose(): void;
}

/**
 * Composition root. In-memory adapters by default; pass overrides to swap in
 * Postgres-backed repositories, a fixed clock or tighter match tolerances
 * without touching a service.
 *
 * The wiring here is what keeps the services acyclic: approvals notify
 * documents through handlers, and agreements learn about cancelled orders the
 * same way, so no service imports its caller.
 */
export function createProcurementModule(overrides?: {
  repos?: ProcurementRepositories;
  outbox?: InMemoryOutbox;
  clock?: Clock;
  numbers?: DocumentNumberGenerator;
  matchTolerances?: Partial<MatchTolerances>;
}): ProcurementModule {
  const repos = overrides?.repos ?? createInMemoryRepositories();
  const outbox = overrides?.outbox ?? new InMemoryOutbox();
  const clock = overrides?.clock ?? new SystemClock();
  const numbers = overrides?.numbers ?? new InMemoryDocumentNumbers();

  const supplierDirectory = new SupplierDirectoryService(repos.suppliers, outbox);
  const approvalService = new ApprovalService(
    repos.approvalPolicies,
    repos.approvalRequests,
    outbox,
    clock,
  );
  const requisitionService = new RequisitionService(
    repos.requisitions,
    repos.suppliers,
    approvalService,
    numbers,
    outbox,
    clock,
  );
  const purchaseOrderService = new PurchaseOrderService(
    repos.purchaseOrders,
    supplierDirectory,
    requisitionService,
    approvalService,
    numbers,
    outbox,
    clock,
  );
  const sourcingService = new SourcingService(
    repos.rfqs,
    repos.quotes,
    supplierDirectory,
    requisitionService,
    purchaseOrderService,
    numbers,
    outbox,
    clock,
  );
  const receiptService = new ReceiptService(
    repos.receipts,
    repos.purchaseOrders,
    purchaseOrderService,
    numbers,
    outbox,
    clock,
  );
  const matchingService = new MatchingService(
    repos.invoices,
    repos.purchaseOrders,
    repos.receipts,
    purchaseOrderService,
    numbers,
    outbox,
    clock,
    overrides?.matchTolerances,
  );
  const agreementService = new AgreementService(
    repos.agreements,
    supplierDirectory,
    purchaseOrderService,
    numbers,
    outbox,
    clock,
  );
  const analyticsService = new SpendAnalyticsService(
    repos.purchaseOrders,
    repos.requisitions,
    repos.receipts,
    repos.invoices,
    repos.agreements,
    repos.rfqs,
    repos.suppliers,
    clock,
    outbox,
  );

  const subscriptions = [
    requisitionService.registerApprovalHandler(),
    purchaseOrderService.registerApprovalHandler(),
    agreementService.registerOrderCancellationHandler(),
  ];

  return {
    repos,
    outbox,
    clock,
    numbers,
    supplierDirectory,
    approvalService,
    requisitionService,
    purchaseOrderService,
    sourcingService,
    receiptService,
    matchingService,
    agreementService,
    analyticsService,
    dispose: () => {
      for (const unsubscribe of subscriptions) unsubscribe();
    },
  };
}
