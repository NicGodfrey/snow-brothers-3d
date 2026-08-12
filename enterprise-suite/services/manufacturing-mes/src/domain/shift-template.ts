import {
  AggregateRoot,
  DomainError,
  envelope,
  type TenantId,
} from "@enterprise-suite/shared-kernel";
import { MesEvents } from "./events.js";
import { asUlid } from "./ids.js";

/** 0 = Sunday … 6 = Saturday, matching JS Date.getUTCDay(). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export const ALL_WEEKDAYS: readonly Weekday[] = [0, 1, 2, 3, 4, 5, 6];
export const MON_TO_FRI: readonly Weekday[] = [1, 2, 3, 4, 5];

export interface Shift {
  readonly name: string;
  /** Minutes after midnight, 0–1439. */
  readonly startMinuteOfDay: number;
  /** Total shift length in minutes. Must fit within the day. */
  readonly durationMinutes: number;
  /** Unpaid/unproductive break minutes inside the shift. */
  readonly breakMinutes: number;
  readonly daysOfWeek: readonly Weekday[];
}

export interface ShiftTemplateProps {
  code: string;
  name: string;
  shifts: Shift[];
}

export interface ShiftInput {
  name: string;
  /** "HH:MM" 24h clock. */
  startTime: string;
  durationMinutes: number;
  breakMinutes?: number;
  daysOfWeek: Weekday[];
}

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseTimeToMinutes(time: string): number {
  const match = TIME_PATTERN.exec(time);
  if (!match) {
    throw new DomainError(`Invalid time '${time}', expected HH:MM`, "SHIFT_INVALID_TIME");
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

export class ShiftTemplate extends AggregateRoot<ShiftTemplateProps> {
  private constructor(tenantId: TenantId, props: ShiftTemplateProps) {
    super(tenantId, props);
  }

  static create(
    tenantId: TenantId,
    input: { code: string; name: string; shifts: ShiftInput[] },
  ): ShiftTemplate {
    if (!input.code.trim()) {
      throw new DomainError("Shift template code is required", "SHIFT_TEMPLATE_INVALID_CODE");
    }
    if (input.shifts.length === 0) {
      throw new DomainError("Shift template needs at least one shift", "SHIFT_TEMPLATE_EMPTY");
    }
    const shifts = input.shifts.map(ShiftTemplate.toShift);
    ShiftTemplate.assertNoOverlaps(shifts);

    const template = new ShiftTemplate(tenantId, {
      code: input.code.trim().toUpperCase(),
      name: input.name.trim() || input.code.trim(),
      shifts,
    });
    template.raise(
      envelope({
        eventType: MesEvents.ShiftTemplateCreated,
        aggregateType: "ShiftTemplate",
        aggregateId: asUlid(template.id),
        tenantId,
        payload: { code: template.props.code, shiftCount: shifts.length },
      }),
    );
    return template;
  }

  private static toShift(input: ShiftInput): Shift {
    const start = parseTimeToMinutes(input.startTime);
    if (input.durationMinutes < 1) {
      throw new DomainError("Shift duration must be >= 1 minute", "SHIFT_INVALID_DURATION");
    }
    if (start + input.durationMinutes > 24 * 60) {
      throw new DomainError(
        `Shift '${input.name}' runs past midnight; split it into two shifts`,
        "SHIFT_CROSSES_MIDNIGHT",
      );
    }
    const breakMinutes = input.breakMinutes ?? 0;
    if (breakMinutes < 0 || breakMinutes >= input.durationMinutes) {
      throw new DomainError(
        "Break minutes must be >= 0 and shorter than the shift",
        "SHIFT_INVALID_BREAK",
      );
    }
    if (input.daysOfWeek.length === 0) {
      throw new DomainError(`Shift '${input.name}' has no active weekdays`, "SHIFT_NO_DAYS");
    }
    const uniqueDays = [...new Set(input.daysOfWeek)].sort((a, b) => a - b) as Weekday[];
    return {
      name: input.name.trim() || "Shift",
      startMinuteOfDay: start,
      durationMinutes: input.durationMinutes,
      breakMinutes,
      daysOfWeek: uniqueDays,
    };
  }

  private static assertNoOverlaps(shifts: readonly Shift[]): void {
    for (const day of ALL_WEEKDAYS) {
      const onDay = shifts
        .filter((s) => s.daysOfWeek.includes(day))
        .sort((a, b) => a.startMinuteOfDay - b.startMinuteOfDay);
      for (let i = 1; i < onDay.length; i += 1) {
        const prev = onDay[i - 1]!;
        const curr = onDay[i]!;
        if (prev.startMinuteOfDay + prev.durationMinutes > curr.startMinuteOfDay) {
          throw new DomainError(
            `Shifts '${prev.name}' and '${curr.name}' overlap on weekday ${day}`,
            "SHIFT_OVERLAP",
          );
        }
      }
    }
  }

  get code(): string {
    return this.props.code;
  }

  get shifts(): readonly Shift[] {
    return this.props.shifts;
  }

  /** Productive minutes (duration minus breaks) on the given weekday. */
  netMinutesOn(weekday: Weekday): number {
    return this.props.shifts
      .filter((s) => s.daysOfWeek.includes(weekday))
      .reduce((sum, s) => sum + s.durationMinutes - s.breakMinutes, 0);
  }

  /** Total weekly productive minutes — handy for rough-cut capacity. */
  netMinutesPerWeek(): number {
    return ALL_WEEKDAYS.reduce<number>((sum, day) => sum + this.netMinutesOn(day), 0);
  }
}
