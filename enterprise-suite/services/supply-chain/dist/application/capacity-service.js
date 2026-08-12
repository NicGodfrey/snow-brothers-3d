import { NotFoundError } from "@enterprise-suite/shared-kernel";
import { makeWeeklyCalendar, clampedBucketIndexOf, bucketIndexOf } from "../domain/calendar.js";
import { SupplierCapacityCalendar } from "../domain/supplier-calendar.js";
import { roundQty, supplierId as parseSupplierId } from "../domain/types.js";
export class CapacityService {
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    async createCalendar(ctx, input) {
        const calendar = SupplierCapacityCalendar.create(ctx.tenantId, {
            ...input,
            supplierId: parseSupplierId(input.supplierId),
        });
        await this.deps.calendars.save(calendar);
        await this.deps.outbox.publish(calendar.pullEvents());
        return calendar;
    }
    async getCalendar(ctx, id) {
        const calendar = await this.deps.calendars.findById(ctx.tenantId, id);
        if (!calendar)
            throw new NotFoundError("SupplierCapacityCalendar", id);
        return calendar;
    }
    async listCalendars(ctx, supplier) {
        return this.deps.calendars.list(ctx.tenantId, supplier ? parseSupplierId(supplier) : undefined);
    }
    async setWeeks(ctx, id, weeks) {
        const calendar = await this.getCalendar(ctx, id);
        calendar.setWeeks(weeks);
        await this.deps.calendars.save(calendar);
        await this.deps.outbox.publish(calendar.pullEvents());
        return calendar;
    }
    /**
     * Weekly capacity vs. load report for one supplier. Load is the sum of
     * open purchase-order receipts plus non-cancelled purchase planned orders
     * (by due week) across the latest supply plans of items preferring this
     * supplier.
     */
    async loadReport(ctx, supplier, weeks) {
        const sid = parseSupplierId(supplier);
        const calendar = makeWeeklyCalendar(this.deps.clock.today(), weeks);
        const load = new Array(calendar.weekCount).fill(0);
        const items = await this.deps.items.listActive(ctx.tenantId);
        const supplierItems = items.filter((i) => i.preferredSupplierId === sid);
        const receipts = await this.deps.receipts.list(ctx.tenantId);
        const supplierSkus = new Set(supplierItems.map((i) => i.sku));
        for (const receipt of receipts) {
            if (!supplierSkus.has(receipt.sku) || receipt.sourceType !== "PURCHASE_ORDER")
                continue;
            const idx = bucketIndexOf(calendar, receipt.dueDate);
            if (idx >= 0 && idx < calendar.weekCount)
                load[idx] += receipt.qty;
        }
        for (const item of supplierItems) {
            const plans = await this.deps.plans.list(ctx.tenantId, { sku: item.sku });
            const latest = plans.at(-1);
            if (!latest)
                continue;
            for (const order of latest.orders) {
                if (order.orderType !== "PURCHASE" || order.status === "CANCELLED")
                    continue;
                const idx = clampedBucketIndexOf(calendar, order.dueDate);
                load[idx] += order.qty;
            }
        }
        const calendars = await this.deps.calendars.list(ctx.tenantId, sid);
        const supplierWide = calendars.find((c) => c.sku === null) ?? calendars[0] ?? null;
        return calendar.weekStarts.map((weekStart, i) => {
            const capacityQty = supplierWide ? supplierWide.capacityFor(weekStart) : 0;
            const loadQty = roundQty(load[i]);
            const availableQty = roundQty(Math.max(0, capacityQty - loadQty));
            return {
                weekStart,
                capacityQty,
                loadQty,
                availableQty,
                utilizationPct: capacityQty > 0 ? Math.round((loadQty / capacityQty) * 1000) / 10 : null,
                overloaded: loadQty > capacityQty,
            };
        });
    }
}
//# sourceMappingURL=capacity-service.js.map