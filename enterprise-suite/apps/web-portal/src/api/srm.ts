import type { Money } from "@enterprise-suite/shared-kernel";
import type { ModuleKey } from "../domain/module.js";
import type { ApiClient } from "./client.js";
import { BaseModuleApi } from "./module-api.js";
import type { ApiPage, ListQuery } from "./types.js";

/**
 * Typed stub for the SRM side: `srm-core` (suppliers, scorecards, contracts)
 * fronted together with `procurement-srm` (requisitions, POs, receipts) behind
 * one gateway prefix, which is how the portal consumes them.
 */

export type SupplierStatus = "prospect" | "approved" | "conditional" | "blocked";
export type RequisitionStatus = "draft" | "submitted" | "approved" | "sourced" | "rejected";
export type PurchaseOrderStatus = "issued" | "acknowledged" | "partially-received" | "received" | "closed";

export interface SupplierDto {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly country: string;
  readonly status: SupplierStatus;
  readonly scorecard: number;
  readonly onTimeDeliveryPct: number;
  readonly categories: readonly string[];
  readonly contractCount: number;
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
  readonly number: string;
  readonly requestedBy: string;
  readonly costCenter: string;
  readonly status: RequisitionStatus;
  readonly total: Money;
  readonly neededBy: string;
  readonly createdAt: string;
  readonly lines?: readonly RequisitionLineDto[];
}

export interface PurchaseOrderDto {
  readonly id: string;
  readonly number: string;
  readonly supplierId: string;
  readonly supplierName: string;
  readonly status: PurchaseOrderStatus;
  readonly total: Money;
  readonly issuedOn: string;
  readonly promisedOn: string;
  readonly receivedPct: number;
}

export interface ContractDto {
  readonly id: string;
  readonly reference: string;
  readonly supplierId: string;
  readonly supplierName: string;
  readonly type: "framework" | "spot" | "sla";
  readonly startsOn: string;
  readonly endsOn: string;
  readonly committedValue: Money;
  readonly autoRenew: boolean;
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

  constructor(http: ApiClient) {
    super(http);
  }

  listSuppliers(
    query: ListQuery & { status?: SupplierStatus; category?: string } = {},
  ): Promise<ApiPage<SupplierDto>> {
    return this.http.get<ApiPage<SupplierDto>>("/suppliers", { query: { ...query } });
  }

  getSupplier(supplierId: string): Promise<SupplierDto> {
    return this.http.get<SupplierDto>(`/suppliers/${encodeURIComponent(supplierId)}`);
  }

  setSupplierStatus(supplierId: string, status: SupplierStatus, reason: string): Promise<SupplierDto> {
    return this.http.post<SupplierDto>(`/suppliers/${encodeURIComponent(supplierId)}/status`, {
      body: { status, reason },
    });
  }

  listRequisitions(
    query: ListQuery & { status?: RequisitionStatus } = {},
  ): Promise<ApiPage<RequisitionDto>> {
    return this.http.get<ApiPage<RequisitionDto>>("/requisitions", { query: { ...query } });
  }

  createRequisition(input: CreateRequisitionInput, idempotencyKey?: string): Promise<RequisitionDto> {
    return this.http.post<RequisitionDto>("/requisitions", { body: input, idempotencyKey });
  }

  approveRequisition(requisitionId: string, comment?: string): Promise<RequisitionDto> {
    return this.http.post<RequisitionDto>(
      `/requisitions/${encodeURIComponent(requisitionId)}/approve`,
      { body: { comment } },
    );
  }

  listPurchaseOrders(
    query: ListQuery & { status?: PurchaseOrderStatus; supplierId?: string } = {},
  ): Promise<ApiPage<PurchaseOrderDto>> {
    return this.http.get<ApiPage<PurchaseOrderDto>>("/purchase-orders", { query: { ...query } });
  }

  issuePurchaseOrder(
    input: IssuePurchaseOrderInput,
    idempotencyKey?: string,
  ): Promise<PurchaseOrderDto> {
    return this.http.post<PurchaseOrderDto>("/purchase-orders", { body: input, idempotencyKey });
  }

  listContracts(
    query: ListQuery & { supplierId?: string; expiringInDays?: number } = {},
  ): Promise<ApiPage<ContractDto>> {
    return this.http.get<ApiPage<ContractDto>>("/contracts", { query: { ...query } });
  }
}
