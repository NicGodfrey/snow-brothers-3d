import {
  AggregateRoot,
  DomainError,
  envelope,
  money,
  type Money,
  type TenantId,
} from "@enterprise-suite/shared-kernel";
import { MesEvents } from "./events.js";
import { asUlid, type CapacityCalendarId } from "./ids.js";

export const WORK_CENTER_STATUSES = ["ACTIVE", "INACTIVE", "MAINTENANCE"] as const;
export type WorkCenterStatus = (typeof WORK_CENTER_STATUSES)[number];

export interface WorkCenterRates {
  /** Cost per labor hour, in minor units. */
  readonly laborRatePerHour: Money;
  /** Cost per machine hour, in minor units. */
  readonly machineRatePerHour: Money;
  /** Overhead applied per machine hour, in minor units. */
  readonly overheadRatePerHour: Money;
}

export interface WorkCenterProps {
  code: string;
  name: string;
  description: string | null;
  costCenterCode: string | null;
  status: WorkCenterStatus;
  /** Number of interchangeable machines/stations at this center. */
  machineCount: number;
  /** Realistic output vs. theoretical, 0–100. Applied to capacity. */
  efficiencyPct: number;
  /** Share of calendar time the center is actually loadable, 0–100. */
  utilizationPct: number;
  /** Default queue time in minutes for operations arriving here. */
  defaultQueueMinutes: number;
  rates: WorkCenterRates;
  calendarId: CapacityCalendarId | null;
  tags: string[];
}

export interface CreateWorkCenterInput {
  code: string;
  name: string;
  description?: string;
  costCenterCode?: string;
  machineCount?: number;
  efficiencyPct?: number;
  utilizationPct?: number;
  defaultQueueMinutes?: number;
  currency?: string;
  laborRatePerHourMinor?: number;
  machineRatePerHourMinor?: number;
  overheadRatePerHourMinor?: number;
  tags?: string[];
}

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9\-_]{1,31}$/;

export class WorkCenter extends AggregateRoot<WorkCenterProps> {
  private constructor(tenantId: TenantId, props: WorkCenterProps) {
    super(tenantId, props);
  }

  static create(tenantId: TenantId, input: CreateWorkCenterInput): WorkCenter {
    const code = input.code.trim().toUpperCase();
    if (!CODE_PATTERN.test(code)) {
      throw new DomainError(
        `Work center code '${input.code}' must match ${CODE_PATTERN}`,
        "WORK_CENTER_INVALID_CODE",
      );
    }
    if (!input.name.trim()) {
      throw new DomainError("Work center name is required", "WORK_CENTER_INVALID_NAME");
    }
    const machineCount = input.machineCount ?? 1;
    if (!Number.isInteger(machineCount) || machineCount < 1) {
      throw new DomainError("machineCount must be a positive integer", "WORK_CENTER_INVALID_MACHINES");
    }
    const efficiencyPct = input.efficiencyPct ?? 85;
    const utilizationPct = input.utilizationPct ?? 90;
    for (const [label, pct] of [
      ["efficiencyPct", efficiencyPct],
      ["utilizationPct", utilizationPct],
    ] as const) {
      if (pct <= 0 || pct > 100) {
        throw new DomainError(`${label} must be in (0, 100]`, "WORK_CENTER_INVALID_PCT");
      }
    }
    const currency = input.currency ?? "USD";
    const wc = new WorkCenter(tenantId, {
      code,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      costCenterCode: input.costCenterCode?.trim() || null,
      status: "ACTIVE",
      machineCount,
      efficiencyPct,
      utilizationPct,
      defaultQueueMinutes: input.defaultQueueMinutes ?? 0,
      rates: {
        laborRatePerHour: money(input.laborRatePerHourMinor ?? 0, currency),
        machineRatePerHour: money(input.machineRatePerHourMinor ?? 0, currency),
        overheadRatePerHour: money(input.overheadRatePerHourMinor ?? 0, currency),
      },
      calendarId: null,
      tags: input.tags ?? [],
    });
    wc.raise(
      envelope({
        eventType: MesEvents.WorkCenterCreated,
        aggregateType: "WorkCenter",
        aggregateId: asUlid(wc.id),
        tenantId,
        payload: { code: wc.props.code, name: wc.props.name },
      }),
    );
    return wc;
  }

  get code(): string {
    return this.props.code;
  }

  get status(): WorkCenterStatus {
    return this.props.status;
  }

  get calendarId(): CapacityCalendarId | null {
    return this.props.calendarId;
  }

  get machineCount(): number {
    return this.props.machineCount;
  }

  get rates(): WorkCenterRates {
    return this.props.rates;
  }

  get defaultQueueMinutes(): number {
    return this.props.defaultQueueMinutes;
  }

  /**
   * Effective capacity factor applied to raw calendar minutes:
   * machines * efficiency * utilization.
   */
  capacityFactor(): number {
    return (
      this.props.machineCount *
      (this.props.efficiencyPct / 100) *
      (this.props.utilizationPct / 100)
    );
  }

  isLoadable(): boolean {
    return this.props.status === "ACTIVE";
  }

  update(patch: {
    name?: string;
    description?: string | null;
    costCenterCode?: string | null;
    machineCount?: number;
    efficiencyPct?: number;
    utilizationPct?: number;
    defaultQueueMinutes?: number;
    tags?: string[];
  }): void {
    if (patch.name !== undefined) {
      if (!patch.name.trim()) {
        throw new DomainError("Work center name is required", "WORK_CENTER_INVALID_NAME");
      }
      this.props.name = patch.name.trim();
    }
    if (patch.description !== undefined) this.props.description = patch.description;
    if (patch.costCenterCode !== undefined) this.props.costCenterCode = patch.costCenterCode;
    if (patch.machineCount !== undefined) {
      if (!Number.isInteger(patch.machineCount) || patch.machineCount < 1) {
        throw new DomainError("machineCount must be a positive integer", "WORK_CENTER_INVALID_MACHINES");
      }
      this.props.machineCount = patch.machineCount;
    }
    if (patch.efficiencyPct !== undefined) {
      if (patch.efficiencyPct <= 0 || patch.efficiencyPct > 100) {
        throw new DomainError("efficiencyPct must be in (0, 100]", "WORK_CENTER_INVALID_PCT");
      }
      this.props.efficiencyPct = patch.efficiencyPct;
    }
    if (patch.utilizationPct !== undefined) {
      if (patch.utilizationPct <= 0 || patch.utilizationPct > 100) {
        throw new DomainError("utilizationPct must be in (0, 100]", "WORK_CENTER_INVALID_PCT");
      }
      this.props.utilizationPct = patch.utilizationPct;
    }
    if (patch.defaultQueueMinutes !== undefined) {
      if (patch.defaultQueueMinutes < 0) {
        throw new DomainError("defaultQueueMinutes must be >= 0", "WORK_CENTER_INVALID_QUEUE");
      }
      this.props.defaultQueueMinutes = patch.defaultQueueMinutes;
    }
    if (patch.tags !== undefined) this.props.tags = patch.tags;
    this.raise(
      envelope({
        eventType: MesEvents.WorkCenterUpdated,
        aggregateType: "WorkCenter",
        aggregateId: asUlid(this.id),
        tenantId: this.tenantId,
        payload: { code: this.props.code },
      }),
    );
  }

  setRates(rates: WorkCenterRates): void {
    const currencies = new Set([
      rates.laborRatePerHour.currency,
      rates.machineRatePerHour.currency,
      rates.overheadRatePerHour.currency,
    ]);
    if (currencies.size !== 1) {
      throw new DomainError("All work center rates must share one currency", "WORK_CENTER_RATE_CURRENCY");
    }
    this.props.rates = rates;
    this.raise(
      envelope({
        eventType: MesEvents.WorkCenterUpdated,
        aggregateType: "WorkCenter",
        aggregateId: asUlid(this.id),
        tenantId: this.tenantId,
        payload: { code: this.props.code, ratesChanged: true },
      }),
    );
  }

  changeStatus(next: WorkCenterStatus, reason?: string): void {
    if (next === this.props.status) return;
    const previous = this.props.status;
    this.props.status = next;
    this.raise(
      envelope({
        eventType: MesEvents.WorkCenterStatusChanged,
        aggregateType: "WorkCenter",
        aggregateId: asUlid(this.id),
        tenantId: this.tenantId,
        payload: { code: this.props.code, previous, next, reason: reason ?? null },
      }),
    );
  }

  assignCalendar(calendarId: CapacityCalendarId): void {
    this.props.calendarId = calendarId;
    this.raise(
      envelope({
        eventType: MesEvents.WorkCenterUpdated,
        aggregateType: "WorkCenter",
        aggregateId: asUlid(this.id),
        tenantId: this.tenantId,
        payload: { code: this.props.code, calendarId },
      }),
    );
  }
}
