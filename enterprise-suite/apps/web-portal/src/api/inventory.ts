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
  sumMoney,
  type ModuleSummaryDto,
  type SearchHit,
} from "./module-api.js";
import type { ApiPage, ListQuery, RequestOptions, RowLike } from "./types.js";

/**
 * Typed client for `inventory-wms` behind the gateway's `/api/inventory`
 * prefix. Stock queries are live routes; summary/search are composed from
 * them client-side. Movement history, replenishment and cycle counts have no
 * gateway read route yet, so those calls degrade gracefully.
 */

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

  override async summary(options?: RequestOptions): Promise<ModuleSummaryDto> {
    const [stock, replenishment] = await Promise.all([
      this.listStock({ pageSize: 100 }, options),
      this.listReplenishment({ pageSize: 100 }, options).catch(() => undefined),
    ]);

    const stockValue = sumMoney(stock.items.map((row) => row.value));
    const belowReorder =
      replenishment?.total ??
      stock.items.filter((row) => {
        const reorderPoint = (row as { reorderPoint?: unknown }).reorderPoint;
        return typeof reorderPoint === "number" && row.available < reorderPoint;
      }).length;

    return {
      module: "inventory",
      asOf: new Date().toISOString(),
      metrics: {
        ...(stockValue ? { stockValue: moneyValue(stockValue) } : {}),
        belowReorder: count(belowReorder),
        skusTracked: count(stock.total),
      },
    };
  }

  override async list(
    resource: string,
    query?: ListQuery,
    options?: RequestOptions,
  ): Promise<ApiPage<RowLike>> {
    switch (resource) {
      case "stock":
        return (await this.listStock(query, options)) as unknown as ApiPage<RowLike>;
      case "movements":
        return (await this.listMovements(query, options)) as unknown as ApiPage<RowLike>;
      case "replenishment":
        return (await this.listReplenishment(query, options)) as unknown as ApiPage<RowLike>;
      case "counts":
        return (await this.listCounts(query, options)) as unknown as ApiPage<RowLike>;
      default:
        return super.list(resource, query, options);
    }
  }

  override async search(term: string, limit = 5, options?: RequestOptions): Promise<readonly SearchHit[]> {
    if (!term.trim()) return [];
    const [stock, movements] = await Promise.all([
      this.listStock({ pageSize: 50 }, options),
      this.listMovements({ pageSize: 50 }, options).catch(() => emptyPage<MovementDto>()),
    ]);
    return composeHits("inventory", term, limit, [
      hitSource({
        slug: "stock",
        rows: stock.items,
        fields: ["sku", "description", "warehouse"],
        title: (row) => `${row.sku} @ ${row.warehouse}`,
        subtitle: (row) => `Stock · ${row.available} available`,
      }),
      hitSource({
        slug: "movements",
        rows: movements.items,
        fields: ["sku", "reference", "type"],
        title: (row) => `${row.type} ${row.sku}`,
        subtitle: (row) => `Movement · ${row.reference}`,
      }),
    ]);
  }

  listStock(
    query: ListQuery & { warehouse?: string; belowReorder?: boolean } = {},
    options?: RequestOptions,
  ): Promise<ApiPage<StockRowDto>> {
    return this.http
      .get<unknown>("/stock", { ...options, query: { ...query } })
      .then(asPage<StockRowDto>);
  }

  getStockForSku(sku: string, warehouse?: string): Promise<readonly StockRowDto[]> {
    return this.http.get<readonly StockRowDto[]>(`/stock/${encodeURIComponent(sku)}`, {
      query: { warehouse },
    });
  }

  listMovements(
    query: ListQuery & { type?: MovementType; sku?: string; warehouse?: string } = {},
    options?: RequestOptions,
  ): Promise<ApiPage<MovementDto>> {
    return this.http
      .get<unknown>("/movements", { ...options, query: { ...query } })
      .then(asPage<MovementDto>);
  }

  postAdjustment(input: PostAdjustmentInput, idempotencyKey?: string): Promise<MovementDto> {
    return this.http.post<MovementDto>("/movements/adjustments", { body: input, idempotencyKey });
  }

  transfer(input: TransferInput, idempotencyKey?: string): Promise<MovementDto> {
    return this.http.post<MovementDto>("/movements/transfers", { body: input, idempotencyKey });
  }

  listReplenishment(
    query: ListQuery & { warehouse?: string } = {},
    options?: RequestOptions,
  ): Promise<ApiPage<ReplenishmentRowDto>> {
    return this.http
      .get<unknown>("/replenishment", { ...options, query: { ...query } })
      .then(asPage<ReplenishmentRowDto>);
  }

  listCounts(
    query: ListQuery & { status?: CountStatus } = {},
    options?: RequestOptions,
  ): Promise<ApiPage<CycleCountDto>> {
    return this.http
      .get<unknown>("/counts", { ...options, query: { ...query } })
      .then(asPage<CycleCountDto>);
  }

  closeCount(countId: string): Promise<CycleCountDto> {
    return this.http.post<CycleCountDto>(`/counts/${encodeURIComponent(countId)}/close`, {
      body: {},
    });
  }
}
