import { AggregateRoot, type TenantId } from "@enterprise-suite/shared-kernel";
import { type IsoDate, type LocationCode } from "./types.js";
export type AllocationStatus = "ACTIVE" | "CANCELLED" | "FULFILLED";
export type DemandRefType = "SALES_ORDER" | "TRANSFER_ORDER" | "MANUAL";
interface AllocationProps {
    sku: string;
    location: LocationCode;
    qty: number;
    needDate: IsoDate;
    demandRefType: DemandRefType;
    demandRef: string;
    status: AllocationStatus;
}
/**
 * A hard reservation of supply against a specific demand (usually a sales
 * order line). Active allocations are the committed demand side of ATP and
 * are treated as gross requirements by MRP, consuming the forecast of their
 * week.
 */
export declare class Allocation extends AggregateRoot<AllocationProps> {
    static create(tenantId: TenantId, input: {
        sku: string;
        location: LocationCode;
        qty: number;
        needDate: string;
        demandRefType?: DemandRefType;
        demandRef: string;
    }): Allocation;
    get sku(): string;
    get location(): LocationCode;
    get qty(): number;
    get needDate(): IsoDate;
    get status(): AllocationStatus;
    cancel(): void;
    fulfill(): void;
}
export {};
//# sourceMappingURL=allocation.d.ts.map