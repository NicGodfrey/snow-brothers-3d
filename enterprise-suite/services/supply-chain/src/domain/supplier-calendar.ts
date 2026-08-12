import {
  AggregateRoot,
  DomainError,
  envelope,
  type TenantId,
} from "@enterprise-suite/shared-kernel";
import { isoDate, startOfIsoWeek } from "./calendar.js";
import { SupplyChainEvents } from "./events.js";
import { assertQty, type IsoDate, type SupplierId } from "./types.js";

export interface CapacityWeek {
  readonly weekStart: IsoDate;
  readonly capacityQty: number;
}

interface SupplierCapacityCalendarProps {
  supplierId: SupplierId;
  /** Optional SKU scope; null means the calendar applies to all items of the supplier. */
  sku: string | null;
  name: string;
  /** Capacity assumed for weeks without an explicit entry. */
  defaultWeeklyCapacity: number;
  weeks: readonly CapacityWeek[];
}

/**
 * Lightweight weekly capacity commitment from a supplier, used to sanity
 * check purchase planned orders during MRP and to answer capable-to-promise.
 * Weeks without an explicit entry fall back to `defaultWeeklyCapacity`.
 */
export class SupplierCapacityCalendar extends AggregateRoot<SupplierCapacityCalendarProps> {
  static create(
    tenantId: TenantId,
    input: {
      supplierId: SupplierId;
      sku?: string;
      name?: string;
      defaultWeeklyCapacity?: number;
      weeks?: readonly { weekStart: string; capacityQty: number }[];
    },
  ): SupplierCapacityCalendar {
    const calendar = new SupplierCapacityCalendar(tenantId, {
      supplierId: input.supplierId,
      sku: input.sku?.trim().toUpperCase() || null,
      name: input.name?.trim() || `Capacity ${input.supplierId}`,
      defaultWeeklyCapacity: assertQty("defaultWeeklyCapacity", input.defaultWeeklyCapacity ?? 0),
      weeks: [],
    });
    if (input.weeks) calendar.setWeeks(input.weeks);
    calendar.raiseChanged();
    return calendar;
  }

  get supplierId(): SupplierId {
    return this.props.supplierId;
  }

  get sku(): string | null {
    return this.props.sku;
  }

  get weeks(): readonly CapacityWeek[] {
    return this.props.weeks;
  }

  get defaultWeeklyCapacity(): number {
    return this.props.defaultWeeklyCapacity;
  }

  /** Upsert explicit week entries (normalized to Mondays). */
  setWeeks(entries: readonly { weekStart: string; capacityQty: number }[]): void {
    if (entries.length === 0) {
      throw new DomainError("At least one capacity week is required", "VALIDATION");
    }
    const byWeek = new Map<string, number>(this.props.weeks.map((w) => [w.weekStart as string, w.capacityQty]));
    for (const entry of entries) {
      const week = startOfIsoWeek(isoDate(entry.weekStart));
      byWeek.set(week, assertQty("capacityQty", entry.capacityQty));
    }
    this.props = {
      ...this.props,
      weeks: [...byWeek.entries()]
        .map(([weekStart, capacityQty]) => ({ weekStart: weekStart as IsoDate, capacityQty }))
        .sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1)),
    };
    this.raiseChanged();
  }

  setDefaultWeeklyCapacity(qty: number): void {
    this.props = { ...this.props, defaultWeeklyCapacity: assertQty("defaultWeeklyCapacity", qty) };
    this.raiseChanged();
  }

  capacityFor(weekStart: IsoDate): number {
    const explicit = this.props.weeks.find((w) => w.weekStart === weekStart);
    return explicit ? explicit.capacityQty : this.props.defaultWeeklyCapacity;
  }

  private raiseChanged(): void {
    this.raise(
      envelope({
        eventType: SupplyChainEvents.SupplierCapacityChanged,
        aggregateType: "SupplierCapacityCalendar",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          calendarId: this.id,
          supplierId: this.props.supplierId,
          sku: this.props.sku,
          weekCount: this.props.weeks.length,
          defaultWeeklyCapacity: this.props.defaultWeeklyCapacity,
        },
      }),
    );
  }
}
