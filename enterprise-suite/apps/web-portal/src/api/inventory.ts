import type { Money } from "@enterprise-suite/shared-kernel";
import type { ModuleKey } from "../domain/module.js";
import type { ApiClient } from "./client.js";
import { BaseModuleApi } from "./module-api.js";
import type { ApiPage, ListQuery } from "./types.js";

/** Typed stub for `inventory-wms`: stock, movements, replenishment, counts. */

export type MovementType = "receipt" | "issue" | "transfer" | "adjustment";
export type CountStatus = "scheduled" | "counting" | "review" | "closed";

export interface StockRowDto {
  readonly id: string;
  readonly sku: string;
  readonly description: string;
  readonly warehouse: string;
  readonly onHand: number;
  readonly allocated: number;
  readonly available: number;
  readonly uom: string;
  readonly value: Money;
}

export interface MovementDto {
  readonly id: string;
  readonly postedAt: string;
  readonly type: MovementType;
  readonly sku: string;
  readonly warehouse: string;
  readonly quantity: number;
  readonly uom: string;
  readonly reference: string;
  readonly postedBy: string;
}

export interface ReplenishmentRowDto {
  readonly id: string;
  readonly sku: string;
  readonly warehouse: string;
  readonly onHand: number;
  readonly reorderPoint: number;
  readonly suggestedQty: number;
  readonly leadTimeDays: number;
  readonly preferredSupplierId?: string;
}

export interface CycleCountDto {
  readonly id: string;
  readonly reference: string;
  readonly warehouse: string;
  readonly zone: string;
  readonly status: CountStatus;
  readonly scheduledFor: string;
  readonly linesCounted: number;
  readonly linesTotal: number;
  readonly varianceValue?: Money;
}

export interface PostAdjustmentInput {
  readonly sku: string;
  readonly warehouse: string;
  readonly quantity: number;
  readonly uom: string;
  readonly reasonCode: string;
  readonly note?: string;
}

export interface TransferInput {
  readonly sku: string;
  readonly fromWarehouse: string;
  readonly toWarehouse: string;
  readonly quantity: number;
  readonly uom: string;
}

export class InventoryApi extends BaseModuleApi {
  readonly module: ModuleKey = "inventory";

  constructor(http: ApiClient) {
    super(http);
  }

  listStock(
    query: ListQuery & { warehouse?: string; belowReorder?: boolean } = {},
  ): Promise<ApiPage<StockRowDto>> {
    return this.http.get<ApiPage<StockRowDto>>("/stock", { query: { ...query } });
  }

  getStockForSku(sku: string, warehouse?: string): Promise<readonly StockRowDto[]> {
    return this.http.get<readonly StockRowDto[]>(`/stock/${encodeURIComponent(sku)}`, {
      query: { warehouse },
    });
  }

  listMovements(
    query: ListQuery & { type?: MovementType; sku?: string; warehouse?: string } = {},
  ): Promise<ApiPage<MovementDto>> {
    return this.http.get<ApiPage<MovementDto>>("/movements", { query: { ...query } });
  }

  postAdjustment(input: PostAdjustmentInput, idempotencyKey?: string): Promise<MovementDto> {
    return this.http.post<MovementDto>("/movements/adjustments", { body: input, idempotencyKey });
  }

  transfer(input: TransferInput, idempotencyKey?: string): Promise<MovementDto> {
    return this.http.post<MovementDto>("/movements/transfers", { body: input, idempotencyKey });
  }

  listReplenishment(
    query: ListQuery & { warehouse?: string } = {},
  ): Promise<ApiPage<ReplenishmentRowDto>> {
    return this.http.get<ApiPage<ReplenishmentRowDto>>("/replenishment", { query: { ...query } });
  }

  listCounts(query: ListQuery & { status?: CountStatus } = {}): Promise<ApiPage<CycleCountDto>> {
    return this.http.get<ApiPage<CycleCountDto>>("/counts", { query: { ...query } });
  }

  closeCount(countId: string): Promise<CycleCountDto> {
    return this.http.post<CycleCountDto>(`/counts/${encodeURIComponent(countId)}/close`, {
      body: {},
    });
  }
}
