import { DomainError, NotFoundError, } from "@enterprise-suite/shared-kernel";
import { Allocation } from "../domain/allocation.js";
import { computeAtp, computeCtp } from "../domain/atp.js";
import { addDays, bucketize, isoDate, makeWeeklyCalendar } from "../domain/calendar.js";
import { makeInventoryRecord, makeScheduledReceipt } from "../domain/records.js";
import { assertQty } from "../domain/types.js";
export class AtpService {
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    /**
     * Discrete ATP for an item/location. Supply = on-hand + open scheduled
     * receipts + FIRMED planned orders from the latest supply plan (PLANNED
     * orders are not committed supply and are deliberately excluded; RELEASED
     * ones re-enter as purchase/work order receipts pushed by downstream).
     * Demand = active allocations.
     */
    async atpReport(ctx, sku, location, weeks) {
        const normalizedSku = sku?.trim().toUpperCase();
        if (!normalizedSku)
            throw new DomainError("sku is required", "VALIDATION");
        const calendar = makeWeeklyCalendar(this.deps.clock.today(), weeks);
        const inventory = await this.deps.inventory.find(ctx.tenantId, normalizedSku, location);
        const receipts = await this.deps.receipts.listFor(ctx.tenantId, normalizedSku, location);
        const supply = bucketize(calendar, receipts.map((r) => ({ date: r.dueDate, qty: r.qty })), { includePastDueInFirstBucket: true });
        const latestPlan = await this.deps.plans.findLatestFor(ctx.tenantId, normalizedSku, location);
        if (latestPlan) {
            const firmed = bucketize(calendar, latestPlan.firmedOrders().map((o) => ({ date: o.dueDate, qty: o.qty })), { includePastDueInFirstBucket: true });
            for (let i = 0; i < supply.length; i += 1)
                supply[i] += firmed[i];
        }
        const allocations = await this.deps.allocations.listActiveFor(ctx.tenantId, normalizedSku, location);
        const demand = bucketize(calendar, allocations.map((a) => ({ date: a.needDate, qty: a.qty })), { includePastDueInFirstBucket: true });
        return computeAtp({ calendar, onHand: inventory?.onHandQty ?? 0, supply, demand });
    }
    /**
     * Capable-to-promise: ATP first, then supplier capacity (offset by the
     * item lead time) for the remainder. Simplification: capacity is taken as
     * the calendar's gross weekly commitment; use the capacity load report for
     * a load-netted view before firming large promises.
     */
    async ctp(ctx, input) {
        const qty = assertQty("qty", input.qty, { allowZero: false });
        const needDate = isoDate(input.needDate);
        const weeks = input.horizonWeeks ?? 12;
        const normalizedSku = input.sku?.trim().toUpperCase();
        const item = await this.deps.items.findBySku(ctx.tenantId, normalizedSku);
        const atp = await this.atpReport(ctx, normalizedSku, input.location, weeks);
        let capacity = [];
        let leadTimeDays = item?.leadTimeDays ?? 0;
        if (item?.procurementType === "BUY" && item.preferredSupplierId) {
            const calendar = await this.deps.calendars.findFor(ctx.tenantId, item.preferredSupplierId, item.sku);
            if (calendar) {
                const horizon = makeWeeklyCalendar(this.deps.clock.today(), weeks);
                capacity = horizon.weekStarts.map((weekStart) => ({
                    weekStart,
                    availableQty: calendar.capacityFor(weekStart),
                }));
            }
        }
        const result = computeCtp(atp, { qty, needDate }, { leadTimeDays, capacity, addDays });
        return { ...result, atp };
    }
    async createAllocation(ctx, input) {
        const allocation = Allocation.create(ctx.tenantId, input);
        const atp = await this.atpReport(ctx, allocation.sku, allocation.location, 12);
        const needDate = allocation.needDate;
        let cumulative = 0;
        for (const row of atp) {
            if (row.weekStart <= needDate)
                cumulative = row.cumulativeAtp;
            else
                break;
        }
        if (!input.force && cumulative < allocation.qty) {
            throw new DomainError(`Insufficient ATP: ${cumulative} available by ${needDate}, requested ${allocation.qty}. ` +
                `Use force=true to override or run CTP for an achievable date.`, "INSUFFICIENT_ATP", 422, { atpAtNeedDate: cumulative, requested: allocation.qty });
        }
        await this.deps.allocations.save(allocation);
        await this.deps.outbox.publish(allocation.pullEvents());
        return { allocation, atpAtNeedDate: cumulative };
    }
    async cancelAllocation(ctx, id) {
        const allocation = await this.deps.allocations.findById(ctx.tenantId, id);
        if (!allocation)
            throw new NotFoundError("Allocation", id);
        allocation.cancel();
        await this.deps.allocations.save(allocation);
        await this.deps.outbox.publish(allocation.pullEvents());
        return allocation;
    }
    async listAllocations(ctx, filter) {
        return this.deps.allocations.list(ctx.tenantId, filter);
    }
    /** Inventory + scheduled receipt projections (integration inbox). */
    async upsertInventory(ctx, input) {
        await this.deps.inventory.upsert(makeInventoryRecord(ctx.tenantId, input));
    }
    async addScheduledReceipt(ctx, input) {
        const receipt = makeScheduledReceipt(ctx.tenantId, input);
        await this.deps.receipts.save(receipt);
        return receipt.id;
    }
    async removeScheduledReceipt(ctx, id) {
        const removed = await this.deps.receipts.delete(ctx.tenantId, id);
        if (!removed)
            throw new NotFoundError("ScheduledReceipt", id);
    }
}
//# sourceMappingURL=atp-service.js.map