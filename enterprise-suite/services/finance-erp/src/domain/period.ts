import {
  AggregateRoot,
  envelope,
  err,
  ok,
  nowIso,
  type IsoDateTime,
  type Result,
  type TenantId,
  type UserId,
} from "@enterprise-suite/shared-kernel";
import { isIsoDate, newPeriodId, type IsoDate, type PeriodId } from "./ids.js";
import { FinanceEventTypes } from "./events.js";

export type PeriodStatus = "OPEN" | "CLOSING" | "CLOSED";

export interface PostingPeriodProps {
  /** Canonical code "YYYY-PP", e.g. "2026-03". Period 13 is the year-end adjustment period. */
  code: string;
  fiscalYear: number;
  periodNo: number;
  startDate: IsoDate;
  endDate: IsoDate;
  status: PeriodStatus;
  closedAt?: IsoDateTime;
  closedBy?: UserId;
}

export function periodCode(fiscalYear: number, periodNo: number): string {
  return `${fiscalYear}-${String(periodNo).padStart(2, "0")}`;
}

export class PostingPeriod extends AggregateRoot<PostingPeriodProps> {
  private constructor(tenantId: TenantId, props: PostingPeriodProps, id?: PeriodId) {
    super(tenantId, props, id ? { id } : undefined);
  }

  static open(tenantId: TenantId, input: {
    fiscalYear: number;
    periodNo: number;
    startDate: string;
    endDate: string;
  }): Result<PostingPeriod> {
    if (!Number.isInteger(input.fiscalYear) || input.fiscalYear < 1900 || input.fiscalYear > 9999) {
      return err(`fiscalYear ${input.fiscalYear} is out of range`);
    }
    if (!Number.isInteger(input.periodNo) || input.periodNo < 1 || input.periodNo > 13) {
      return err(`periodNo must be 1-13 (13 = year-end adjustments), got ${input.periodNo}`);
    }
    if (!isIsoDate(input.startDate) || !isIsoDate(input.endDate)) {
      return err("startDate and endDate must be ISO dates (yyyy-mm-dd)");
    }
    if (input.startDate > input.endDate) {
      return err(`startDate ${input.startDate} is after endDate ${input.endDate}`);
    }
    const period = new PostingPeriod(tenantId, {
      code: periodCode(input.fiscalYear, input.periodNo),
      fiscalYear: input.fiscalYear,
      periodNo: input.periodNo,
      startDate: input.startDate,
      endDate: input.endDate,
      status: "OPEN",
    }, newPeriodId());
    period.raise(envelope({
      eventType: FinanceEventTypes.PeriodOpened,
      aggregateType: "PostingPeriod",
      aggregateId: period.id,
      tenantId,
      payload: { periodCode: period.code, startDate: input.startDate, endDate: input.endDate },
    }));
    return ok(period);
  }

  get code(): string { return this.props.code; }
  get fiscalYear(): number { return this.props.fiscalYear; }
  get periodNo(): number { return this.props.periodNo; }
  get startDate(): IsoDate { return this.props.startDate; }
  get endDate(): IsoDate { return this.props.endDate; }
  get status(): PeriodStatus { return this.props.status; }

  containsDate(date: IsoDate): boolean {
    return date >= this.props.startDate && date <= this.props.endDate;
  }

  /** Journals may only be posted while the period is OPEN or in soft-close (CLOSING allows system sources). */
  acceptsPosting(source: string): boolean {
    if (this.props.status === "OPEN") return true;
    if (this.props.status === "CLOSING") return source === "ALLOCATION" || source === "CLOSING";
    return false;
  }

  beginClose(): Result<void> {
    if (this.props.status !== "OPEN") {
      return err(`period ${this.props.code} is ${this.props.status}, only OPEN can begin close`);
    }
    this.props = { ...this.props, status: "CLOSING" };
    this.raise(envelope({
      eventType: FinanceEventTypes.PeriodCloseStarted,
      aggregateType: "PostingPeriod",
      aggregateId: this.id,
      tenantId: this.tenantId,
      payload: { periodCode: this.props.code },
    }));
    return ok(undefined);
  }

  /** Abort a soft close and return the period to OPEN without emitting close events. */
  cancelClose(): Result<void> {
    if (this.props.status !== "CLOSING") {
      return err(`period ${this.props.code} is ${this.props.status}, only CLOSING can cancel close`);
    }
    this.props = { ...this.props, status: "OPEN" };
    this.touch();
    return ok(undefined);
  }

  completeClose(closedBy: UserId, summary: {
    totalDebitMinor: number;
    totalCreditMinor: number;
    journalCount: number;
  }): Result<void> {
    if (this.props.status !== "CLOSING") {
      return err(`period ${this.props.code} is ${this.props.status}, close must be started first`);
    }
    this.props = { ...this.props, status: "CLOSED", closedAt: nowIso(), closedBy };
    this.raise(envelope({
      eventType: FinanceEventTypes.PeriodClosed,
      aggregateType: "PostingPeriod",
      aggregateId: this.id,
      tenantId: this.tenantId,
      payload: {
        periodCode: this.props.code,
        fiscalYear: this.props.fiscalYear,
        periodNo: this.props.periodNo,
        ...summary,
      },
    }));
    return ok(undefined);
  }

  reopen(reason: string): Result<void> {
    if (this.props.status !== "CLOSED") {
      return err(`period ${this.props.code} is ${this.props.status}, only CLOSED can reopen`);
    }
    if (reason.trim().length === 0) {
      return err("a reason is required to reopen a closed period");
    }
    this.props = { ...this.props, status: "OPEN", closedAt: undefined, closedBy: undefined };
    this.raise(envelope({
      eventType: FinanceEventTypes.PeriodReopened,
      aggregateType: "PostingPeriod",
      aggregateId: this.id,
      tenantId: this.tenantId,
      payload: { periodCode: this.props.code, reason: reason.trim() },
    }));
    return ok(undefined);
  }
}
