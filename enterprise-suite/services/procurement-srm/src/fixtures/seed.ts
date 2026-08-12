import { brand, money, tenantId, type TenantId, type Ulid } from "@enterprise-suite/shared-kernel";
import { lineInput } from "../application/requisition-service.js";
import type { BlanketAgreement } from "../domain/blanket-agreement.js";
import { addDays, quantity } from "../domain/common.js";
import type { PurchaseOrder } from "../domain/purchase-order.js";
import type { PurchaseRequisition } from "../domain/requisition.js";
import type { RequestForQuote } from "../domain/rfq.js";
import type { SupplierRecord } from "../domain/supplier.js";
import type { ProcurementModule } from "../module.js";

export interface SeedResult {
  tenant: TenantId;
  currency: string;
  buyerId: Ulid;
  requesterId: Ulid;
  managerId: Ulid;
  financeId: Ulid;
  suppliers: {
    nordicSteel: SupplierRecord;
    apexFasteners: SupplierRecord;
    officeDirect: SupplierRecord;
  };
  /** Small enough to auto-approve under the default policy. */
  stationeryRequisition: PurchaseRequisition;
  /** Large enough to need manager + finance sign-off. */
  steelRequisition: PurchaseRequisition;
  steelRfq: RequestForQuote;
  stationeryOrder: PurchaseOrder;
  fastenerAgreement: BlanketAgreement;
}

function id(value: string): Ulid {
  return brand<string, "Ulid">(value);
}

/**
 * Seeds a small but realistic procurement tenant: three suppliers, the default
 * approval matrices for requisitions and orders, two requisitions either side
 * of the auto-approval band, an issued RFQ for the larger one, a contract with
 * volume tiers, and one issued purchase order ready to receive against.
 *
 * Used by the tests and `npm run dev`; safe to call once per tenant.
 */
export function seedDemoTenant(module: ProcurementModule, tenant = "acme"): SeedResult {
  const t = tenantId(tenant);
  const currency = "USD";
  const {
    supplierDirectory,
    approvalService,
    requisitionService,
    purchaseOrderService,
    sourcingService,
    agreementService,
  } = module;

  const buyerId = id("user_buyer");
  const requesterId = id("user_requester");
  const managerId = id("user_manager");
  const financeId = id("user_finance");
  const today = module.clock.today();

  // -- suppliers --------------------------------------------------------------

  const nordicSteel = supplierDirectory.register(t, {
    supplierNumber: "SUP-1001",
    legalName: "Nordic Steel Works AB",
    displayName: "Nordic Steel",
    currency,
    status: "active",
    paymentTermsDays: 30,
    defaultIncoterm: "DAP",
    categories: ["RAW.STEEL", "RAW.ALLOY"],
    riskTier: "medium",
    qualityScoreBps: 9_200,
    defaultLeadTimeDays: 21,
    contactEmail: "sales@nordicsteel.example",
  });

  const apexFasteners = supplierDirectory.register(t, {
    supplierNumber: "SUP-1002",
    legalName: "Apex Fasteners Ltd",
    displayName: "Apex Fasteners",
    currency,
    status: "active",
    paymentTermsDays: 45,
    defaultIncoterm: "FCA",
    categories: ["RAW.STEEL", "MRO.HARDWARE"],
    riskTier: "low",
    qualityScoreBps: 9_650,
    defaultLeadTimeDays: 14,
    minimumOrderValue: money(25_000, currency),
    contactEmail: "orders@apexfasteners.example",
  });

  const officeDirect = supplierDirectory.register(t, {
    supplierNumber: "SUP-1003",
    legalName: "Office Direct Supplies Inc",
    displayName: "Office Direct",
    currency,
    status: "active",
    paymentTermsDays: 14,
    categories: ["IND.OFFICE"],
    riskTier: "low",
    qualityScoreBps: 8_800,
    defaultLeadTimeDays: 3,
  });

  // -- approval matrices ------------------------------------------------------

  approvalService.createDefaultPolicy(t, "requisition", currency);
  approvalService.createDefaultPolicy(t, "purchase_order", currency);

  // -- routine demand: auto-approved, ordered straight from catalogue ---------

  const stationeryRequisition = requisitionService.create(t, {
    title: "Q1 stationery top-up",
    requesterId,
    costCenter: "CC-900",
    currency,
    neededBy: addDays(today, 14),
    deliverTo: "HQ mailroom",
    priority: "routine",
    justification: "Standing office consumables",
    lines: [
      lineInput({
        description: "A4 copier paper, 80gsm, box of 5 reams",
        categoryCode: "IND.OFFICE",
        quantity: 20,
        uom: "BOX",
        unitPriceMinor: 1_850,
        currency,
        itemCode: "PAPER-A4-80",
      }),
      lineInput({
        description: "Whiteboard markers, assorted, pack of 12",
        categoryCode: "IND.OFFICE",
        quantity: 10,
        uom: "PACK",
        unitPriceMinor: 990,
        currency,
        itemCode: "MARKER-WB-12",
      }),
    ],
  });
  requisitionService.submit(t, stationeryRequisition.id);

  const stationeryOrder = purchaseOrderService.createFromRequisition(t, {
    requisitionId: stationeryRequisition.id,
    supplierId: officeDirect.id,
    buyerId,
    lineSelections: stationeryRequisition.lines.map((line) => ({ lineId: line.id })),
  });
  purchaseOrderService.submitForApproval(t, stationeryOrder.id);
  purchaseOrderService.issue(t, stationeryOrder.id);

  // -- capital demand: needs a chain, goes out to tender ----------------------

  const steelRequisition = requisitionService.create(t, {
    title: "Structural steel for line 3 rebuild",
    requesterId,
    costCenter: "CC-200",
    currency,
    neededBy: addDays(today, 60),
    deliverTo: "Plant 2, dock B",
    priority: "urgent",
    justification: "Capacity expansion approved in the FY plan",
    budgetCode: "CAPEX-2026-11",
    lines: [
      lineInput({
        description: "S355 steel plate, 12mm",
        categoryCode: "RAW.STEEL",
        quantity: 40,
        uom: "TONNE",
        unitPriceMinor: 82_000,
        currency,
        itemCode: "PLATE-S355-12",
      }),
      lineInput({
        description: "S355 steel beam, IPE300",
        categoryCode: "RAW.STEEL",
        quantity: 25,
        uom: "TONNE",
        unitPriceMinor: 91_500,
        currency,
        itemCode: "BEAM-IPE300",
      }),
    ],
  });
  requisitionService.submit(t, steelRequisition.id);
  approveChain(module, t, steelRequisition.id, [
    { approverId: managerId, roles: ["manager"] },
    { approverId: financeId, roles: ["finance"] },
  ]);

  const steelRfq = sourcingService.createRfqFromRequisition(t, {
    requisitionId: steelRequisition.id,
    buyerId,
    responseDeadline: addDays(today, 10),
    sealed: true,
  });
  sourcingService.inviteSupplier(t, steelRfq.id, nordicSteel.id);
  sourcingService.inviteSupplier(t, steelRfq.id, apexFasteners.id);
  sourcingService.issueRfq(t, steelRfq.id);

  // -- contract with volume tiers --------------------------------------------

  const fastenerAgreement = agreementService.create(t, {
    title: "Fasteners framework 2026",
    supplierId: apexFasteners.id,
    ownerId: buyerId,
    effectiveFrom: today,
    effectiveTo: addDays(today, 365),
    maximumValue: money(5_000_000, currency),
    minimumCommitment: money(1_000_000, currency),
    releaseLimit: money(500_000, currency),
    autoReleaseApproved: true,
    renewalNoticeDays: 60,
    lines: [
      {
        description: "Hex bolt M12x60, zinc plated",
        categoryCode: "MRO.HARDWARE",
        uom: "EA",
        unitPrice: money(120, currency),
        itemCode: "BOLT-M12-60",
        contractedQuantity: 20_000,
        maximumQuantity: 50_000,
        leadTimeDays: 10,
        priceTiers: [
          { minQuantity: quantity(1_000), unitPrice: money(110, currency) },
          { minQuantity: quantity(5_000), unitPrice: money(98, currency) },
        ],
      },
      {
        description: "Hex nut M12, zinc plated",
        categoryCode: "MRO.HARDWARE",
        uom: "EA",
        unitPrice: money(35, currency),
        itemCode: "NUT-M12",
        contractedQuantity: 20_000,
        leadTimeDays: 10,
      },
    ],
  });
  agreementService.activate(t, fastenerAgreement.id);

  return {
    tenant: t,
    currency,
    buyerId,
    requesterId,
    managerId,
    financeId,
    suppliers: { nordicSteel, apexFasteners, officeDirect },
    stationeryRequisition,
    steelRequisition,
    steelRfq,
    stationeryOrder,
    fastenerAgreement,
  };
}

/** Walks the pending chain for a document, approving each step in turn. */
function approveChain(
  module: ProcurementModule,
  tenant: TenantId,
  documentId: Ulid,
  approvers: ReadonlyArray<{ approverId: Ulid; roles: readonly string[] }>,
): void {
  for (const approver of approvers) {
    const request = module.approvalService.pendingForDocument(tenant, documentId);
    if (!request) return;
    module.approvalService.approve(tenant, request.id, approver);
  }
}
