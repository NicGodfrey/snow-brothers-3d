import { AggregateRoot, DomainError, envelope, } from "@enterprise-suite/shared-kernel";
import { isoDate, startOfIsoWeek } from "./calendar.js";
import { SupplyChainEvents } from "./events.js";
import { assertQty } from "./types.js";
/**
 * Lightweight weekly capacity commitment from a supplier, used to sanity
 * check purchase planned orders during MRP and to answer capable-to-promise.
 * Weeks without an explicit entry fall back to `defaultWeeklyCapacity`.
 */
export class SupplierCapacityCalendar extends AggregateRoot {
    static create(tenantId, input) {
        const calendar = new SupplierCapacityCalendar(tenantId, {
            supplierId: input.supplierId,
            sku: input.sku?.trim().toUpperCase() || null,
            name: input.name?.trim() || `Capacity ${input.supplierId}`,
            defaultWeeklyCapacity: assertQty("defaultWeeklyCapacity", input.defaultWeeklyCapacity ?? 0),
            weeks: [],
        });
        if (input.weeks)
            calendar.setWeeks(input.weeks);
        calendar.raiseChanged();
        return calendar;
    }
    get supplierId() {
        return this.props.supplierId;
    }
    get sku() {
        return this.props.sku;
    }
    get weeks() {
        return this.props.weeks;
    }
    get defaultWeeklyCapacity() {
        return this.props.defaultWeeklyCapacity;
    }
    /** Upsert explicit week entries (normalized to Mondays). */
    setWeeks(entries) {
        if (entries.length === 0) {
            throw new DomainError("At least one capacity week is required", "VALIDATION");
        }
        const byWeek = new Map(this.props.weeks.map((w) => [w.weekStart, w.capacityQty]));
        for (const entry of entries) {
            const week = startOfIsoWeek(isoDate(entry.weekStart));
            byWeek.set(week, assertQty("capacityQty", entry.capacityQty));
        }
        this.props = {
            ...this.props,
            weeks: [...byWeek.entries()]
                .map(([weekStart, capacityQty]) => ({ weekStart: weekStart, capacityQty }))
                .sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1)),
        };
        this.raiseChanged();
    }
    setDefaultWeeklyCapacity(qty) {
        this.props = { ...this.props, defaultWeeklyCapacity: assertQty("defaultWeeklyCapacity", qty) };
        this.raiseChanged();
    }
    capacityFor(weekStart) {
        const explicit = this.props.weeks.find((w) => w.weekStart === weekStart);
        return explicit ? explicit.capacityQty : this.props.defaultWeeklyCapacity;
    }
    raiseChanged() {
        this.raise(envelope({
            eventType: SupplyChainEvents.SupplierCapacityChanged,
            aggregateType: "SupplierCapacityCalendar",
            aggregateId: this.id,
            tenantId: this.tenantId,
            payload: {
                calendarId: this.id,
                supplierId: this.props.supplierId,
                sku: this.props.sku,
                weekCount: this.props.weeks.length,
                defaultWeeklyCapacity: this.props.defaultWeeklyCapacity,
            },
        }));
    }
}
//# sourceMappingURL=supplier-calendar.js.map