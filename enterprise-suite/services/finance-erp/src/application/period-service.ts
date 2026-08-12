import {
  ConflictError,
  NotFoundError,
  type TenantContext,
} from "@enterprise-suite/shared-kernel";
import { PostingPeriod, periodCode } from "../domain/period.js";
import type { PeriodRepository } from "../infrastructure/repositories.js";
import type { EventOutbox } from "../infrastructure/outbox.js";
import { expectOk } from "./service-support.js";

export class PeriodService {
  constructor(
    private readonly periods: PeriodRepository,
    private readonly outbox: EventOutbox,
  ) {}

  async openPeriod(ctx: TenantContext, command: {
    fiscalYear: number;
    periodNo: number;
    startDate: string;
    endDate: string;
  }): Promise<PostingPeriod> {
    const code = periodCode(command.fiscalYear, command.periodNo);
    const existing = await this.periods.findByCode(ctx.tenantId, code);
    if (existing) throw new ConflictError(`period ${code} already exists`);

    const overlapping = (await this.periods.list(ctx.tenantId)).find(
      (p) => command.startDate <= p.endDate && command.endDate >= p.startDate && p.periodNo !== 13,
    );
    if (overlapping && command.periodNo !== 13) {
      throw new ConflictError(
        `date range overlaps existing period ${overlapping.code} (${overlapping.startDate}..${overlapping.endDate})`,
      );
    }

    const period = expectOk(PostingPeriod.open(ctx.tenantId, command));
    await this.periods.save(period);
    this.outbox.publishAll(period.pullEvents());
    return period;
  }

  /** Convenience: opens all 12 calendar-month periods of a fiscal year. */
  async openCalendarYear(ctx: TenantContext, fiscalYear: number): Promise<PostingPeriod[]> {
    const opened: PostingPeriod[] = [];
    for (let month = 1; month <= 12; month++) {
      const start = `${fiscalYear}-${String(month).padStart(2, "0")}-01`;
      const lastDay = new Date(Date.UTC(fiscalYear, month, 0)).getUTCDate();
      const end = `${fiscalYear}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
      opened.push(await this.openPeriod(ctx, {
        fiscalYear,
        periodNo: month,
        startDate: start,
        endDate: end,
      }));
    }
    return opened;
  }

  async getPeriod(ctx: TenantContext, code: string): Promise<PostingPeriod> {
    const period = await this.periods.findByCode(ctx.tenantId, code);
    if (!period) throw new NotFoundError("PostingPeriod", code);
    return period;
  }

  async listPeriods(ctx: TenantContext, fiscalYear?: number): Promise<PostingPeriod[]> {
    return this.periods.list(ctx.tenantId, fiscalYear);
  }

  /** Resolves the period a document date falls into, failing when none exists. */
  async resolvePeriodForDate(ctx: TenantContext, date: string): Promise<PostingPeriod> {
    const period = await this.periods.findByDate(ctx.tenantId, date);
    if (!period) {
      throw new NotFoundError("PostingPeriod (for date)", date);
    }
    return period;
  }
}
