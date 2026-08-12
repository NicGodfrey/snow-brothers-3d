import type { Money } from "@enterprise-suite/shared-kernel";
import type { ModuleKey } from "../domain/module.js";
import type { ApiClient } from "./client.js";
import { BaseModuleApi, count, percent, type ModuleSummaryDto, type SearchHit } from "./module-api.js";
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
  readonly name: string;
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

function asPage<T>(body: unknown): ApiPage<T> {
  if (Array.isArray(body)) {
    return { items: body as T[], page: 1, pageSize: body.length, total: body.length };
  }
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    const items = (record.items ?? record.data ?? record.results ?? []) as T[];
    const list = Array.isArray(items) ? items : [];
    return {
      items: list,
      page: Number(record.page ?? 1),
      pageSize: Number(record.pageSize ?? list.length),
      total: Number(record.total ?? list.length),
      nextCursor: typeof record.nextCursor === "string" ? record.nextCursor : undefined,
    };
  }
  return { items: [], page: 1, pageSize: 0, total: 0 };
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
      this.listRequisitions({ pageSize: 100 }, options).catch(() => asPage<RequisitionDto>([])),
      this.listPurchaseOrders({ pageSize: 100 }, options).catch(() => asPage<PurchaseOrderDto>([])),
    ]);
    const approved = suppliers.items.filter((s) => /approved|active|conditional/i.test(String(s.status))).length;
    const openReq = requisitions.items.filter((r) => !/rejected|closed|cancelled/i.test(String(r.status))).length;
    const openPo = orders.items.filter((o) => !/closed|cancelled/i.test(String(o.status))).length;
    return {
      module: "srm",
      asOf: new Date().toISOString(),
      metrics: {
        suppliers: count(suppliers.total),
        approvedSuppliers: count(approved),
        openRequisitions: count(openReq),
        openPurchaseOrders: count(openPo),
        approvalRate: percent(suppliers.total ? Math.round((approved / suppliers.total) * 100) : 0),
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
        return asPage<RowLike>([]);
    }
  }

  override async search(term: string, limit = 5, options?: RequestOptions): Promise<readonly SearchHit[]> {
    const q = term.trim().toLowerCase();
    if (!q) return [];
    const suppliers = await this.listSuppliers({ pageSize: 50 }, options);
    return suppliers.items
      .filter((s) => `${s.code} ${s.name}`.toLowerCase().includes(q))
      .slice(0, limit)
      .map((s) => ({
        module: "srm" as const,
        id: s.id,
        title: s.name,
        subtitle: `${s.code} · ${s.status}`,
        path: "/modules/srm/suppliers",
      }));
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
