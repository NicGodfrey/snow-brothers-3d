/**
 * The standard mapping catalog: every upstream event this warehouse knows
 * how to project, and the fact it becomes.
 *
 * Event type names and payload fields here are the *published contracts* of
 * the other bounded contexts (sales-erp, finance-erp, inventory-wms,
 * marketing-erp, logistics-tms, manufacturing-mes, quality-qms). Payload
 * access goes through the tolerant readers in domain/ingest so that an
 * upstream context adding a field is a no-op, while an upstream context
 * removing one we depend on lands in the dead-letter queue with the exact
 * path that went missing.
 *
 * A few conventions hold throughout:
 *
 *  - Money is stored in integer minor units, in fields ending `_minor`.
 *  - Each event contributes counter measures (`orders_confirmed: 1`) so a
 *    plain `sum` gives the count and no metric needs to know which event
 *    type produced which row.
 *  - Event types that carry no measurable content are mapped to `null`
 *    rather than left unmapped, which keeps the dead-letter queue meaningful.
 */
import { brand } from "@enterprise-suite/shared-kernel";
import {
  arrayField,
  moneyMinor,
  numberOr,
  optionalBoolean,
  optionalNumber,
  optionalString,
  requiredNumber,
  requiredString,
  type FactDraft,
  type FactMapping,
  type SourceEvent,
} from "../domain/ingest.js";

export const ReportingCubes = {
  salesOrders: "sales_orders",
  salesPipeline: "sales_pipeline",
  marketingFunnel: "marketing_funnel",
  financeReceivables: "finance_receivables",
  inventoryMovements: "inventory_movements",
  logisticsShipments: "logistics_shipments",
  productionOutput: "production_output",
  qualityInspections: "quality_inspections",
} as const;

export type ReportingCube = (typeof ReportingCubes)[keyof typeof ReportingCubes];

/** Small helper so each mapping stays a one-expression declaration. */
function mapping(
  eventType: string,
  cube: string,
  version: number,
  description: string,
  map: (event: SourceEvent) => FactDraft | readonly FactDraft[] | null,
): FactMapping {
  return { eventType, cube, version, description, map: (event) => map(event) };
}

// ---------------------------------------------------------------------------
// Sales — order book
// ---------------------------------------------------------------------------

const salesOrderMappings: FactMapping[] = [
  mapping(
    "sales.order.confirmed",
    ReportingCubes.salesOrders,
    1,
    "Order booked: value enters the order book",
    (event) => {
      const payload = event.payload;
      return {
        cube: ReportingCubes.salesOrders,
        dimensions: {
          customer: requiredString(payload, "accountId"),
          credit_decision: optionalString(payload, "creditDecision") ?? "none",
          order_source: optionalString(payload, "quoteId") ? "quote" : "direct",
          order_reference: optionalString(payload, "orderNumber"),
        },
        measures: {
          orders_confirmed: 1,
          booked_amount_minor: numberOr(payload, "grandTotalMinor", 0),
        },
        currency: optionalString(payload, "currency"),
      };
    },
  ),
  mapping(
    "sales.order.cancelled",
    ReportingCubes.salesOrders,
    1,
    "Order cancelled: counted separately so booking stays gross",
    (event) => ({
      cube: ReportingCubes.salesOrders,
      dimensions: {
        customer: requiredString(event.payload, "accountId"),
        credit_decision: "none",
        order_source: "cancellation",
        order_reference: optionalString(event.payload, "orderNumber"),
        cancel_reason: optionalString(event.payload, "reason"),
      },
      measures: { orders_cancelled: 1 },
    }),
  ),
  mapping(
    "sales.order.shipped",
    ReportingCubes.salesOrders,
    1,
    "Shipment confirmation: line and unit counts for fulfilment metrics",
    (event) => {
      const lines = arrayField(event.payload, "shipments");
      const units = lines.reduce<number>((total, line) => total + numberOr(line, "qty", 0), 0);
      return {
        cube: ReportingCubes.salesOrders,
        dimensions: {
          customer: requiredString(event.payload, "accountId"),
          order_source: "fulfilment",
          order_reference: optionalString(event.payload, "orderNumber"),
        },
        measures: {
          orders_shipped: 1,
          orders_fully_shipped: optionalBoolean(event.payload, "fullyShipped") ? 1 : 0,
          shipped_lines: lines.length,
          shipped_units: units,
        },
      };
    },
  ),
  mapping(
    "sales.order.invoiced",
    ReportingCubes.salesOrders,
    1,
    "Order invoiced: closes the order-to-cash loop for cycle-time metrics",
    (event) => ({
      cube: ReportingCubes.salesOrders,
      dimensions: {
        customer: requiredString(event.payload, "accountId"),
        order_source: "invoicing",
        order_reference: optionalString(event.payload, "orderNumber"),
      },
      measures: { orders_invoiced: 1 },
    }),
  ),
];

// ---------------------------------------------------------------------------
// Sales — pipeline
// ---------------------------------------------------------------------------

const salesPipelineMappings: FactMapping[] = [
  mapping(
    "sales.opportunity.created",
    ReportingCubes.salesPipeline,
    1,
    "New opportunity entering the pipeline",
    (event) => ({
      cube: ReportingCubes.salesPipeline,
      dimensions: {
        stage: optionalString(event.payload, "stage") ?? "new",
        owner: optionalString(event.payload, "ownerId"),
        customer: optionalString(event.payload, "accountId"),
      },
      measures: {
        opportunities_created: 1,
        pipeline_amount_minor: numberOr(event.payload, "amountMinor", 0),
      },
      currency: optionalString(event.payload, "currency"),
    }),
  ),
  mapping(
    "sales.opportunity.stage-changed",
    ReportingCubes.salesPipeline,
    1,
    "Stage transition, weighted by the new probability",
    (event) => ({
      cube: ReportingCubes.salesPipeline,
      dimensions: {
        stage: requiredString(event.payload, "toStage"),
        previous_stage: optionalString(event.payload, "fromStage"),
      },
      measures: {
        stage_changes: 1,
        probability_points: numberOr(event.payload, "probability", 0),
      },
    }),
  ),
  mapping(
    "sales.opportunity.won",
    ReportingCubes.salesPipeline,
    1,
    "Closed won",
    (event) => ({
      cube: ReportingCubes.salesPipeline,
      dimensions: {
        stage: "won",
        owner: optionalString(event.payload, "ownerId"),
        customer: optionalString(event.payload, "accountId"),
      },
      measures: {
        opportunities_won: 1,
        won_amount_minor: numberOr(event.payload, "amountMinor", 0),
      },
      currency: optionalString(event.payload, "currency"),
    }),
  ),
  mapping(
    "sales.opportunity.lost",
    ReportingCubes.salesPipeline,
    1,
    "Closed lost, keyed by loss reason",
    (event) => ({
      cube: ReportingCubes.salesPipeline,
      dimensions: {
        stage: "lost",
        owner: optionalString(event.payload, "ownerId"),
        customer: optionalString(event.payload, "accountId"),
        loss_reason: optionalString(event.payload, "lostReason"),
      },
      measures: {
        opportunities_lost: 1,
        lost_amount_minor: numberOr(event.payload, "amountMinor", 0),
      },
      currency: optionalString(event.payload, "currency"),
    }),
  ),
];

// ---------------------------------------------------------------------------
// Marketing — funnel and spend
// ---------------------------------------------------------------------------

const marketingMappings: FactMapping[] = [
  mapping(
    "marketing.lead.captured.v1",
    ReportingCubes.marketingFunnel,
    1,
    "Lead captured, attributed to its UTM campaign when present",
    (event) => ({
      cube: ReportingCubes.marketingFunnel,
      dimensions: {
        campaign: optionalString(event.payload, "utm.campaign"),
        channel: optionalString(event.payload, "utm.medium"),
        lead_source: optionalString(event.payload, "source") ?? "direct",
      },
      measures: { leads_captured: 1 },
    }),
  ),
  mapping(
    "marketing.lead.converted.v1",
    ReportingCubes.marketingFunnel,
    1,
    "Lead converted into a sales opportunity",
    (event) => ({
      cube: ReportingCubes.marketingFunnel,
      dimensions: {
        campaign: optionalString(event.payload, "campaignId") ?? optionalString(event.payload, "sourceCampaignId"),
        lead_source: optionalString(event.payload, "source"),
      },
      measures: {
        leads_converted: 1,
        converted_value_minor: optionalNumber(event.payload, "estimatedValue.amountMinor") ?? 0,
      },
    }),
  ),
  mapping(
    "marketing.lead.disqualified.v1",
    ReportingCubes.marketingFunnel,
    1,
    "Lead disqualified — funnel leakage",
    (event) => ({
      cube: ReportingCubes.marketingFunnel,
      dimensions: {
        campaign: optionalString(event.payload, "campaignId"),
        lead_source: optionalString(event.payload, "source"),
        disqualify_reason: optionalString(event.payload, "reason"),
      },
      measures: { leads_disqualified: 1 },
    }),
  ),
  mapping(
    "marketing.send-job.completed.v1",
    ReportingCubes.marketingFunnel,
    1,
    "Bulk send outcome: delivery and engagement counters",
    (event) => ({
      cube: ReportingCubes.marketingFunnel,
      dimensions: {
        campaign: optionalString(event.payload, "campaignId"),
        channel: optionalString(event.payload, "channelKind"),
      },
      measures: {
        sends: numberOr(event.payload, "sent", 0),
        delivered: numberOr(event.payload, "delivered", 0),
        bounced: numberOr(event.payload, "bounced", 0),
        opened: numberOr(event.payload, "opened", 0),
        clicked: numberOr(event.payload, "clicked", 0),
        unsubscribed: numberOr(event.payload, "unsubscribed", 0),
      },
    }),
  ),
  mapping(
    "marketing.touchpoint.recorded.v1",
    ReportingCubes.marketingFunnel,
    1,
    "Individual touchpoint, for attribution paths",
    (event) => ({
      cube: ReportingCubes.marketingFunnel,
      dimensions: {
        campaign: optionalString(event.payload, "campaignId"),
        channel: optionalString(event.payload, "channelId"),
        touch_type: optionalString(event.payload, "touchType"),
      },
      measures: { touchpoints: 1 },
    }),
  ),
  mapping(
    "marketing.budget.spend-recorded.v1",
    ReportingCubes.marketingFunnel,
    1,
    "Campaign spend, the denominator of every efficiency metric",
    (event) => {
      const amount = moneyMinor(event.payload, "amount");
      return {
        cube: ReportingCubes.marketingFunnel,
        dimensions: {
          campaign: optionalString(event.payload, "campaignId"),
          channel: optionalString(event.payload, "channelId"),
          spend_category: optionalString(event.payload, "category"),
        },
        measures: { spend_minor: amount.minor },
        currency: amount.currency,
      };
    },
  ),
];

// ---------------------------------------------------------------------------
// Finance — receivables
// ---------------------------------------------------------------------------

const financeMappings: FactMapping[] = [
  mapping(
    "finance.ar.invoice-issued",
    ReportingCubes.financeReceivables,
    1,
    "AR invoice issued",
    (event) => ({
      cube: ReportingCubes.financeReceivables,
      dimensions: {
        customer: requiredString(event.payload, "customerId"),
        document: optionalString(event.payload, "invoiceNo"),
        movement: "invoiced",
      },
      measures: {
        invoices_issued: 1,
        invoiced_minor: requiredNumber(event.payload, "totalMinor"),
      },
      currency: optionalString(event.payload, "currency"),
    }),
  ),
  mapping(
    "finance.ar.invoice-paid",
    ReportingCubes.financeReceivables,
    1,
    "AR invoice fully settled",
    (event) => ({
      cube: ReportingCubes.financeReceivables,
      dimensions: {
        customer: optionalString(event.payload, "customerId"),
        document: optionalString(event.payload, "invoiceNo"),
        movement: "settled",
      },
      measures: {
        invoices_paid: 1,
        settled_minor: numberOr(event.payload, "totalMinor", 0),
      },
      currency: optionalString(event.payload, "currency"),
    }),
  ),
  mapping(
    "finance.ar.payment-received",
    ReportingCubes.financeReceivables,
    1,
    "Cash received against receivables",
    (event) => ({
      cube: ReportingCubes.financeReceivables,
      dimensions: {
        customer: optionalString(event.payload, "customerId"),
        document: optionalString(event.payload, "paymentNo"),
        movement: "cash",
        payment_method: optionalString(event.payload, "method"),
      },
      measures: {
        payments_received: 1,
        cash_received_minor: numberOr(event.payload, "amountMinor", 0),
      },
      currency: optionalString(event.payload, "currency"),
    }),
  ),
  mapping(
    "finance.ar.invoice-voided",
    ReportingCubes.financeReceivables,
    1,
    "Invoice voided: reverses the issued amount",
    (event) => ({
      cube: ReportingCubes.financeReceivables,
      dimensions: {
        customer: optionalString(event.payload, "customerId"),
        document: optionalString(event.payload, "invoiceNo"),
        movement: "voided",
      },
      measures: {
        invoices_voided: 1,
        invoiced_minor: -numberOr(event.payload, "totalMinor", 0),
      },
      currency: optionalString(event.payload, "currency"),
    }),
  ),
];

// ---------------------------------------------------------------------------
// Inventory — movements
// ---------------------------------------------------------------------------

function stockMovement(
  eventType: string,
  measureField: string,
  description: string,
  sign: 1 | -1 = 1,
): FactMapping {
  return mapping(eventType, ReportingCubes.inventoryMovements, 1, description, (event) => ({
    cube: ReportingCubes.inventoryMovements,
    dimensions: {
      warehouse: requiredString(event.payload, "warehouseId"),
      product: requiredString(event.payload, "sku"),
      lot: optionalString(event.payload, "lotId"),
      reason_code: optionalString(event.payload, "reasonCode"),
      reference_type: optionalString(event.payload, "refType"),
    },
    measures: {
      movements: 1,
      [measureField]: sign * numberOr(event.payload, "quantity", 0),
    },
  }));
}

const inventoryMappings: FactMapping[] = [
  stockMovement("inventory.stock.received", "received_qty", "Goods receipt into stock"),
  stockMovement("inventory.stock.issued", "issued_qty", "Issue out of stock"),
  stockMovement("inventory.stock.transferred", "transferred_qty", "Bin-to-bin transfer"),
  stockMovement("inventory.stock.adjusted", "adjusted_qty", "Manual adjustment"),
  mapping(
    "inventory.cycle-count.completed",
    ReportingCubes.inventoryMovements,
    1,
    "One fact per counted line, so count accuracy can be measured per SKU",
    (event) => {
      const warehouse = requiredString(event.payload, "warehouseId");
      const variances = arrayField(event.payload, "variances");
      if (variances.length === 0) {
        return {
          cube: ReportingCubes.inventoryMovements,
          dimensions: { warehouse, product: undefined, reason_code: "cycle-count" },
          measures: {
            counted_lines: numberOr(event.payload, "countedLines", 0),
            variance_lines: 0,
            variance_qty: 0,
          },
        };
      }
      return variances.map((line) => ({
        cube: ReportingCubes.inventoryMovements,
        dimensions: {
          warehouse,
          product: optionalString(line, "sku"),
          lot: optionalString(line, "lotId"),
          reason_code: "cycle-count",
        },
        measures: {
          counted_lines: 1,
          variance_lines: numberOr(line, "varianceQty", 0) === 0 ? 0 : 1,
          variance_qty: numberOr(line, "varianceQty", 0),
          counted_qty: numberOr(line, "countedQty", 0),
          expected_qty: numberOr(line, "expectedQty", 0),
        },
      }));
    },
  ),
];

// ---------------------------------------------------------------------------
// Logistics — shipments
// ---------------------------------------------------------------------------

const logisticsMappings: FactMapping[] = [
  mapping(
    "logistics.shipment.booked",
    ReportingCubes.logisticsShipments,
    1,
    "Shipment booked with a carrier at a rated cost",
    (event) => ({
      cube: ReportingCubes.logisticsShipments,
      dimensions: {
        carrier: optionalString(event.payload, "carrierCode") ?? requiredString(event.payload, "carrierId"),
        service_level: optionalString(event.payload, "serviceLevelCode"),
        order_reference: optionalString(event.payload, "orderRef"),
      },
      measures: {
        shipments_booked: 1,
        freight_cost_minor: numberOr(event.payload, "totalMinor", 0),
      },
      currency: optionalString(event.payload, "currency"),
    }),
  ),
  mapping(
    "logistics.shipment.delivered",
    ReportingCubes.logisticsShipments,
    1,
    "Delivery confirmation, stamped at the delivery instant",
    (event) => {
      // Delivery is stamped when it happened, not when the event was
      // published, so a late-arriving confirmation lands in the right day.
      const deliveredAt = optionalString(event.payload, "deliveredAt");
      const parsed = deliveredAt ? new Date(deliveredAt) : undefined;
      return {
        cube: ReportingCubes.logisticsShipments,
        dimensions: {
          carrier: optionalString(event.payload, "carrierCode"),
          order_reference: optionalString(event.payload, "orderRef"),
        },
        measures: { shipments_delivered: 1 },
        occurredAt:
          parsed && !Number.isNaN(parsed.getTime())
            ? brand<string, "IsoDateTime">(parsed.toISOString())
            : undefined,
      };
    },
  ),
  mapping(
    "logistics.shipment.exception",
    ReportingCubes.logisticsShipments,
    1,
    "In-transit exception, keyed by the carrier status code",
    (event) => ({
      cube: ReportingCubes.logisticsShipments,
      dimensions: {
        carrier: optionalString(event.payload, "carrierCode"),
        exception_code: optionalString(event.payload, "code") ?? optionalString(event.payload, "status"),
      },
      measures: { shipment_exceptions: 1 },
    }),
  ),
  mapping(
    "logistics.pod.captured",
    ReportingCubes.logisticsShipments,
    1,
    "Proof of delivery, including any noted exceptions",
    (event) => ({
      cube: ReportingCubes.logisticsShipments,
      dimensions: {
        carrier: optionalString(event.payload, "carrierCode"),
        pod_method: optionalString(event.payload, "method"),
      },
      measures: {
        pods_captured: 1,
        pod_exceptions: numberOr(event.payload, "exceptionCount", 0),
      },
    }),
  ),
];

// ---------------------------------------------------------------------------
// Manufacturing — output and scrap
// ---------------------------------------------------------------------------

const manufacturingMappings: FactMapping[] = [
  mapping(
    "mes.work-order.operation-reported",
    ReportingCubes.productionOutput,
    1,
    "Operation confirmation: good/scrap quantities and machine + labour time",
    (event) => ({
      cube: ReportingCubes.productionOutput,
      dimensions: {
        work_center: requiredString(event.payload, "workCenterId"),
        work_order: optionalString(event.payload, "workOrderId"),
        operation_status: optionalString(event.payload, "operationStatus"),
      },
      measures: {
        operations_reported: 1,
        good_qty: numberOr(event.payload, "qtyGood", 0),
        scrap_qty: numberOr(event.payload, "qtyScrapped", 0),
        labor_minutes: numberOr(event.payload, "laborMinutes", 0),
        machine_minutes: numberOr(event.payload, "machineMinutes", 0),
      },
    }),
  ),
  mapping(
    "mes.production-receipt.posted",
    ReportingCubes.productionOutput,
    1,
    "Finished goods posted to stock",
    (event) => ({
      cube: ReportingCubes.productionOutput,
      dimensions: {
        product: requiredString(event.payload, "sku"),
        work_order: optionalString(event.payload, "workOrderId"),
        warehouse: optionalString(event.payload, "warehouseCode"),
      },
      measures: {
        receipts_posted: 1,
        received_qty: numberOr(event.payload, "qtyGood", 0),
      },
    }),
  ),
  mapping(
    "mes.scrap.recorded",
    ReportingCubes.productionOutput,
    1,
    "Scrap with its reason code — the numerator of scrap rate",
    (event) => ({
      cube: ReportingCubes.productionOutput,
      dimensions: {
        product: optionalString(event.payload, "sku"),
        work_order: optionalString(event.payload, "workOrderId"),
        reason_code: optionalString(event.payload, "reasonCode"),
      },
      measures: {
        scrap_records: 1,
        scrap_qty: numberOr(event.payload, "qty", 0),
      },
    }),
  ),
  mapping(
    "mes.work-order.completed",
    ReportingCubes.productionOutput,
    1,
    "Work order completed",
    (event) => ({
      cube: ReportingCubes.productionOutput,
      dimensions: {
        product: optionalString(event.payload, "sku"),
        work_order: optionalString(event.payload, "workOrderId"),
      },
      measures: { work_orders_completed: 1 },
    }),
  ),
];

// ---------------------------------------------------------------------------
// Quality — inspections, NCRs, supplier demerits
// ---------------------------------------------------------------------------

const qualityMappings: FactMapping[] = [
  mapping(
    "quality.inspection-lot.usage-decided",
    ReportingCubes.qualityInspections,
    1,
    "Usage decision on an inspection lot: accepted vs rejected quantity",
    (event) => ({
      cube: ReportingCubes.qualityInspections,
      dimensions: {
        supplier: optionalString(event.payload, "supplierId"),
        material: optionalString(event.payload, "materialCode"),
        decision: optionalString(event.payload, "decision"),
        origin: optionalString(event.payload, "origin"),
      },
      measures: {
        lots_decided: 1,
        accepted_qty: numberOr(event.payload, "acceptedQuantity", 0),
        rejected_qty: numberOr(event.payload, "rejectedQuantity", 0),
        failed_characteristics: arrayField(event.payload, "failedCharacteristicCodes").length,
      },
    }),
  ),
  mapping(
    "quality.ncr.opened",
    ReportingCubes.qualityInspections,
    1,
    "Non-conformance opened, by severity",
    (event) => ({
      cube: ReportingCubes.qualityInspections,
      dimensions: {
        supplier: optionalString(event.payload, "supplierId"),
        severity: optionalString(event.payload, "severity"),
        ncr_source: optionalString(event.payload, "source"),
      },
      measures: {
        ncrs_opened: 1,
        affected_qty: numberOr(event.payload, "quantityAffected", 0),
      },
    }),
  ),
  mapping(
    "quality.ncr.closed",
    ReportingCubes.qualityInspections,
    1,
    "Non-conformance closed",
    (event) => ({
      cube: ReportingCubes.qualityInspections,
      dimensions: { supplier: optionalString(event.payload, "supplierId") },
      measures: { ncrs_closed: 1 },
    }),
  ),
  mapping(
    "quality.supplier-event.recorded",
    ReportingCubes.qualityInspections,
    1,
    "Supplier quality demerit points feeding the scorecard",
    (event) => ({
      cube: ReportingCubes.qualityInspections,
      dimensions: {
        supplier: requiredString(event.payload, "supplierId"),
        severity: optionalString(event.payload, "severity"),
        quality_event_type: optionalString(event.payload, "eventType"),
      },
      measures: {
        supplier_events: 1,
        demerit_points: numberOr(event.payload, "demeritPoints", 0),
      },
    }),
  ),
  mapping(
    "quality.capa.created",
    ReportingCubes.qualityInspections,
    1,
    "CAPA raised",
    (event) => ({
      cube: ReportingCubes.qualityInspections,
      dimensions: { capa_priority: optionalString(event.payload, "priority") },
      measures: {
        capas_opened: 1,
        risk_priority_number: numberOr(event.payload, "rpn", 0),
      },
    }),
  ),
];

/**
 * Recognised-but-ignored events. Keeping these explicit means the
 * dead-letter queue only ever contains genuine surprises.
 */
const ignoredMappings: FactMapping[] = [
  "sales.account.created",
  "sales.quote.created",
  "plm.product.created",
  "inventory.warehouse.created",
  "logistics.carrier.created",
  "finance.account.created",
  "hcm.employee.hired",
].map((eventType) =>
  mapping(eventType, "", 1, "Master-data event with no measurable content", () => null),
);

export function standardMappings(): FactMapping[] {
  return [
    ...salesOrderMappings,
    ...salesPipelineMappings,
    ...marketingMappings,
    ...financeMappings,
    ...inventoryMappings,
    ...logisticsMappings,
    ...manufacturingMappings,
    ...qualityMappings,
    ...ignoredMappings,
  ];
}

/** Event types each cube is fed by, for the cube catalog. */
export function sourceEventTypesByCube(): Map<string, string[]> {
  const byCube = new Map<string, string[]>();
  for (const map of standardMappings()) {
    if (!map.cube) continue;
    const existing = byCube.get(map.cube) ?? [];
    existing.push(map.eventType);
    byCube.set(map.cube, existing);
  }
  return byCube;
}
