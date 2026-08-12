import { type TenantContext } from "@enterprise-suite/shared-kernel";
import { PostingPeriod } from "../domain/period.js";
import type { PeriodRepository } from "../infrastructure/repositories.js";
import type { EventOutbox } from "../infrastructure/outbox.js";
export declare class PeriodService {
    private readonly periods;
    private readonly outbox;
    constructor(periods: PeriodRepository, outbox: EventOutbox);
    openPeriod(ctx: TenantContext, command: {
        fiscalYear: number;
        periodNo: number;
        startDate: string;
        endDate: string;
    }): Promise<PostingPeriod>;
    /** Convenience: opens all 12 calendar-month periods of a fiscal year. */
    openCalendarYear(ctx: TenantContext, fiscalYear: number): Promise<PostingPeriod[]>;
    getPeriod(ctx: TenantContext, code: string): Promise<PostingPeriod>;
    listPeriods(ctx: TenantContext, fiscalYear?: number): Promise<PostingPeriod[]>;
    /** Resolves the period a document date falls into, failing when none exists. */
    resolvePeriodForDate(ctx: TenantContext, date: string): Promise<PostingPeriod>;
}
//# sourceMappingURL=period-service.d.ts.map