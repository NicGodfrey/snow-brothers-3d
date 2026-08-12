import { DomainError, NotFoundError, } from "@enterprise-suite/shared-kernel";
import { bucketize, makeWeeklyCalendar } from "../domain/calendar.js";
import { residualForecast } from "../domain/demand-forecast.js";
import { computeLowLevelCodes, itemsByLevel } from "../domain/low-level-code.js";
import { netItem } from "../domain/mrp.js";
import { effectiveQtyPer } from "../domain/planning-item.js";
import { PlanningRun } from "../domain/planning-run.js";
import { weeklyStdDev } from "../domain/safety-stock.js";
import { SupplyPlan } from "../domain/supply-plan.js";
import { roundQty } from "../domain/types.js";
export class PlanningService {
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    async createRun(ctx, input) {
        const run = PlanningRun.create(ctx.tenantId, input);
        await this.deps.runs.save(run);
        return run;
    }
    async getRun(ctx, id) {
        const run = await this.deps.runs.findById(ctx.tenantId, id);
        if (!run)
            throw new NotFoundError("PlanningRun", id);
        return run;
    }
    async listRuns(ctx) {
        return this.deps.runs.list(ctx.tenantId);
    }
    /**
     * Executes multi-level MRP for the run's scope:
     *
     *  1. resolve the item set (scope + full BOM closure) and low-level codes
     *  2. seed independent demand: residual published forecast + active
     *     allocations, per item
     *  3. per LLC level, net each item (gross - scheduled receipts - on-hand,
     *     respecting safety stock and lot-sizing), then explode planned order
     *     releases into component gross requirements for deeper levels
     *  4. persist one SupplyPlan per item and a full audit trail on the run
     *
     * Firmed/released planned orders from each item's previous plan are treated
     * as scheduled receipts, so planner commitments survive regeneration.
     */
    async executeRun(ctx, runId) {
        const run = await this.getRun(ctx, runId);
        run.start();
        await this.deps.runs.save(run);
        await this.deps.outbox.publish(run.pullEvents());
        const startedMs = this.deps.clock.now().getTime();
        try {
            const stats = await this.plan(ctx, run);
            run.complete({ ...stats, elapsedMs: this.deps.clock.now().getTime() - startedMs });
            await this.deps.runs.save(run);
            await this.deps.outbox.publish(run.pullEvents());
            return run;
        }
        catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            run.fail(reason);
            await this.deps.runs.save(run);
            await this.deps.outbox.publish(run.pullEvents());
            throw error;
        }
    }
    async plan(ctx, run) {
        const calendar = makeWeeklyCalendar(this.deps.clock.today(), run.horizonWeeks);
        run.log("INFO", "Planning calendar built", {
            start: calendar.start,
            end: calendar.end,
            weeks: calendar.weekCount,
        });
        const items = await this.resolveScope(ctx, run);
        if (items.length === 0) {
            throw new DomainError("Planning scope resolves to zero active items", "EMPTY_SCOPE", 422);
        }
        const codes = computeLowLevelCodes(items);
        const levels = itemsByLevel(items, codes);
        run.log("INFO", "Item scope resolved", {
            itemCount: items.length,
            levels: levels.map((level, i) => ({ level: i, items: level.map((item) => item.sku) })),
        });
        // Dependent demand exploded from parent planned orders, keyed by SKU.
        const explodedDemand = new Map();
        const bySku = new Map(items.map((item) => [item.sku, item]));
        let itemsPlanned = 0;
        let ordersCreated = 0;
        let exceptionCount = 0;
        for (let level = 0; level < levels.length; level += 1) {
            for (const item of levels[level]) {
                const gross = await this.grossRequirements(ctx, run, item, calendar, explodedDemand.get(item.sku));
                const scheduled = await this.scheduledReceipts(ctx, run.location, item, calendar);
                const inventory = await this.deps.inventory.find(ctx.tenantId, item.sku, run.location);
                if (!inventory) {
                    run.log("WARN", `No inventory record for ${item.sku} at ${run.location}; assuming zero on-hand`, {
                        sku: item.sku,
                    });
                }
                const onHand = inventory?.onHandQty ?? 0;
                const safetyStock = await this.safetyStockFor(ctx, run, item, gross);
                const result = netItem({
                    sku: item.sku,
                    calendar,
                    onHand,
                    safetyStock,
                    leadTimeDays: item.leadTimeDays,
                    lotSizing: item.lotSizing,
                    grossRequirements: gross,
                    scheduledReceipts: scheduled,
                });
                const exceptions = [...result.exceptions];
                if (item.procurementType === "BUY") {
                    exceptions.push(...(await this.checkSupplierCapacity(ctx, run, item, calendar, result.plannedOrders)));
                }
                const plan = SupplyPlan.create(ctx.tenantId, {
                    runId: run.id,
                    sku: item.sku,
                    location: run.location,
                    horizonStart: calendar.start,
                    weekCount: calendar.weekCount,
                    safetyStock,
                    rows: result.rows,
                    exceptions,
                    orders: result.plannedOrders.map((proposal) => ({
                        orderType: item.procurementType === "BUY" ? "PURCHASE" : "PRODUCTION",
                        qty: proposal.qty,
                        dueDate: proposal.dueDate,
                        releaseDate: proposal.releaseDate,
                        supplierId: item.procurementType === "BUY" ? item.preferredSupplierId : null,
                        unitCost: item.standardCost,
                        pastDue: proposal.pastDue,
                    })),
                });
                await this.deps.plans.save(plan);
                await this.deps.outbox.publish(plan.pullEvents());
                this.explodeIntoComponents(run, item, calendar, result.plannedOrders, bySku, explodedDemand);
                itemsPlanned += 1;
                ordersCreated += result.plannedOrders.length;
                exceptionCount += exceptions.length;
                run.log(exceptions.some((e) => e.severity === "ERROR") ? "WARN" : "INFO", `Planned ${item.sku}`, {
                    sku: item.sku,
                    level,
                    onHand,
                    safetyStock,
                    totalGross: roundQty(gross.reduce((s, v) => s + v, 0)),
                    plannedOrders: result.plannedOrders.length,
                    exceptions: exceptions.map((e) => e.code),
                    planId: plan.id,
                });
            }
        }
        return { itemsPlanned, ordersCreated, exceptionCount, levelsProcessed: levels.length };
    }
    /** Scope items plus every BOM descendant, active items only. */
    async resolveScope(ctx, run) {
        const active = await this.deps.items.listActive(ctx.tenantId);
        if (run.scope.type === "ALL_ITEMS")
            return active;
        const bySku = new Map(active.map((item) => [item.sku, item]));
        const selected = new Map();
        const queue = [...run.scope.skus];
        while (queue.length > 0) {
            const sku = queue.pop();
            if (selected.has(sku))
                continue;
            const item = bySku.get(sku);
            if (!item) {
                run.log("WARN", `Scoped SKU ${sku} is not an active planning item; skipping`, { sku });
                continue;
            }
            selected.set(sku, item);
            for (const line of item.bom)
                queue.push(line.componentSku);
        }
        return [...selected.values()];
    }
    /** Independent demand (residual forecast + allocations) plus exploded dependent demand. */
    async grossRequirements(ctx, run, item, calendar, exploded) {
        const forecast = await this.deps.forecasts.findPublished(ctx.tenantId, item.sku, run.location);
        const forecastByBucket = forecast
            ? bucketize(calendar, forecast.entries.map((e) => ({ date: e.weekStart, qty: e.qty })))
            : new Array(calendar.weekCount).fill(0);
        const allocations = await this.deps.allocations.listActiveFor(ctx.tenantId, item.sku, run.location);
        const actualsByBucket = bucketize(calendar, allocations.map((a) => ({ date: a.needDate, qty: a.qty })), { includePastDueInFirstBucket: true });
        const residual = residualForecast(forecastByBucket, actualsByBucket);
        return calendar.weekStarts.map((_, i) => roundQty(residual[i] + actualsByBucket[i] + (exploded?.[i] ?? 0)));
    }
    /** Open external receipts plus firmed planned orders from the item's previous plan. */
    async scheduledReceipts(ctx, location, item, calendar) {
        const receipts = await this.deps.receipts.listFor(ctx.tenantId, item.sku, location);
        const totals = bucketize(calendar, receipts.map((r) => ({ date: r.dueDate, qty: r.qty })), { includePastDueInFirstBucket: true });
        const previousPlan = await this.deps.plans.findLatestFor(ctx.tenantId, item.sku, location);
        if (previousPlan) {
            const firmed = bucketize(calendar, previousPlan.firmedOrders().map((o) => ({ date: o.dueDate, qty: o.qty })), { includePastDueInFirstBucket: true });
            for (let i = 0; i < totals.length; i += 1)
                totals[i] = roundQty(totals[i] + firmed[i]);
        }
        return totals;
    }
    async safetyStockFor(ctx, run, item, gross) {
        if (!item.safetyStockPolicyId)
            return 0;
        const policy = await this.deps.policies.findById(ctx.tenantId, item.safetyStockPolicyId);
        if (!policy) {
            run.log("WARN", `Safety stock policy ${item.safetyStockPolicyId} for ${item.sku} not found; using zero`, {
                sku: item.sku,
            });
            return 0;
        }
        const context = {
            avgWeeklyDemand: gross.length > 0 ? gross.reduce((s, v) => s + v, 0) / gross.length : 0,
            weeklyDemandStdDev: weeklyStdDev(gross),
            leadTimeDays: item.leadTimeDays,
        };
        return policy.compute(context);
    }
    /**
     * Per-item capacity sanity check: new purchase planned orders vs. the
     * supplier's weekly commitment. Cross-item load is available through the
     * capacity load report; here we only flag weeks where this item alone
     * already exceeds the calendar.
     */
    async checkSupplierCapacity(ctx, run, item, calendar, proposals) {
        if (!item.preferredSupplierId || proposals.length === 0)
            return [];
        const supplierCalendar = await this.deps.calendars.findFor(ctx.tenantId, item.preferredSupplierId, item.sku);
        if (!supplierCalendar)
            return [];
        const byWeek = new Array(calendar.weekCount).fill(0);
        for (const proposal of proposals)
            byWeek[proposal.dueIndex] += proposal.qty;
        const exceptions = [];
        for (let t = 0; t < calendar.weekCount; t += 1) {
            if (byWeek[t] <= 0)
                continue;
            const capacity = supplierCalendar.capacityFor(calendar.weekStarts[t]);
            if (byWeek[t] > capacity) {
                const message = `${item.sku}: planned purchases of ${roundQty(byWeek[t])} in week ${calendar.weekStarts[t]} exceed ` +
                    `supplier ${item.preferredSupplierId} capacity of ${capacity}`;
                exceptions.push({
                    code: "SUPPLIER_CAPACITY_OVERLOAD",
                    severity: "WARNING",
                    weekStart: calendar.weekStarts[t],
                    message,
                });
                run.log("WARN", message, { sku: item.sku, supplierId: item.preferredSupplierId });
            }
        }
        return exceptions;
    }
    explodeIntoComponents(run, item, calendar, proposals, bySku, explodedDemand) {
        if (item.bom.length === 0 || proposals.length === 0)
            return;
        for (const line of item.bom) {
            if (!bySku.has(line.componentSku)) {
                run.log("WARN", `Component ${line.componentSku} of ${item.sku} is not under planning control; demand not exploded`, {
                    parent: item.sku,
                    component: line.componentSku,
                });
                continue;
            }
            const target = explodedDemand.get(line.componentSku) ?? new Array(calendar.weekCount).fill(0);
            for (const proposal of proposals) {
                target[proposal.releaseIndex] = roundQty(target[proposal.releaseIndex] + proposal.qty * effectiveQtyPer(line));
            }
            explodedDemand.set(line.componentSku, target);
        }
    }
}
//# sourceMappingURL=planning-service.js.map