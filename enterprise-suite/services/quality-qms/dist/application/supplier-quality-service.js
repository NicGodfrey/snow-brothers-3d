/**
 * Supplier quality use-cases: recording events, SCAR lifecycle, and the
 * per-supplier summary consumed by SRM scorecards.
 */
import { NotFoundError, } from "@enterprise-suite/shared-kernel";
import { SupplierQualityEvent, } from "../domain/supplier-quality.js";
import { documentSeries } from "./ports.js";
function bandForDemerits(demerits) {
    if (demerits < 10)
        return "A";
    if (demerits < 30)
        return "B";
    if (demerits < 60)
        return "C";
    return "D";
}
export class SupplierQualityService {
    events;
    outbox;
    numbers;
    clock;
    constructor(events, outbox, numbers, clock) {
        this.events = events;
        this.outbox = outbox;
        this.numbers = numbers;
        this.clock = clock;
    }
    async flush(event) {
        await this.events.save(event);
        await this.outbox.append(event.pullEvents());
    }
    async recordEvent(ctx, cmd) {
        const event = SupplierQualityEvent.create(ctx.tenantId, cmd);
        await this.flush(event);
        return event;
    }
    async acknowledge(ctx, eventId) {
        const event = await this.getEvent(ctx, eventId);
        event.acknowledge();
        await this.flush(event);
        return event;
    }
    async issueScar(ctx, eventId, input) {
        const event = await this.getEvent(ctx, eventId);
        const scarNumber = await this.numbers.next(ctx.tenantId, documentSeries.scar);
        event.issueScar({ scarNumber, issuedBy: ctx.userId, dueAt: input.dueAt });
        await this.flush(event);
        return event;
    }
    async recordScarResponse(ctx, eventId, input) {
        const event = await this.getEvent(ctx, eventId);
        event.recordScarResponse({ ...input, reviewedBy: ctx.userId });
        await this.flush(event);
        return event;
    }
    async resolve(ctx, eventId, note) {
        const event = await this.getEvent(ctx, eventId);
        event.resolve(ctx.userId, note);
        await this.flush(event);
        return event;
    }
    async writeOff(ctx, eventId, reason) {
        const event = await this.getEvent(ctx, eventId);
        event.writeOff(ctx.userId, reason);
        await this.flush(event);
        return event;
    }
    async getEvent(ctx, eventId) {
        const event = await this.events.findById(ctx.tenantId, eventId);
        if (!event)
            throw new NotFoundError("SupplierQualityEvent", eventId);
        return event;
    }
    async listEvents(ctx, filter) {
        return this.events.list(ctx.tenantId, filter);
    }
    async supplierSummary(ctx, supplierId) {
        const events = await this.events.listBySupplier(ctx.tenantId, supplierId);
        const now = this.clock.now();
        const bySeverity = { critical: 0, major: 0, minor: 0 };
        const byType = {};
        let totalDemerits = 0;
        let openEvents = 0;
        let openScars = 0;
        let overdueScars = 0;
        for (const event of events) {
            totalDemerits += event.demeritPoints;
            bySeverity[event.severity] += 1;
            byType[event.eventType] = (byType[event.eventType] ?? 0) + 1;
            if (event.status !== "resolved" && event.status !== "written-off")
                openEvents += 1;
            if (event.scar && !event.scar.respondedAt) {
                openScars += 1;
                if (event.isScarOverdue(now))
                    overdueScars += 1;
            }
        }
        return {
            supplierId,
            totalEvents: events.length,
            openEvents,
            totalDemerits,
            bySeverity,
            byType,
            openScars,
            overdueScars,
            band: bandForDemerits(totalDemerits),
        };
    }
}
//# sourceMappingURL=supplier-quality-service.js.map