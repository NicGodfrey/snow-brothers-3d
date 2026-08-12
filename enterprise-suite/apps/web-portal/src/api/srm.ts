import type { Money } from "@enterprise-suite/shared-kernel";
import type { ModuleKey } from "../domain/module.js";
import type { ApiClient } from "./client.js";
import {
  BaseModuleApi,
  asPage,
  composeHits,
  count,
  emptyPage,
  hitSource,
  moneyValue,
  percent,
  statusOf,
  sumMoney,
  type ModuleSummaryDto,
  type SearchHit,
} from "./module-api.js";
import type { ApiPage, ListQuery, RequestOptions, RowLike } from "./types.js";

/**
 * SRM portal client.
 *
 * Suppliers/contracts hit `/api/srm` (srm-core). Requisitions and purchase
 * orders hit `/api/procurement` (procurement-srm). Shell-facing summary/search
 * are composed locally so backends do not need synthetic `/summary` routes.
 */

export type SupplierStatus = "prospect" | "approved" | "conditional" | "blocked" | "active" | string;
export type RequisitionStatus = "draft" | "submitted" | "approved" | "sourced" | "rejected" | string;
export type PurchaseOrderStatus =
  | "issued"
  | "acknowledged"
  | "partially-received"
  | "received"
  | "closed"
  | string;

export interface SupplierDto {
  readonly id: string;
  readonly code: string;
  readonly name?: string;
  /** The live srm-core service names suppliers by `legalName`. */
  readonly legalName?: string;
  readonly country?: string;
  readonly status: SupplierStatus;
  readonly scorecard?: number;
  readonly onTimeDeliveryPct?: number;
  readonly categories?: readonly string[];
  readonly contractCount?: number;
}

export interface RequisitionLineDto {
  readonly lineNo: number;
  readonly sku: string;
  readonly description: string;
  readonly quantity: number;
  readonly uom: string;
  readonly estimatedUnitCost: Money;
}

export interface RequisitionDto {
  readonly id: string;
  readonly number?: string;
  readonly requisitionNumber?: string;
  readonly title?: string;
  readonly requestedBy?: string;
  readonly costCenter?: string;
  readonly status: RequisitionStatus;
  readonly total?: Money;
  readonly neededBy?: string;
  readonly createdAt?: string;
  readonly lines?: readonly RequisitionLineDto[];
}

export interface PurchaseOrderDto {
  readonly id: string;
  readonly number?: string;
  readonly orderNumber?: string;
  readonly supplierId: string;
  readonly supplierName?: string;
  readonly status: PurchaseOrderStatus;
  readonly total?: Money;
  readonly issuedOn?: string;
  readonly promisedOn?: string;
  readonly receivedPct?: number;
}

export interface ContractDto {
  readonly id: string;
  readonly reference?: string;
  readonly contractNumber?: string;
  readonly supplierId: string;
  readonly supplierName?: string;
  readonly type?: string;
  readonly startsOn?: string;
  readonly endsOn?: string;
  readonly committedValue?: Money;
  readonly autoRenew?: boolean;
}

export interface CreateRequisitionInput {
  readonly costCenter: string;
  readonly neededBy: string;
  readonly currency: string;
  readonly lines: ReadonlyArray<{
    readonly sku: string;
    readonly quantity: number;
    readonly uom: string;
    readonly estimatedUnitCostMinor: number;
  }>;
}

export interface IssuePurchaseOrderInput {
  readonly requisitionId: string;
  readonly supplierId: string;
  readonly promisedOn: string;
  readonly incoterm?: string;
}

export class SrmApi extends BaseModuleApi {
  readonly module: ModuleKey = "srm";
  private readonly procurement: ApiClient;

  constructor(srmHttp: ApiClient, procurementHttp: ApiClient) {
    super(srmHttp);
    this.procurement = procurementHttp;
  }

  override async summary(options?: RequestOptions): Promise<ModuleSummaryDto> {
    const [suppliers, requisitions, orders] = await Promise.all([
      this.listSuppliers({ pageSize: 100 }, options),
      this.listRequisitions({ pageSize: 100 }, options).catch(() => emptyPage<RequisitionDto>()),
      this.listPurchaseOrders({ pageSize: 100 }, options).catch(() => emptyPage<PurchaseOrderDto>()),
    ]);

    const approved = suppliers.items.filter((s) =>
      ["approved", "active", "conditional"].includes(statusOf(s)),
    ).length;
    const openReq = requisitions.items.filter(
      (r) => !["rejected", "closed", "cancelled"].includes(statusOf(r)),
    ).length;
    const openOrders = orders.items.filter(
      (o) => !["received", "closed", "cancelled"].includes(statusOf(o)),
    );
    const committedSpend = sumMoney(openOrders.map((o) => o.total));
    const delivery = suppliers.items
      .map((s) => s.onTimeDeliveryPct)
      .filter((value): value is number => typeof value === "number");

    return {
      module: "srm",
      asOf: new Date().toISOString(),
      metrics: {
        suppliers: count(suppliers.total),
        approvedSuppliers: count(approved),
        openRequisitions: count(openReq),
        openPurchaseOrders: count(openOrders.length),
        ...(committedSpend ? { committedSpend: moneyValue(committedSpend) } : {}),
        ...(delivery.length > 0
          ? {
              onTimeDelivery: percent(
                delivery.reduce((sum, value) => sum + value, 0) / delivery.length,
              ),
            }
          : {}),
      },
    };
  }

  override async list(
    resource: string,
    query?: ListQuery,
    options?: RequestOptions,
  ): Promise<ApiPage<RowLike>> {
    switch (resource) {
      case "suppliers":
        return (await this.listSuppliers(query, options)) as unknown as ApiPage<RowLike>;
      case "requisitions":
        return (await this.listRequisitions(query, options)) as unknown as ApiPage<RowLike>;
      case "purchase-orders":
      case "purchaseOrders":
        return (await this.listPurchaseOrders(query, options)) as unknown as ApiPage<RowLike>;
      case "contracts":
        return (await this.listContracts(query, options)) as unknown as ApiPage<RowLike>;
      default:
        return super.list(resource, query, options);
    }
  }

  override async search(term: string, limit = 5, options?: RequestOptions): Promise<readonly SearchHit[]> {
    if (!term.trim()) return [];
    const [suppliers, requisitions, orders, contracts] = await Promise.all([
      this.listSuppliers({ pageSize: 50 }, options),
      this.listRequisitions({ pageSize: 50 }, options).catch(() => emptyPage<RequisitionDto>()),
      this.listPurchaseOrders({ pageSize: 50 }, options).catch(() => emptyPage<PurchaseOrderDto>()),
      this.listContracts({ pageSize: 50 }, options).catch(() => emptyPage<ContractDto>()),
    ]);
    return composeHits("srm", term, limit, [
      hitSource({
        slug: "suppliers",
        rows: suppliers.items,
        fields: ["code", "name", "legalName", "country", "status"],
        title: (row) => `${row.code} · ${row.name ?? row.legalName ?? row.id}`,
        subtitle: (row) => `Supplier · ${row.status}`,
      }),
      hitSource({
        slug: "requisitions",
        rows: requisitions.items,
        fields: ["number", "requisitionNumber", "title", "costCenter", "status"],
        title: (row) => `${row.number ?? row.requisitionNumber ?? row.id} · ${row.title ?? row.costCenter ?? ""}`,
        subtitle: (row) => `Requisition · ${row.status}`,
      }),
      hitSource({
        slug: "purchase-orders",
        rows: orders.items,
        fields: ["number", "orderNumber", "supplierName", "status"],
        title: (row) => `${row.number ?? row.orderNumber ?? row.id} · ${row.supplierName ?? ""}`,
        subtitle: (row) => `Purchase order · ${row.status}`,
      }),
      hitSource({
        slug: "contracts",
        rows: contracts.items,
        fields: ["reference", "contractNumber", "supplierName", "type"],
        title: (row) => row.reference ?? row.contractNumber ?? row.id,
        subtitle: (row) => `Contract · ${row.supplierName ?? row.supplierId}`,
      }),
    ]);
  }

  /** Declared module actions post to the owning service's real routes. */
  override command(slug: string, body: unknown, idempotencyKey?: string): Promise<unknown> {
    switch (slug) {
      case "requisitions":
      case "purchase-orders":
        return this.procurement.post<unknown>(`/${slug}`, { body, idempotencyKey });
      default:
        return super.command(slug, body, idempotencyKey);
    }
  }

  listSuppliers(
    query: ListQuery & { status?: SupplierStatus; category?: string } = {},
    options?: RequestOptions,
  ): Promise<ApiPage<SupplierDto>> {
    return this.http
      .get<unknown>("/suppliers", { ...options, query: { ...query } })
      .then(asPage<SupplierDto>);
  }

  getSupplier(supplierId: string, options?: RequestOptions): Promise<SupplierDto> {
    return this.http.get<SupplierDto>(`/suppliers/${encodeURIComponent(supplierId)}`, options);
  }

  setSupplierStatus(supplierId: string, status: SupplierStatus, reason: string): Promise<SupplierDto> {
    return this.http.post<SupplierDto>(`/suppliers/${encodeURIComponent(supplierId)}/status`, {
      body: { status, reason },
    });
  }

  listRequisitions(
    query: ListQuery & { status?: RequisitionStatus } = {},
    options?: RequestOptions,
  ): Promise<ApiPage<RequisitionDto>> {
    return this.procurement
      .get<unknown>("/requisitions", { ...options, query: { ...query } })
      .then(asPage<RequisitionDto>);
  }

  createRequisition(input: CreateRequisitionInput, idempotencyKey?: string): Promise<RequisitionDto> {
    return this.procurement.post<RequisitionDto>("/requisitions", { body: input, idempotencyKey });
  }

  approveRequisition(requisitionId: string, comment?: string): Promise<RequisitionDto> {
    return this.procurement.post<RequisitionDto>(
      `/requisitions/${encodeURIComponent(requisitionId)}/approve`,
      { body: { comment } },
    );
  }

  listPurchaseOrders(
    query: ListQuery & { status?: PurchaseOrderStatus; supplierId?: string } = {},
    options?: RequestOptions,
  ): Promise<ApiPage<PurchaseOrderDto>> {
    return this.procurement
      .get<unknown>("/purchase-orders", { ...options, query: { ...query } })
      .then(asPage<PurchaseOrderDto>);
  }

  issuePurchaseOrder(
    input: IssuePurchaseOrderInput,
    idempotencyKey?: string,
  ): Promise<PurchaseOrderDto> {
    return this.procurement.post<PurchaseOrderDto>("/purchase-orders", { body: input, idempotencyKey });
  }

  listContracts(
    query: ListQuery & { supplierId?: string; expiringInDays?: number } = {},
    options?: RequestOptions,
  ): Promise<ApiPage<ContractDto>> {
    return this.http
      .get<unknown>("/contracts", { ...options, query: { ...query } })
      .then(asPage<ContractDto>);
  }
}
