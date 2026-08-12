import {
  AggregateRoot,
  DomainError,
  envelope,
  type TenantId,
} from "@enterprise-suite/shared-kernel";
import { MesEvents } from "./events.js";
import { asUlid, type ShiftTemplateId } from "./ids.js";
import type { ShiftTemplate, Weekday } from "./shift-template.js";

export const CALENDAR_EXCEPTION_TYPES = ["HOLIDAY", "DOWNTIME", "OVERTIME"] as const;
export type CalendarExceptionType = (typeof CALENDAR_EXCEPTION_TYPES)[number];

export interface CalendarException {
  /** ISO date, e.g. "2026-08-12". One exception per date. */
  readonly date: string;
  readonly type: CalendarExceptionType;
  /**
   * HOLIDAY ignores this (day is zeroed).
   * DOWNTIME subtracts these minutes from the template's net minutes.
   * OVERTIME adds these minutes on top of the template's net minutes.
   */
  readonly minutes: number;
  readonly reason: string | null;
}

export interface CapacityCalendarProps {
  code: string;
  name: string;
  shiftTemplateId: ShiftTemplateId;
  exceptions: CalendarException[];
}

const ISO_DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function assertIsoDate(date: string): void {
  if (!ISO_DATE_PATTERN.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new DomainError(`Invalid ISO date '${date}'`, "CALENDAR_INVALID_DATE");
  }
}

export function weekdayOf(isoDate: string): Weekday {
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay() as Weekday;
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export class CapacityCalendar extends AggregateRoot<CapacityCalendarProps> {
  private constructor(tenantId: TenantId, props: CapacityCalendarProps) {
    super(tenantId, props);
  }

  static create(
    tenantId: TenantId,
    input: { code: string; name: string; shiftTemplateId: ShiftTemplateId },
  ): CapacityCalendar {
    if (!input.code.trim()) {
      throw new DomainError("Calendar code is required", "CALENDAR_INVALID_CODE");
    }
    const calendar = new CapacityCalendar(tenantId, {
      code: input.code.trim().toUpperCase(),
      name: input.name.trim() || input.code.trim(),
      shiftTemplateId: input.shiftTemplateId,
      exceptions: [],
    });
    calendar.raise(
      envelope({
        eventType: MesEvents.CapacityCalendarCreated,
        aggregateType: "CapacityCalendar",
        aggregateId: asUlid(calendar.id),
        tenantId,
        payload: { code: calendar.props.code, shiftTemplateId: input.shiftTemplateId },
      }),
    );
    return calendar;
  }

  get code(): string {
    return this.props.code;
  }

  get shiftTemplateId(): ShiftTemplateId {
    return this.props.shiftTemplateId;
  }

  get exceptions(): readonly CalendarException[] {
    return this.props.exceptions;
  }

  addException(input: {
    date: string;
    type: CalendarExceptionType;
    minutes?: number;
    reason?: string;
  }): void {
    assertIsoDate(input.date);
    if (this.props.exceptions.some((e) => e.date === input.date)) {
      throw new DomainError(
        `Calendar already has an exception on ${input.date}`,
        "CALENDAR_EXCEPTION_EXISTS",
        409,
      );
    }
    const minutes = input.minutes ?? 0;
    if (input.type !== "HOLIDAY" && minutes <= 0) {
      throw new DomainError(
        `${input.type} exception requires positive minutes`,
        "CALENDAR_EXCEPTION_MINUTES",
      );
    }
    this.props.exceptions.push({
      date: input.date,
      type: input.type,
      minutes: input.type === "HOLIDAY" ? 0 : minutes,
      reason: input.reason?.trim() || null,
    });
    this.props.exceptions.sort((a, b) => a.date.localeCompare(b.date));
    this.raise(
      envelope({
        eventType: MesEvents.CapacityExceptionAdded,
        aggregateType: "CapacityCalendar",
        aggregateId: asUlid(this.id),
        tenantId: this.tenantId,
        payload: { code: this.props.code, date: input.date, type: input.type },
      }),
    );
  }

  removeException(date: string): void {
    const idx = this.props.exceptions.findIndex((e) => e.date === date);
    if (idx === -1) {
      throw new DomainError(`No calendar exception on ${date}`, "CALENDAR_EXCEPTION_MISSING", 404);
    }
    this.props.exceptions.splice(idx, 1);
    this.raise(
      envelope({
        eventType: MesEvents.CapacityExceptionRemoved,
        aggregateType: "CapacityCalendar",
        aggregateId: asUlid(this.id),
        tenantId: this.tenantId,
        payload: { code: this.props.code, date },
      }),
    );
  }

  /**
   * Productive minutes available on one date, before any work-center
   * capacity factor is applied.
   */
  availableMinutesOn(date: string, template: ShiftTemplate): number {
    assertIsoDate(date);
    const base = template.netMinutesOn(weekdayOf(date));
    const exception = this.props.exceptions.find((e) => e.date === date);
    if (!exception) return base;
    switch (exception.type) {
      case "HOLIDAY":
        return 0;
      case "DOWNTIME":
        return Math.max(0, base - exception.minutes);
      case "OVERTIME":
        return base + exception.minutes;
      default:
        return base;
    }
  }

  /** Inclusive day-by-day availability across a date range. */
  availabilityBetween(
    from: string,
    to: string,
    template: ShiftTemplate,
  ): Array<{ date: string; minutes: number }> {
    assertIsoDate(from);
    assertIsoDate(to);
    if (from > to) {
      throw new DomainError("'from' must not be after 'to'", "CALENDAR_INVALID_RANGE");
    }
    const days: Array<{ date: string; minutes: number }> = [];
    for (let date = from; date <= to; date = addDays(date, 1)) {
      days.push({ date, minutes: this.availableMinutesOn(date, template) });
    }
    return days;
  }
}
