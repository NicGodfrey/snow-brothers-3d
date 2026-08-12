import { ConflictError, NotFoundError, type TenantContext, type TenantId } from "@enterprise-suite/shared-kernel";
import {
  BUSINESS_DAY_RULES,
  HolidayCalendar,
  addDays,
  daysBetween,
  isoDate,
  type BusinessDayRule,
  type IsoDate,
} from "../domain/calendar.js";
import { ValidationError } from "../domain/errors.js";
import type { CalendarRepository } from "./ports.js";

export interface CreateCalendarInput {
  readonly code: string;
  readonly name: string;
  readonly weekendDays?: readonly number[];
  readonly holidays?: readonly string[];
}

export interface CalendarView {
  readonly code: string;
  readonly name: string;
  readonly weekendDays: readonly number[];
  readonly holidays: readonly IsoDate[];
}

const CALENDAR_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,23}$/;

function view(calendar: HolidayCalendar): CalendarView {
  return {
    code: calendar.code,
    name: calendar.name,
    weekendDays: [...calendar.weekendDays].sort((a, b) => a - b),
    holidays: calendar.listHolidays(),
  };
}

/**
 * Working-day calendars.
 *
 * Payment and shipping terms both roll dates onto working days, and the set of
 * working days differs by country and by plant. A tenant keeps one calendar
 * per pattern and terms reference it by code; when a term names no calendar,
 * the Monday-Friday default applies.
 */
export class CalendarService {
  constructor(private readonly calendars: CalendarRepository) {}

  async create(ctx: TenantContext, input: CreateCalendarInput): Promise<CalendarView> {
    const code = input.code.trim().toUpperCase();
    if (!CALENDAR_CODE_PATTERN.test(code)) {
      throw ValidationError.single("code", `invalid calendar code "${input.code}"`);
    }
    if (input.name.trim().length === 0) throw ValidationError.single("name", "name is required");
    if (await this.calendars.byCode(ctx.tenantId, code)) {
      throw new ConflictError(`Calendar ${code} already exists`);
    }
    for (const day of input.weekendDays ?? []) {
      if (!Number.isInteger(day) || day < 0 || day > 6) {
        throw ValidationError.single("weekendDays", "weekend days are 0 (Sunday) through 6 (Saturday)");
      }
    }
    if ((input.weekendDays?.length ?? 0) >= 7) {
      throw ValidationError.single("weekendDays", "a calendar needs at least one working weekday");
    }
    const calendar = new HolidayCalendar({ ...input, code });
    await this.calendars.save(ctx.tenantId, calendar);
    return view(calendar);
  }

  async list(ctx: TenantContext): Promise<readonly CalendarView[]> {
    return (await this.calendars.all(ctx.tenantId)).map(view);
  }

  async get(ctx: TenantContext, code: string): Promise<CalendarView> {
    return view(await this.require(ctx.tenantId, code));
  }

  async addHolidays(ctx: TenantContext, code: string, dates: readonly string[]): Promise<CalendarView> {
    const calendar = await this.require(ctx.tenantId, code);
    for (const date of dates) calendar.addHoliday(date);
    await this.calendars.save(ctx.tenantId, calendar);
    return view(calendar);
  }

  /** Resolves a calendar code, falling back to the Mon-Fri default. */
  async resolve(tenantId: TenantId, code?: string): Promise<HolidayCalendar> {
    if (!code) return HolidayCalendar.standard();
    return this.require(tenantId, code);
  }

  async isBusinessDay(ctx: TenantContext, code: string, date: string): Promise<boolean> {
    const calendar = await this.require(ctx.tenantId, code);
    return calendar.isBusinessDay(isoDate(date));
  }

  async addBusinessDays(
    ctx: TenantContext,
    code: string,
    date: string,
    count: number,
  ): Promise<{ readonly from: IsoDate; readonly to: IsoDate; readonly calendarDays: number }> {
    if (!Number.isInteger(count)) {
      throw ValidationError.single("count", "must be a whole number of business days");
    }
    const calendar = await this.require(ctx.tenantId, code);
    const from = isoDate(date);
    const to = calendar.addBusinessDays(from, count);
    return { from, to, calendarDays: daysBetween(from, to) };
  }

  async adjust(
    ctx: TenantContext,
    code: string,
    date: string,
    rule: BusinessDayRule,
  ): Promise<IsoDate> {
    if (!BUSINESS_DAY_RULES.includes(rule)) {
      throw ValidationError.single("rule", `unknown business day rule "${rule}"`);
    }
    const calendar = await this.require(ctx.tenantId, code);
    return calendar.adjust(isoDate(date), rule);
  }

  /** Working days in a window, inclusive of both ends. */
  async businessDaysBetween(
    ctx: TenantContext,
    code: string,
    from: string,
    to: string,
  ): Promise<number> {
    const calendar = await this.require(ctx.tenantId, code);
    const start = isoDate(from);
    const end = isoDate(to);
    if (daysBetween(start, end) < 0) {
      throw ValidationError.single("to", "the end date must not precede the start date");
    }
    let count = 0;
    for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
      if (calendar.isBusinessDay(cursor)) count += 1;
    }
    return count;
  }

  private async require(tenantId: TenantId, code: string): Promise<HolidayCalendar> {
    const calendar = await this.calendars.byCode(tenantId, code.trim().toUpperCase());
    if (!calendar) throw new NotFoundError("HolidayCalendar", code);
    return calendar;
  }
}
