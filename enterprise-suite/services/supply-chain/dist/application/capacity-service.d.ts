import { type TenantContext, type Ulid } from "@enterprise-suite/shared-kernel";
import { SupplierCapacityCalendar } from "../domain/supplier-calendar.js";
import { type IsoDate } from "../domain/types.js";
import type { SupplyChainDeps } from "./ports.js";
export interface CapacityLoadRow {
    readonly weekStart: IsoDate;
    readonly capacityQty: number;
    readonly loadQty: number;
    readonly availableQty: number;
    /** Null when the week has zero capacity (utilization undefined). */
    readonly utilizationPct: number | null;
    readonly overloaded: boolean;
}
export declare class CapacityService {
    private readonly deps;
    constructor(deps: SupplyChainDeps);
    createCalendar(ctx: TenantContext, input: {
        supplierId: string;
        sku?: string;
        name?: string;
        defaultWeeklyCapacity?: number;
        weeks?: readonly {
            weekStart: string;
            capacityQty: number;
        }[];
    }): Promise<SupplierCapacityCalendar>;
    getCalendar(ctx: TenantContext, id: Ulid): Promise<SupplierCapacityCalendar>;
    listCalendars(ctx: TenantContext, supplier?: string): Promise<SupplierCapacityCalendar[]>;
    setWeeks(ctx: TenantContext, id: Ulid, weeks: readonly {
        weekStart: string;
        capacityQty: number;
    }[]): Promise<SupplierCapacityCalendar>;
    /**
     * Weekly capacity vs. load report for one supplier. Load is the sum of
     * open purchase-order receipts plus non-cancelled purchase planned orders
     * (by due week) across the latest supply plans of items preferring this
     * supplier.
     */
    loadReport(ctx: TenantContext, supplier: string, weeks: number): Promise<CapacityLoadRow[]>;
}
//# sourceMappingURL=capacity-service.d.ts.map