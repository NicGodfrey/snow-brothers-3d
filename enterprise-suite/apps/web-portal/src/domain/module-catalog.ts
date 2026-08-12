import {
  MODULE_KEYS,
  isModuleKey,
  type ModuleDescriptor,
  type ModuleKey,
} from "./module.js";

/**
 * The six modules the portal shell mounts. Adding a module here is enough for
 * it to appear in the rail, the command palette, the dashboard and the BFF —
 * everything downstream is driven off this catalog.
 */

const SALES: ModuleDescriptor = {
  key: "sales",
  label: "Sales",
  tagline: "Quotes, orders and fulfillment status",
  service: "@enterprise-suite/sales-erp",
  mark: "SL",
  accent: "#2563eb",
  order: 10,
  permission: "sales:read",
  nav: [
    {
      key: "sales.quotes",
      label: "Quotes",
      slug: "quotes",
      summary: "Open quotes awaiting customer decision",
      permission: "sales:read",
      resource: "quotes",
      countKey: "openQuotes",
    },
    {
      key: "sales.orders",
      label: "Orders",
      slug: "orders",
      summary: "Confirmed sales orders and their fulfillment state",
      permission: "sales:read",
      resource: "orders",
      countKey: "openOrders",
    },
    {
      key: "sales.customers",
      label: "Customers",
      slug: "customers",
      summary: "Accounts with credit status and open balance",
      permission: "sales:read",
      resource: "customers",
    },
    {
      key: "sales.approvals",
      label: "Discount approvals",
      slug: "approvals",
      summary: "Quotes blocked on a discount above policy",
      permission: "sales:approve",
      resource: "approvals",
      countKey: "pendingApprovals",
    },
  ],
  actions: [
    { key: "sales.quote.create", label: "New quote", permission: "sales:write", slug: "quotes" },
    {
      key: "sales.quote.approve",
      label: "Approve discount",
      permission: "sales:approve",
      slug: "approvals",
    },
  ],
  kpis: [
    { key: "openOrderValue", label: "Open order value", format: "money", polarity: "up-good" },
    { key: "openQuotes", label: "Open quotes", format: "count", polarity: "neutral" },
    { key: "quoteWinRate", label: "Quote win rate", format: "percent", polarity: "up-good" },
    { key: "avgCycleDays", label: "Quote → order", format: "days", polarity: "down-good" },
  ],
};

const MARKETING: ModuleDescriptor = {
  key: "marketing",
  label: "Marketing",
  tagline: "Campaigns, leads and attribution",
  service: "@enterprise-suite/marketing-erp",
  mark: "MK",
  accent: "#c026d3",
  order: 20,
  permission: "marketing:read",
  nav: [
    {
      key: "marketing.campaigns",
      label: "Campaigns",
      slug: "campaigns",
      summary: "Running and scheduled campaigns with spend to date",
      permission: "marketing:read",
      resource: "campaigns",
      countKey: "activeCampaigns",
    },
    {
      key: "marketing.leads",
      label: "Leads",
      slug: "leads",
      summary: "Inbound leads by score and routing state",
      permission: "marketing:read",
      resource: "leads",
      countKey: "unroutedLeads",
    },
    {
      key: "marketing.segments",
      label: "Segments",
      slug: "segments",
      summary: "Audience segments and their refresh cadence",
      permission: "marketing:read",
      resource: "segments",
    },
    {
      key: "marketing.attribution",
      label: "Attribution",
      slug: "attribution",
      summary: "Pipeline credited to each channel",
      permission: "marketing:read",
      resource: "attribution",
    },
  ],
  actions: [
    {
      key: "marketing.campaign.launch",
      label: "Launch campaign",
      permission: "marketing:approve",
      slug: "campaigns",
    },
    {
      key: "marketing.lead.route",
      label: "Route leads",
      permission: "marketing:write",
      slug: "leads",
    },
  ],
  kpis: [
    { key: "activeCampaigns", label: "Active campaigns", format: "count", polarity: "neutral" },
    { key: "spendToDate", label: "Spend to date", format: "money", polarity: "down-good" },
    { key: "unroutedLeads", label: "Unrouted leads", format: "count", polarity: "down-good" },
    { key: "leadToQuoteRate", label: "Lead → quote", format: "percent", polarity: "up-good" },
  ],
};

const INVENTORY: ModuleDescriptor = {
  key: "inventory",
  label: "Inventory",
  tagline: "Stock on hand, movements and replenishment",
  service: "@enterprise-suite/inventory-wms",
  mark: "IN",
  accent: "#0d9488",
  order: 30,
  permission: "inventory:read",
  nav: [
    {
      key: "inventory.stock",
      label: "Stock on hand",
      slug: "stock",
      summary: "Quantities by item and warehouse, with allocations",
      permission: "inventory:read",
      resource: "stock",
    },
    {
      key: "inventory.movements",
      label: "Movements",
      slug: "movements",
      summary: "Receipts, issues, transfers and adjustments",
      permission: "inventory:read",
      resource: "movements",
    },
    {
      key: "inventory.replenishment",
      label: "Replenishment",
      slug: "replenishment",
      summary: "Items below reorder point",
      permission: "inventory:read",
      resource: "replenishment",
      countKey: "belowReorder",
    },
    {
      key: "inventory.counts",
      label: "Cycle counts",
      slug: "counts",
      summary: "Scheduled and in-progress counts",
      permission: "inventory:write",
      resource: "counts",
    },
  ],
  actions: [
    {
      key: "inventory.adjustment.post",
      label: "Post adjustment",
      permission: "inventory:write",
      slug: "movements",
    },
  ],
  kpis: [
    { key: "stockValue", label: "Stock value", format: "money", polarity: "neutral" },
    { key: "belowReorder", label: "Below reorder point", format: "count", polarity: "down-good" },
    { key: "fillRate", label: "Fill rate", format: "percent", polarity: "up-good" },
    { key: "daysOfCover", label: "Days of cover", format: "days", polarity: "up-good" },
  ],
};

const SRM: ModuleDescriptor = {
  key: "srm",
  label: "SRM",
  tagline: "Suppliers, requisitions and purchase orders",
  service: "@enterprise-suite/srm-core",
  mark: "SR",
  accent: "#ea580c",
  order: 40,
  permission: "srm:read",
  nav: [
    {
      key: "srm.suppliers",
      label: "Suppliers",
      slug: "suppliers",
      summary: "Approved vendors with scorecard rating",
      permission: "srm:read",
      resource: "suppliers",
    },
    {
      key: "srm.requisitions",
      label: "Requisitions",
      slug: "requisitions",
      summary: "Requests awaiting sourcing or approval",
      permission: "srm:read",
      resource: "requisitions",
      countKey: "openRequisitions",
    },
    {
      key: "srm.purchase-orders",
      label: "Purchase orders",
      slug: "purchase-orders",
      summary: "Issued POs and their receipt status",
      permission: "srm:read",
      resource: "purchase-orders",
      countKey: "openPurchaseOrders",
    },
    {
      key: "srm.contracts",
      label: "Contracts",
      slug: "contracts",
      summary: "Framework agreements and expiry dates",
      permission: "srm:read",
      resource: "contracts",
    },
  ],
  actions: [
    {
      key: "srm.requisition.approve",
      label: "Approve requisition",
      permission: "srm:approve",
      slug: "requisitions",
    },
    {
      key: "srm.po.issue",
      label: "Issue purchase order",
      permission: "srm:write",
      slug: "purchase-orders",
    },
  ],
  kpis: [
    { key: "openPurchaseOrders", label: "Open POs", format: "count", polarity: "neutral" },
    { key: "committedSpend", label: "Committed spend", format: "money", polarity: "neutral" },
    { key: "onTimeDelivery", label: "On-time delivery", format: "percent", polarity: "up-good" },
    { key: "avgApprovalDays", label: "Requisition approval", format: "days", polarity: "down-good" },
  ],
};

const PRM: ModuleDescriptor = {
  key: "prm",
  label: "PRM",
  tagline: "Partners, deal registration and MDF",
  service: "@enterprise-suite/prm-core",
  mark: "PR",
  accent: "#7c3aed",
  order: 50,
  permission: "prm:read",
  nav: [
    {
      key: "prm.partners",
      label: "Partners",
      slug: "partners",
      summary: "Channel partners by tier and status",
      permission: "prm:read",
      resource: "partners",
    },
    {
      key: "prm.deals",
      label: "Deal registrations",
      slug: "deals",
      summary: "Partner-registered opportunities awaiting review",
      permission: "prm:read",
      resource: "deals",
      countKey: "pendingDeals",
    },
    {
      key: "prm.mdf",
      label: "MDF requests",
      slug: "mdf",
      summary: "Market development fund claims and balances",
      permission: "prm:read",
      resource: "mdf-requests",
      countKey: "openMdf",
    },
    {
      key: "prm.enablement",
      label: "Enablement",
      slug: "enablement",
      summary: "Certification progress per partner",
      permission: "prm:read",
      resource: "enablement",
    },
  ],
  actions: [
    {
      key: "prm.deal.approve",
      label: "Approve registration",
      permission: "prm:approve",
      slug: "deals",
    },
    { key: "prm.mdf.approve", label: "Approve MDF", permission: "prm:approve", slug: "mdf" },
  ],
  kpis: [
    { key: "activePartners", label: "Active partners", format: "count", polarity: "up-good" },
    { key: "registeredPipeline", label: "Registered pipeline", format: "money", polarity: "up-good" },
    { key: "pendingDeals", label: "Deals awaiting review", format: "count", polarity: "down-good" },
    { key: "mdfUtilisation", label: "MDF utilisation", format: "percent", polarity: "up-good" },
  ],
};

const FINANCE: ModuleDescriptor = {
  key: "finance",
  label: "Finance",
  tagline: "Ledger, receivables and payables",
  service: "@enterprise-suite/finance-erp",
  mark: "FI",
  accent: "#0369a1",
  order: 60,
  permission: "finance:read",
  nav: [
    {
      key: "finance.receivables",
      label: "Receivables",
      slug: "receivables",
      summary: "Open customer invoices by ageing bucket",
      permission: "finance:read",
      resource: "receivables",
      countKey: "overdueInvoices",
    },
    {
      key: "finance.payables",
      label: "Payables",
      slug: "payables",
      summary: "Supplier invoices due for payment",
      permission: "finance:read",
      resource: "payables",
    },
    {
      key: "finance.journals",
      label: "Journals",
      slug: "journals",
      summary: "Posted and draft journal entries",
      permission: "finance:read",
      resource: "journals",
      countKey: "draftJournals",
    },
    {
      key: "finance.periods",
      label: "Periods",
      slug: "periods",
      summary: "Accounting periods and close checklist",
      permission: "finance:close",
      resource: "periods",
    },
  ],
  actions: [
    { key: "finance.journal.post", label: "Post journal", permission: "finance:approve", slug: "journals" },
    { key: "finance.period.close", label: "Close period", permission: "finance:close", slug: "periods" },
  ],
  kpis: [
    { key: "receivablesOutstanding", label: "AR outstanding", format: "money", polarity: "down-good" },
    { key: "payablesOutstanding", label: "AP outstanding", format: "money", polarity: "neutral" },
    { key: "overdueInvoices", label: "Overdue invoices", format: "count", polarity: "down-good" },
    { key: "daysSalesOutstanding", label: "DSO", format: "days", polarity: "down-good" },
  ],
};

export const MODULE_CATALOG: readonly ModuleDescriptor[] = [
  SALES,
  MARKETING,
  INVENTORY,
  SRM,
  PRM,
  FINANCE,
].sort((a, b) => a.order - b.order);

const CATALOG_BY_KEY = new Map<ModuleKey, ModuleDescriptor>(
  MODULE_CATALOG.map((m) => [m.key, m]),
);

export function getModule(key: ModuleKey): ModuleDescriptor {
  const module = CATALOG_BY_KEY.get(key);
  if (!module) throw new Error(`Unknown module: ${key}`);
  return module;
}

export function tryGetModule(key: string): ModuleDescriptor | undefined {
  return isModuleKey(key) ? CATALOG_BY_KEY.get(key) : undefined;
}

export function allModuleKeys(): readonly ModuleKey[] {
  return MODULE_KEYS;
}
