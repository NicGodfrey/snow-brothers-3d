import { type TenantContext, type Ulid } from "@enterprise-suite/shared-kernel";
import { Allocation, type DemandRefType } from "../domain/allocation.js";
import { type AtpRow, type CtpResult } from "../domain/atp.js";
import { type ReceiptSourceType } from "../domain/records.js";
import { type LocationCode } from "../domain/types.js";
import type { SupplyChainDeps } from "./ports.js";
export declare class AtpService {
    private readonly deps;
    constructor(deps: SupplyChainDeps);
    /**
     * Discrete ATP for an item/location. Supply = on-hand + open scheduled
     * receipts + FIRMED planned orders from the latest supply plan (PLANNED
     * orders are not committed supply and are deliberately excluded; RELEASED
     * ones re-enter as purchase/work order receipts pushed by downstream).
     * Demand = active allocations.
     */
    atpReport(ctx: TenantContext, sku: string, location: LocationCode, weeks: number): Promise<AtpRow[]>;
    /**
     * Capable-to-promise: ATP first, then supplier capacity (offset by the
     * item lead time) for the remainder. Simplification: capacity is taken as
     * the calendar's gross weekly commitment; use the capacity load report for
     * a load-netted view before firming large promises.
     */
    ctp(ctx: TenantContext, input: {
        sku: string;
        location: LocationCode;
        qty: number;
        needDate: string;
        horizonWeeks?: number;
    }): Promise<CtpResult & {
        atp: AtpRow[];
    }>;
    createAllocation(ctx: TenantContext, input: {
        sku: string;
        location: LocationCode;
        qty: number;
        needDate: string;
        demandRefType?: DemandRefType;
        demandRef: string;
        /** When true, skip the ATP check (e.g. management override). */
        force?: boolean;
    }): Promise<{
        allocation: Allocation;
        atpAtNeedDate: number;
    }>;
    cancelAllocation(ctx: TenantContext, id: Ulid): Promise<Allocation>;
    listAllocations(ctx: TenantContext, filter?: {
        sku?: string;
        location?: LocationCode;
        status?: string;
    }): Promise<Allocation[]>;
    /** Inventory + scheduled receipt projections (integration inbox). */
    upsertInventory(ctx: TenantContext, input: {
        sku: string;
        location: LocationCode;
        onHandQty: number;
    }): Promise<void>;
    addScheduledReceipt(ctx: TenantContext, input: {
        sku: string;
        location: LocationCode;
        dueDate: string;
        qty: number;
        sourceType: ReceiptSourceType;
        sourceRef: string;
    }): Promise<Ulid>;
    removeScheduledReceipt(ctx: TenantContext, id: Ulid): Promise<void>;
}
//# sourceMappingURL=atp-service.d.ts.map