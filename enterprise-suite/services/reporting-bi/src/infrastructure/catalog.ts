/**
 * The standard warehouse catalog: dimensions, cubes, metrics, KPIs and
 * dashboards that ship with the service.
 *
 * This is the semantic layer's default content. It is data, not code: a
 * tenant can add to it, override a metric, or start from an empty catalog
 * and define everything through the API. Keeping it in one place means the
 * cube schemas here and the mappings in `application/mappings.ts` can be
 * read side by side — every measure field below is written by some mapping,
 * and every dimension a mapping emits is declared below.
 */
import type { TenantContext } from "@enterprise-suite/shared-kernel";
import type { DefineCubeInput } from "../domain/cube.js";
import type { CreateDashboardInput, AddTileInput } from "../domain/dashboard.js";
import type { DefineDimensionInput } from "../domain/dimension.js";
import type { DefineKpiInput } from "../domain/kpi.js";
import type { DefineMetricInput } from "../domain/metric.js";
import { ReportingCubes, sourceEventTypesByCube } from "../application/mappings.js";
import type { ReportingBiModule } from "./module.js";

export interface DashboardSpec {
  readonly dashboard: CreateDashboardInput;
  readonly tiles: readonly AddTileInput[];
  readonly publish: boolean;
}

export interface CatalogSpec {
  readonly dimensions: readonly DefineDimensionInput[];
  readonly cubes: readonly DefineCubeInput[];
  readonly metrics: readonly DefineMetricInput[];
  readonly kpis: readonly DefineKpiInput[];
  readonly dashboards: readonly DashboardSpec[];
}

const flat = (key: string, label: string): DefineDimensionInput => ({
  key,
  label,
  type: "categorical",
});

// ---------------------------------------------------------------------------
// Dimensions
// ---------------------------------------------------------------------------

const dimensions: DefineDimensionInput[] = [
  {
    key: "product",
    label: "Product",
    type: "entity",
    description: "Item hierarchy shared by sales, inventory, production and quality",
    levels: [
      { key: "family", label: "Product family" },
      { key: "category", label: "Category" },
      { key: "sku", label: "SKU" },
    ],
  },
  {
    key: "customer",
    label: "Customer",
    type: "entity",
    description: "Selling hierarchy: segment rolls up account activity",
    levels: [
      { key: "segment", label: "Segment" },
      { key: "account", label: "Account" },
    ],
  },
  {
    key: "warehouse",
    label: "Warehouse",
    type: "geo",
    levels: [
      { key: "region", label: "Region" },
      { key: "site", label: "Site" },
    ],
  },
  {
    key: "work_center",
    label: "Work centre",
    type: "entity",
    levels: [
      { key: "plant", label: "Plant" },
      { key: "cell", label: "Work centre" },
    ],
  },
  {
    key: "campaign",
    label: "Campaign",
    type: "entity",
    levels: [
      { key: "program", label: "Programme" },
      { key: "campaign_code", label: "Campaign" },
    ],
  },
  flat("channel", "Channel"),
  flat("carrier", "Carrier"),
  flat("supplier", "Supplier"),
  flat("credit_decision", "Credit decision"),
  flat("order_source", "Order source"),
  flat("cancel_reason", "Cancellation reason"),
  flat("order_reference", "Order reference"),
  flat("stage", "Pipeline stage"),
  flat("previous_stage", "Previous stage"),
  flat("owner", "Owner"),
  flat("loss_reason", "Loss reason"),
  flat("lead_source", "Lead source"),
  flat("disqualify_reason", "Disqualification reason"),
  flat("touch_type", "Touch type"),
  flat("spend_category", "Spend category"),
  flat("document", "Document"),
  flat("movement", "Movement type"),
  flat("payment_method", "Payment method"),
  flat("lot", "Lot"),
  flat("reason_code", "Reason code"),
  flat("reference_type", "Reference type"),
  flat("service_level", "Service level"),
  flat("exception_code", "Exception code"),
  flat("pod_method", "POD method"),
  flat("operation_status", "Operation status"),
  flat("work_order", "Work order"),
  flat("decision", "Usage decision"),
  flat("origin", "Inspection origin"),
  flat("severity", "Severity"),
  flat("ncr_source", "NCR source"),
  flat("quality_event_type", "Supplier event type"),
  flat("capa_priority", "CAPA priority"),
];

// ---------------------------------------------------------------------------
// Cubes
// ---------------------------------------------------------------------------

const sourceEvents = sourceEventTypesByCube();

const cubes: DefineCubeInput[] = [
  {
    name: ReportingCubes.salesOrders,
    title: "Sales orders",
    description: "Order book: bookings, cancellations, fulfilment and invoicing",
    defaultGrain: "month",
    sourceEventTypes: sourceEvents.get(ReportingCubes.salesOrders),
    defaultMetrics: ["booked_revenue", "orders_booked", "average_order_value"],
    dimensions: [
      { factKey: "customer", required: true, label: "Customer" },
      { factKey: "credit_decision" },
      { factKey: "order_source" },
      { factKey: "cancel_reason" },
      { factKey: "order_reference" },
    ],
    measureFields: [
      { field: "orders_confirmed", label: "Orders confirmed" },
      { field: "booked_amount_minor", label: "Booked amount", isCurrency: true },
      { field: "orders_cancelled", label: "Orders cancelled" },
      { field: "orders_shipped", label: "Orders shipped" },
      { field: "orders_fully_shipped", label: "Orders fully shipped" },
      { field: "shipped_lines", label: "Shipped lines" },
      { field: "shipped_units", label: "Shipped units" },
      { field: "orders_invoiced", label: "Orders invoiced" },
    ],
  },
  {
    name: ReportingCubes.salesPipeline,
    title: "Sales pipeline",
    description: "Opportunity flow, win rate and deal size",
    defaultGrain: "month",
    sourceEventTypes: sourceEvents.get(ReportingCubes.salesPipeline),
    defaultMetrics: ["pipeline_value", "win_rate"],
    dimensions: [
      { factKey: "stage" },
      { factKey: "previous_stage" },
      { factKey: "owner" },
      { factKey: "customer" },
      { factKey: "loss_reason" },
    ],
    measureFields: [
      { field: "opportunities_created", label: "Opportunities created" },
      { field: "pipeline_amount_minor", label: "Pipeline amount", isCurrency: true },
      { field: "stage_changes", label: "Stage changes" },
      { field: "probability_points", label: "Probability points" },
      { field: "opportunities_won", label: "Opportunities won" },
      { field: "won_amount_minor", label: "Won amount", isCurrency: true },
      { field: "opportunities_lost", label: "Opportunities lost" },
      { field: "lost_amount_minor", label: "Lost amount", isCurrency: true },
    ],
  },
  {
    name: ReportingCubes.marketingFunnel,
    title: "Marketing funnel",
    description: "Lead capture, engagement and campaign spend efficiency",
    defaultGrain: "week",
    sourceEventTypes: sourceEvents.get(ReportingCubes.marketingFunnel),
    defaultMetrics: ["leads_captured", "cost_per_lead"],
    dimensions: [
      { factKey: "campaign" },
      { factKey: "channel" },
      { factKey: "lead_source" },
      { factKey: "disqualify_reason" },
      { factKey: "touch_type" },
      { factKey: "spend_category" },
    ],
    measureFields: [
      { field: "leads_captured", label: "Leads captured" },
      { field: "leads_converted", label: "Leads converted" },
      { field: "converted_value_minor", label: "Converted value", isCurrency: true },
      { field: "leads_disqualified", label: "Leads disqualified" },
      { field: "sends", label: "Sends" },
      { field: "delivered", label: "Delivered" },
      { field: "bounced", label: "Bounced" },
      { field: "opened", label: "Opened" },
      { field: "clicked", label: "Clicked" },
      { field: "unsubscribed", label: "Unsubscribed" },
      { field: "touchpoints", label: "Touchpoints" },
      { field: "spend_minor", label: "Spend", isCurrency: true },
    ],
  },
  {
    name: ReportingCubes.financeReceivables,
    title: "Accounts receivable",
    description: "Invoicing, settlement and cash collection",
    defaultGrain: "month",
    sourceEventTypes: sourceEvents.get(ReportingCubes.financeReceivables),
    defaultMetrics: ["invoiced_amount", "cash_collected", "collection_rate"],
    dimensions: [
      { factKey: "customer", required: false },
      { factKey: "document" },
      { factKey: "movement" },
      { factKey: "payment_method" },
    ],
    measureFields: [
      { field: "invoices_issued", label: "Invoices issued" },
      { field: "invoiced_minor", label: "Invoiced", isCurrency: true },
      { field: "invoices_paid", label: "Invoices paid" },
      { field: "settled_minor", label: "Settled", isCurrency: true },
      { field: "payments_received", label: "Payments received" },
      { field: "cash_received_minor", label: "Cash received", isCurrency: true },
      { field: "invoices_voided", label: "Invoices voided" },
    ],
  },
  {
    name: ReportingCubes.inventoryMovements,
    title: "Inventory movements",
    description: "Receipts, issues, transfers, adjustments and count accuracy",
    defaultGrain: "day",
    sourceEventTypes: sourceEvents.get(ReportingCubes.inventoryMovements),
    defaultMetrics: ["units_received", "units_issued"],
    dimensions: [
      { factKey: "warehouse", required: true },
      { factKey: "product" },
      { factKey: "lot" },
      { factKey: "reason_code" },
      { factKey: "reference_type" },
    ],
    measureFields: [
      { field: "movements", label: "Movements" },
      { field: "received_qty", label: "Received quantity" },
      { field: "issued_qty", label: "Issued quantity" },
      { field: "transferred_qty", label: "Transferred quantity" },
      { field: "adjusted_qty", label: "Adjusted quantity" },
      { field: "counted_lines", label: "Counted lines" },
      { field: "variance_lines", label: "Variance lines" },
      { field: "variance_qty", label: "Variance quantity" },
      { field: "counted_qty", label: "Counted quantity" },
      { field: "expected_qty", label: "Expected quantity" },
    ],
  },
  {
    name: ReportingCubes.logisticsShipments,
    title: "Logistics shipments",
    description: "Carrier bookings, freight spend, delivery performance",
    defaultGrain: "week",
    sourceEventTypes: sourceEvents.get(ReportingCubes.logisticsShipments),
    defaultMetrics: ["shipments_booked", "freight_spend", "delivery_rate"],
    dimensions: [
      { factKey: "carrier" },
      { factKey: "service_level" },
      { factKey: "order_reference" },
      { factKey: "exception_code" },
      { factKey: "pod_method" },
    ],
    measureFields: [
      { field: "shipments_booked", label: "Shipments booked" },
      { field: "freight_cost_minor", label: "Freight cost", isCurrency: true },
      { field: "shipments_delivered", label: "Shipments delivered" },
      { field: "shipment_exceptions", label: "Exceptions" },
      { field: "pods_captured", label: "PODs captured" },
      { field: "pod_exceptions", label: "POD exceptions" },
    ],
  },
  {
    name: ReportingCubes.productionOutput,
    title: "Production output",
    description: "Operation confirmations, output, scrap and machine time",
    defaultGrain: "day",
    sourceEventTypes: sourceEvents.get(ReportingCubes.productionOutput),
    defaultMetrics: ["good_output", "scrap_rate"],
    dimensions: [
      { factKey: "work_center" },
      { factKey: "work_order" },
      { factKey: "operation_status" },
      { factKey: "product" },
      { factKey: "reason_code" },
      { factKey: "warehouse" },
    ],
    measureFields: [
      { field: "operations_reported", label: "Operations reported" },
      { field: "good_qty", label: "Good quantity" },
      { field: "scrap_qty", label: "Scrap quantity" },
      { field: "labor_minutes", label: "Labour minutes" },
      { field: "machine_minutes", label: "Machine minutes" },
      { field: "receipts_posted", label: "Receipts posted" },
      { field: "received_qty", label: "Received quantity" },
      { field: "scrap_records", label: "Scrap records" },
      { field: "work_orders_completed", label: "Work orders completed" },
    ],
  },
  {
    name: ReportingCubes.qualityInspections,
    title: "Quality",
    description: "Inspection decisions, non-conformances and supplier demerits",
    defaultGrain: "month",
    sourceEventTypes: sourceEvents.get(ReportingCubes.qualityInspections),
    defaultMetrics: ["lot_reject_rate", "ncrs_opened"],
    dimensions: [
      { factKey: "supplier" },
      // Material codes are SKUs, so they roll up through the product hierarchy.
      { factKey: "material", dimensionKey: "product", label: "Material" },
      { factKey: "decision" },
      { factKey: "origin" },
      { factKey: "severity" },
      { factKey: "ncr_source" },
      { factKey: "quality_event_type" },
      { factKey: "capa_priority" },
    ],
    measureFields: [
      { field: "lots_decided", label: "Lots decided" },
      { field: "accepted_qty", label: "Accepted quantity" },
      { field: "rejected_qty", label: "Rejected quantity" },
      { field: "failed_characteristics", label: "Failed characteristics" },
      { field: "ncrs_opened", label: "NCRs opened" },
      { field: "ncrs_closed", label: "NCRs closed" },
      { field: "affected_qty", label: "Affected quantity" },
      { field: "supplier_events", label: "Supplier events" },
      { field: "demerit_points", label: "Demerit points" },
      { field: "capas_opened", label: "CAPAs opened" },
      { field: "risk_priority_number", label: "Risk priority number" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

const metrics: DefineMetricInput[] = [
  // --- sales orders -------------------------------------------------------
  {
    code: "orders_booked",
    name: "Orders booked",
    cube: ReportingCubes.salesOrders,
    unit: "count",
    aggregation: "sum",
    sourceField: "orders_confirmed",
    tags: ["sales", "volume"],
  },
  {
    code: "booked_revenue",
    name: "Booked revenue",
    cube: ReportingCubes.salesOrders,
    unit: "currency",
    aggregation: "sum",
    sourceField: "booked_amount_minor",
    tags: ["sales", "revenue"],
  },
  {
    code: "orders_cancelled_count",
    name: "Orders cancelled",
    cube: ReportingCubes.salesOrders,
    unit: "count",
    direction: "lower-is-better",
    aggregation: "sum",
    sourceField: "orders_cancelled",
    tags: ["sales"],
  },
  {
    code: "orders_shipped_count",
    name: "Orders shipped",
    cube: ReportingCubes.salesOrders,
    unit: "count",
    aggregation: "sum",
    sourceField: "orders_shipped",
    tags: ["fulfilment"],
  },
  {
    code: "units_shipped",
    name: "Units shipped",
    cube: ReportingCubes.salesOrders,
    unit: "quantity",
    aggregation: "sum",
    sourceField: "shipped_units",
    tags: ["fulfilment"],
  },
  {
    code: "ordering_customers",
    name: "Ordering customers",
    cube: ReportingCubes.salesOrders,
    unit: "count",
    aggregation: "count_distinct",
    sourceField: "customer",
    tags: ["sales"],
  },
  {
    code: "average_order_value",
    name: "Average order value",
    cube: ReportingCubes.salesOrders,
    unit: "currency",
    expression: "safe_div(booked_revenue, orders_booked)",
    description: "Booked revenue divided by booked orders, computed on aggregates",
    tags: ["sales", "revenue"],
  },
  {
    code: "cancellation_rate",
    name: "Cancellation rate",
    cube: ReportingCubes.salesOrders,
    unit: "percent",
    direction: "lower-is-better",
    expression: "safe_div(orders_cancelled_count, orders_booked) * 100",
    tags: ["sales", "quality"],
  },
  {
    code: "fulfilment_rate",
    name: "Fulfilment rate",
    cube: ReportingCubes.salesOrders,
    unit: "percent",
    expression: "safe_div(orders_shipped_count, orders_booked) * 100",
    tags: ["fulfilment"],
  },
  {
    code: "revenue_per_customer",
    name: "Revenue per customer",
    cube: ReportingCubes.salesOrders,
    unit: "currency",
    expression: "safe_div(booked_revenue, ordering_customers)",
    tags: ["sales", "revenue"],
  },

  // --- sales pipeline -----------------------------------------------------
  {
    code: "opportunities_created",
    name: "Opportunities created",
    cube: ReportingCubes.salesPipeline,
    unit: "count",
    aggregation: "sum",
    sourceField: "opportunities_created",
    tags: ["pipeline"],
  },
  {
    code: "pipeline_value",
    name: "Pipeline value",
    cube: ReportingCubes.salesPipeline,
    unit: "currency",
    aggregation: "sum",
    sourceField: "pipeline_amount_minor",
    tags: ["pipeline"],
  },
  {
    code: "opportunities_won",
    name: "Opportunities won",
    cube: ReportingCubes.salesPipeline,
    unit: "count",
    aggregation: "sum",
    sourceField: "opportunities_won",
    tags: ["pipeline"],
  },
  {
    code: "opportunities_lost",
    name: "Opportunities lost",
    cube: ReportingCubes.salesPipeline,
    unit: "count",
    direction: "lower-is-better",
    aggregation: "sum",
    sourceField: "opportunities_lost",
    tags: ["pipeline"],
  },
  {
    code: "won_value",
    name: "Won value",
    cube: ReportingCubes.salesPipeline,
    unit: "currency",
    aggregation: "sum",
    sourceField: "won_amount_minor",
    tags: ["pipeline"],
  },
  {
    code: "win_rate",
    name: "Win rate",
    cube: ReportingCubes.salesPipeline,
    unit: "percent",
    expression: "safe_div(opportunities_won, opportunities_won + opportunities_lost) * 100",
    description: "Won deals as a share of all closed deals",
    tags: ["pipeline"],
  },
  {
    code: "average_deal_size",
    name: "Average deal size",
    cube: ReportingCubes.salesPipeline,
    unit: "currency",
    expression: "safe_div(won_value, opportunities_won)",
    tags: ["pipeline"],
  },

  // --- marketing ----------------------------------------------------------
  {
    code: "leads_captured",
    name: "Leads captured",
    cube: ReportingCubes.marketingFunnel,
    unit: "count",
    aggregation: "sum",
    sourceField: "leads_captured",
    tags: ["marketing", "funnel"],
  },
  {
    code: "leads_converted",
    name: "Leads converted",
    cube: ReportingCubes.marketingFunnel,
    unit: "count",
    aggregation: "sum",
    sourceField: "leads_converted",
    tags: ["marketing", "funnel"],
  },
  {
    code: "marketing_spend",
    name: "Marketing spend",
    cube: ReportingCubes.marketingFunnel,
    unit: "currency",
    direction: "lower-is-better",
    aggregation: "sum",
    sourceField: "spend_minor",
    tags: ["marketing", "cost"],
  },
  {
    code: "emails_delivered",
    name: "Emails delivered",
    cube: ReportingCubes.marketingFunnel,
    unit: "count",
    aggregation: "sum",
    sourceField: "delivered",
    tags: ["marketing"],
  },
  {
    code: "emails_opened",
    name: "Emails opened",
    cube: ReportingCubes.marketingFunnel,
    unit: "count",
    aggregation: "sum",
    sourceField: "opened",
    tags: ["marketing"],
  },
  {
    code: "emails_clicked",
    name: "Emails clicked",
    cube: ReportingCubes.marketingFunnel,
    unit: "count",
    aggregation: "sum",
    sourceField: "clicked",
    tags: ["marketing"],
  },
  {
    code: "emails_bounced",
    name: "Emails bounced",
    cube: ReportingCubes.marketingFunnel,
    unit: "count",
    direction: "lower-is-better",
    aggregation: "sum",
    sourceField: "bounced",
    tags: ["marketing"],
  },
  {
    code: "converted_pipeline_value",
    name: "Converted pipeline value",
    cube: ReportingCubes.marketingFunnel,
    unit: "currency",
    aggregation: "sum",
    sourceField: "converted_value_minor",
    tags: ["marketing"],
  },
  {
    code: "cost_per_lead",
    name: "Cost per lead",
    cube: ReportingCubes.marketingFunnel,
    unit: "currency",
    direction: "lower-is-better",
    expression: "safe_div(marketing_spend, leads_captured)",
    tags: ["marketing", "efficiency"],
  },
  {
    code: "lead_conversion_rate",
    name: "Lead conversion rate",
    cube: ReportingCubes.marketingFunnel,
    unit: "percent",
    expression: "safe_div(leads_converted, leads_captured) * 100",
    tags: ["marketing", "funnel"],
  },
  {
    code: "open_rate",
    name: "Open rate",
    cube: ReportingCubes.marketingFunnel,
    unit: "percent",
    expression: "safe_div(emails_opened, emails_delivered) * 100",
    tags: ["marketing"],
  },
  {
    code: "click_through_rate",
    name: "Click-through rate",
    cube: ReportingCubes.marketingFunnel,
    unit: "percent",
    expression: "safe_div(emails_clicked, emails_delivered) * 100",
    tags: ["marketing"],
  },
  {
    code: "marketing_roi",
    name: "Marketing ROI",
    cube: ReportingCubes.marketingFunnel,
    unit: "percent",
    expression: "safe_div(converted_pipeline_value - marketing_spend, marketing_spend) * 100",
    description: "Return on campaign spend, derived from two other derived-free bases",
    tags: ["marketing", "efficiency"],
  },

  // --- receivables --------------------------------------------------------
  {
    code: "invoiced_amount",
    name: "Invoiced amount",
    cube: ReportingCubes.financeReceivables,
    unit: "currency",
    aggregation: "sum",
    sourceField: "invoiced_minor",
    tags: ["finance"],
  },
  {
    code: "invoice_count",
    name: "Invoice count",
    cube: ReportingCubes.financeReceivables,
    unit: "count",
    aggregation: "sum",
    sourceField: "invoices_issued",
    tags: ["finance"],
  },
  {
    code: "cash_collected",
    name: "Cash collected",
    cube: ReportingCubes.financeReceivables,
    unit: "currency",
    aggregation: "sum",
    sourceField: "cash_received_minor",
    tags: ["finance", "cash"],
  },
  {
    code: "collection_rate",
    name: "Collection rate",
    cube: ReportingCubes.financeReceivables,
    unit: "percent",
    expression: "safe_div(cash_collected, invoiced_amount) * 100",
    tags: ["finance", "cash"],
  },
  {
    code: "average_invoice_value",
    name: "Average invoice value",
    cube: ReportingCubes.financeReceivables,
    unit: "currency",
    expression: "safe_div(invoiced_amount, invoice_count)",
    tags: ["finance"],
  },
  {
    code: "open_receivables",
    name: "Open receivables",
    cube: ReportingCubes.financeReceivables,
    unit: "currency",
    direction: "lower-is-better",
    expression: "invoiced_amount - cash_collected",
    tags: ["finance", "cash"],
  },

  // --- inventory ----------------------------------------------------------
  {
    code: "units_received",
    name: "Units received",
    cube: ReportingCubes.inventoryMovements,
    unit: "quantity",
    aggregation: "sum",
    sourceField: "received_qty",
    tags: ["inventory"],
  },
  {
    code: "units_issued",
    name: "Units issued",
    cube: ReportingCubes.inventoryMovements,
    unit: "quantity",
    aggregation: "sum",
    sourceField: "issued_qty",
    tags: ["inventory"],
  },
  {
    code: "movement_count",
    name: "Movements",
    cube: ReportingCubes.inventoryMovements,
    unit: "count",
    aggregation: "sum",
    sourceField: "movements",
    tags: ["inventory"],
  },
  {
    code: "counted_line_count",
    name: "Counted lines",
    cube: ReportingCubes.inventoryMovements,
    unit: "count",
    aggregation: "sum",
    sourceField: "counted_lines",
    tags: ["inventory", "accuracy"],
  },
  {
    code: "variance_line_count",
    name: "Variance lines",
    cube: ReportingCubes.inventoryMovements,
    unit: "count",
    direction: "lower-is-better",
    aggregation: "sum",
    sourceField: "variance_lines",
    tags: ["inventory", "accuracy"],
  },
  {
    code: "net_stock_movement",
    name: "Net stock movement",
    cube: ReportingCubes.inventoryMovements,
    unit: "quantity",
    direction: "neutral",
    expression: "units_received - units_issued",
    tags: ["inventory"],
  },
  {
    code: "count_accuracy",
    name: "Count accuracy",
    cube: ReportingCubes.inventoryMovements,
    unit: "percent",
    expression: "(1 - safe_div(variance_line_count, counted_line_count)) * 100",
    tags: ["inventory", "accuracy"],
  },

  // --- logistics ----------------------------------------------------------
  {
    code: "shipments_booked",
    name: "Shipments booked",
    cube: ReportingCubes.logisticsShipments,
    unit: "count",
    aggregation: "sum",
    sourceField: "shipments_booked",
    tags: ["logistics"],
  },
  {
    code: "shipments_delivered",
    name: "Shipments delivered",
    cube: ReportingCubes.logisticsShipments,
    unit: "count",
    aggregation: "sum",
    sourceField: "shipments_delivered",
    tags: ["logistics"],
  },
  {
    code: "freight_spend",
    name: "Freight spend",
    cube: ReportingCubes.logisticsShipments,
    unit: "currency",
    direction: "lower-is-better",
    aggregation: "sum",
    sourceField: "freight_cost_minor",
    tags: ["logistics", "cost"],
  },
  {
    code: "shipment_exception_count",
    name: "Shipment exceptions",
    cube: ReportingCubes.logisticsShipments,
    unit: "count",
    direction: "lower-is-better",
    aggregation: "sum",
    sourceField: "shipment_exceptions",
    tags: ["logistics"],
  },
  {
    code: "delivery_rate",
    name: "Delivery rate",
    cube: ReportingCubes.logisticsShipments,
    unit: "percent",
    expression: "safe_div(shipments_delivered, shipments_booked) * 100",
    tags: ["logistics", "service"],
  },
  {
    code: "exception_rate",
    name: "Exception rate",
    cube: ReportingCubes.logisticsShipments,
    unit: "percent",
    direction: "lower-is-better",
    expression: "safe_div(shipment_exception_count, shipments_booked) * 100",
    tags: ["logistics", "service"],
  },
  {
    code: "cost_per_shipment",
    name: "Cost per shipment",
    cube: ReportingCubes.logisticsShipments,
    unit: "currency",
    direction: "lower-is-better",
    expression: "safe_div(freight_spend, shipments_booked)",
    tags: ["logistics", "cost"],
  },

  // --- production ---------------------------------------------------------
  {
    code: "good_output",
    name: "Good output",
    cube: ReportingCubes.productionOutput,
    unit: "quantity",
    aggregation: "sum",
    sourceField: "good_qty",
    tags: ["production"],
  },
  {
    code: "scrap_output",
    name: "Scrap quantity",
    cube: ReportingCubes.productionOutput,
    unit: "quantity",
    direction: "lower-is-better",
    aggregation: "sum",
    sourceField: "scrap_qty",
    tags: ["production", "quality"],
  },
  {
    code: "labor_minutes_total",
    name: "Labour minutes",
    cube: ReportingCubes.productionOutput,
    unit: "count",
    aggregation: "sum",
    sourceField: "labor_minutes",
    tags: ["production"],
  },
  {
    code: "machine_minutes_total",
    name: "Machine minutes",
    cube: ReportingCubes.productionOutput,
    unit: "count",
    aggregation: "sum",
    sourceField: "machine_minutes",
    tags: ["production"],
  },
  {
    code: "work_orders_completed",
    name: "Work orders completed",
    cube: ReportingCubes.productionOutput,
    unit: "count",
    aggregation: "sum",
    sourceField: "work_orders_completed",
    tags: ["production"],
  },
  {
    code: "scrap_rate",
    name: "Scrap rate",
    cube: ReportingCubes.productionOutput,
    unit: "percent",
    direction: "lower-is-better",
    expression: "safe_div(scrap_output, good_output + scrap_output) * 100",
    tags: ["production", "quality"],
  },
  {
    code: "labor_hours",
    name: "Labour hours",
    cube: ReportingCubes.productionOutput,
    unit: "count",
    decimals: 1,
    expression: "labor_minutes_total / 60",
    tags: ["production"],
  },
  {
    code: "output_per_labor_hour",
    name: "Output per labour hour",
    cube: ReportingCubes.productionOutput,
    unit: "quantity",
    expression: "safe_div(good_output, labor_hours)",
    description: "Derived on a derived metric: exercises multi-level evaluation order",
    tags: ["production", "efficiency"],
  },

  // --- quality ------------------------------------------------------------
  {
    code: "lots_decided",
    name: "Lots decided",
    cube: ReportingCubes.qualityInspections,
    unit: "count",
    aggregation: "sum",
    sourceField: "lots_decided",
    tags: ["quality"],
  },
  {
    code: "accepted_quantity",
    name: "Accepted quantity",
    cube: ReportingCubes.qualityInspections,
    unit: "quantity",
    aggregation: "sum",
    sourceField: "accepted_qty",
    tags: ["quality"],
  },
  {
    code: "rejected_quantity",
    name: "Rejected quantity",
    cube: ReportingCubes.qualityInspections,
    unit: "quantity",
    direction: "lower-is-better",
    aggregation: "sum",
    sourceField: "rejected_qty",
    tags: ["quality"],
  },
  {
    code: "ncrs_opened",
    name: "NCRs opened",
    cube: ReportingCubes.qualityInspections,
    unit: "count",
    direction: "lower-is-better",
    aggregation: "sum",
    sourceField: "ncrs_opened",
    tags: ["quality"],
  },
  {
    code: "ncrs_closed",
    name: "NCRs closed",
    cube: ReportingCubes.qualityInspections,
    unit: "count",
    aggregation: "sum",
    sourceField: "ncrs_closed",
    tags: ["quality"],
  },
  {
    code: "supplier_demerits",
    name: "Supplier demerit points",
    cube: ReportingCubes.qualityInspections,
    unit: "count",
    direction: "lower-is-better",
    aggregation: "sum",
    sourceField: "demerit_points",
    tags: ["quality", "supplier"],
  },
  {
    code: "suppliers_flagged",
    name: "Suppliers with quality events",
    cube: ReportingCubes.qualityInspections,
    unit: "count",
    direction: "lower-is-better",
    aggregation: "count_distinct",
    sourceField: "supplier",
    tags: ["quality", "supplier"],
  },
  {
    code: "lot_reject_rate",
    name: "Lot reject rate",
    cube: ReportingCubes.qualityInspections,
    unit: "percent",
    direction: "lower-is-better",
    expression: "safe_div(rejected_quantity, accepted_quantity + rejected_quantity) * 100",
    tags: ["quality"],
  },
  {
    code: "ncr_closure_rate",
    name: "NCR closure rate",
    cube: ReportingCubes.qualityInspections,
    unit: "percent",
    expression: "safe_div(ncrs_closed, ncrs_opened) * 100",
    tags: ["quality"],
  },
];

// ---------------------------------------------------------------------------
// KPIs
// ---------------------------------------------------------------------------

const kpis: DefineKpiInput[] = [
  {
    code: "monthly_bookings",
    name: "Monthly bookings",
    cube: ReportingCubes.salesOrders,
    metricCode: "booked_revenue",
    unit: "currency",
    grain: "month",
    target: 250_000_00,
    owner: "vp-sales",
    description: "Booked order value per month against the sales plan",
  },
  {
    code: "order_cancellation_rate",
    name: "Order cancellation rate",
    cube: ReportingCubes.salesOrders,
    metricCode: "cancellation_rate",
    unit: "percent",
    direction: "lower-is-better",
    grain: "month",
    target: 3,
    thresholds: { warning: 0.9, critical: 0.75 },
    owner: "vp-sales",
  },
  {
    code: "pipeline_win_rate",
    name: "Pipeline win rate",
    cube: ReportingCubes.salesPipeline,
    metricCode: "win_rate",
    unit: "percent",
    grain: "month",
    target: 35,
    owner: "vp-sales",
  },
  {
    code: "marketing_cost_per_lead",
    name: "Cost per lead",
    cube: ReportingCubes.marketingFunnel,
    metricCode: "cost_per_lead",
    unit: "currency",
    direction: "lower-is-better",
    grain: "month",
    target: 40_00,
    owner: "cmo",
  },
  {
    code: "cash_collection_rate",
    name: "Cash collection rate",
    cube: ReportingCubes.financeReceivables,
    metricCode: "collection_rate",
    unit: "percent",
    grain: "month",
    target: 95,
    owner: "cfo",
  },
  {
    code: "on_time_delivery",
    name: "Delivery completion rate",
    cube: ReportingCubes.logisticsShipments,
    metricCode: "delivery_rate",
    unit: "percent",
    grain: "week",
    target: 97,
    owner: "vp-operations",
  },
  {
    code: "production_scrap_rate",
    name: "Production scrap rate",
    cube: ReportingCubes.productionOutput,
    metricCode: "scrap_rate",
    unit: "percent",
    direction: "lower-is-better",
    grain: "week",
    target: 2,
    owner: "plant-manager",
  },
  {
    code: "supplier_reject_rate",
    name: "Supplier lot reject rate",
    cube: ReportingCubes.qualityInspections,
    metricCode: "lot_reject_rate",
    unit: "percent",
    direction: "lower-is-better",
    grain: "month",
    target: 1.5,
    owner: "quality-manager",
  },
  {
    code: "inventory_count_accuracy",
    name: "Inventory count accuracy",
    cube: ReportingCubes.inventoryMovements,
    metricCode: "count_accuracy",
    unit: "percent",
    grain: "month",
    target: 99,
    thresholds: { warning: 0.99, critical: 0.97 },
    owner: "warehouse-manager",
  },
];

// ---------------------------------------------------------------------------
// Dashboards
// ---------------------------------------------------------------------------

const dashboards: DashboardSpec[] = [
  {
    dashboard: {
      code: "executive-overview",
      title: "Executive overview",
      description: "Bookings, cash, service and quality on one page",
      refreshIntervalSeconds: 300,
    },
    publish: true,
    tiles: [
      {
        type: "kpi",
        title: "Monthly bookings",
        kpiCode: "monthly_bookings",
        layout: { row: 0, col: 0, width: 3, height: 1 },
        window: { grain: "month", trailingPeriods: 12 },
      },
      {
        type: "kpi",
        title: "Cash collection",
        kpiCode: "cash_collection_rate",
        layout: { row: 0, col: 3, width: 3, height: 1 },
        window: { grain: "month", trailingPeriods: 12 },
      },
      {
        type: "kpi",
        title: "Delivery completion",
        kpiCode: "on_time_delivery",
        layout: { row: 0, col: 6, width: 3, height: 1 },
        window: { grain: "week", trailingPeriods: 12 },
      },
      {
        type: "kpi",
        title: "Supplier reject rate",
        kpiCode: "supplier_reject_rate",
        layout: { row: 0, col: 9, width: 3, height: 1 },
        window: { grain: "month", trailingPeriods: 12 },
      },
      {
        type: "chart",
        title: "Booked revenue by month",
        chart: { kind: "line" },
        layout: { row: 1, col: 0, width: 8, height: 3 },
        window: { grain: "month", trailingPeriods: 12 },
        query: {
          cube: ReportingCubes.salesOrders,
          metrics: ["booked_revenue", "orders_booked"],
          dimensions: [],
          densify: true,
        },
      },
      {
        type: "chart",
        title: "Revenue by customer segment",
        chart: { kind: "donut" },
        layout: { row: 1, col: 8, width: 4, height: 3 },
        window: { grain: "month", trailingPeriods: 3, groupByPeriod: false },
        query: {
          cube: ReportingCubes.salesOrders,
          metrics: ["booked_revenue"],
          dimensions: ["customer.segment"],
          topN: { metric: "booked_revenue", limit: 5 },
        },
      },
      {
        type: "table",
        title: "Top customers",
        layout: { row: 4, col: 0, width: 12, height: 3 },
        window: { grain: "month", trailingPeriods: 3, groupByPeriod: false },
        query: {
          cube: ReportingCubes.salesOrders,
          metrics: ["booked_revenue", "orders_booked", "average_order_value"],
          dimensions: ["customer"],
          orderBy: [{ key: "booked_revenue", direction: "desc" }],
          limit: 10,
        },
      },
    ],
  },
  {
    dashboard: {
      code: "supply-quality",
      title: "Supply & quality",
      description: "Inbound quality, production scrap and inventory accuracy",
      audienceRoles: ["quality-manager", "plant-manager", "analyst"],
      refreshIntervalSeconds: 600,
    },
    publish: true,
    tiles: [
      {
        type: "kpi",
        title: "Scrap rate",
        kpiCode: "production_scrap_rate",
        layout: { row: 0, col: 0, width: 4, height: 1 },
        window: { grain: "week", trailingPeriods: 12 },
      },
      {
        type: "kpi",
        title: "Count accuracy",
        kpiCode: "inventory_count_accuracy",
        layout: { row: 0, col: 4, width: 4, height: 1 },
        window: { grain: "month", trailingPeriods: 12 },
      },
      {
        type: "kpi",
        title: "Supplier reject rate",
        kpiCode: "supplier_reject_rate",
        layout: { row: 0, col: 8, width: 4, height: 1 },
        window: { grain: "month", trailingPeriods: 12 },
      },
      {
        type: "chart",
        title: "Scrap by work centre",
        chart: { kind: "bar" },
        layout: { row: 1, col: 0, width: 6, height: 3 },
        window: { grain: "week", trailingPeriods: 8, groupByPeriod: false },
        query: {
          cube: ReportingCubes.productionOutput,
          metrics: ["scrap_output", "scrap_rate"],
          dimensions: ["work_center"],
          orderBy: [{ key: "scrap_output", direction: "desc" }],
        },
      },
      {
        type: "table",
        title: "Supplier quality",
        layout: { row: 1, col: 6, width: 6, height: 3 },
        window: { grain: "month", trailingPeriods: 6, groupByPeriod: false },
        query: {
          cube: ReportingCubes.qualityInspections,
          metrics: ["lot_reject_rate", "ncrs_opened", "supplier_demerits"],
          dimensions: ["supplier"],
          orderBy: [{ key: "supplier_demerits", direction: "desc" }],
          limit: 15,
        },
      },
    ],
  },
];

export function standardCatalog(): CatalogSpec {
  return { dimensions, cubes, metrics, kpis, dashboards };
}

export interface InstallSummary {
  readonly dimensions: number;
  readonly cubes: number;
  readonly metrics: number;
  readonly kpis: number;
  readonly dashboards: number;
}

/**
 * Installs a catalog into a module. Idempotent at the item level: anything
 * already present is skipped, so this can run on every boot.
 */
export async function installCatalog(
  ctx: TenantContext,
  module: ReportingBiModule,
  spec: CatalogSpec = standardCatalog(),
): Promise<InstallSummary> {
  const summary = { dimensions: 0, cubes: 0, metrics: 0, kpis: 0, dashboards: 0 };

  for (const dimension of spec.dimensions) {
    if (await module.repos.dimensions.findByKey(ctx.tenantId, dimension.key)) continue;
    await module.services.dimensions.registerDimension(ctx, dimension);
    summary.dimensions += 1;
  }

  for (const cube of spec.cubes) {
    if (await module.repos.cubes.findByName(ctx.tenantId, cube.name)) continue;
    await module.services.cubes.defineCube(ctx, cube);
    await module.services.cubes.publishCube(ctx, cube.name);
    summary.cubes += 1;
  }

  // Base metrics first: a derived metric cannot be published while any
  // dependency is still a draft.
  const ordered = [...spec.metrics].sort(
    (a, b) => Number(Boolean(a.expression)) - Number(Boolean(b.expression)),
  );
  for (const metric of ordered) {
    if (await module.repos.metrics.findByCode(ctx.tenantId, metric.code)) continue;
    await module.services.metrics.defineMetric(ctx, metric);
    summary.metrics += 1;
  }
  for (const metric of ordered) {
    const stored = await module.repos.metrics.findByCode(ctx.tenantId, metric.code);
    if (stored && stored.status === "draft") {
      await module.services.metrics.publishMetric(ctx, metric.code);
    }
  }

  for (const kpi of spec.kpis) {
    if (await module.repos.kpis.findByCode(ctx.tenantId, kpi.code)) continue;
    await module.services.kpis.defineKpi(ctx, kpi);
    summary.kpis += 1;
  }

  for (const { dashboard, tiles, publish } of spec.dashboards) {
    if (await module.repos.dashboards.findByCode(ctx.tenantId, dashboard.code)) continue;
    await module.services.dashboards.createDashboard(ctx, dashboard);
    for (const tile of tiles) {
      await module.services.dashboards.addTile(ctx, dashboard.code, tile);
    }
    if (publish) await module.services.dashboards.publishDashboard(ctx, dashboard.code);
    summary.dashboards += 1;
  }

  return summary;
}
