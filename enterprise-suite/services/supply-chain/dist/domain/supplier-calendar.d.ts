import { AggregateRoot, type TenantId } from "@enterprise-suite/shared-kernel";
import { type IsoDate, type SupplierId } from "./types.js";
export interface CapacityWeek {
    readonly weekStart: IsoDate;
    readonly capacityQty: number;
}
interface SupplierCapacityCalendarProps {
    supplierId: SupplierId;
    /** Optional SKU scope; null means the calendar applies to all items of the supplier. */
    sku: string | null;
    name: string;
    /** Capacity assumed for weeks without an explicit entry. */
    defaultWeeklyCapacity: number;
    weeks: readonly CapacityWeek[];
}
/**
 * Lightweight weekly capacity commitment from a supplier, used to sanity
 * check purchase planned orders during MRP and to answer capable-to-promise.
 * Weeks without an explicit entry fall back to `defaultWeeklyCapacity`.
 */
export declare class SupplierCapacityCalendar extends AggregateRoot<SupplierCapacityCalendarProps> {
    static create(tenantId: TenantId, input: {
        supplierId: SupplierId;
        sku?: string;
        name?: string;
        defaultWeeklyCapacity?: number;
        weeks?: readonly {
            weekStart: string;
            capacityQty: number;
        }[];
    }): SupplierCapacityCalendar;
    get supplierId(): SupplierId;
    get sku(): string | null;
    get weeks(): readonly CapacityWeek[];
    get defaultWeeklyCapacity(): number;
    /** Upsert explicit week entries (normalized to Mondays). */
    setWeeks(entries: readonly {
        weekStart: string;
        capacityQty: number;
    }[]): void;
    setDefaultWeeklyCapacity(qty: number): void;
    capacityFor(weekStart: IsoDate): number;
    private raiseChanged;
}
export {};
//# sourceMappingURL=supplier-calendar.d.ts.map