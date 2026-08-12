import { NotFoundError, type TenantContext, type Ulid } from "@enterprise-suite/shared-kernel";
import { makeWeeklyCalendar, clampedBucketIndexOf, bucketIndexOf } from "../domain/calendar.js";
import { SupplierCapacityCalendar } from "../domain/supplier-calendar.js";
import { roundQty, supplierId as parseSupplierId, type IsoDate, type SupplierId } from "../domain/types.js";
import type { SupplyChainDeps } from "./ports.js";

export interface CapacityLoadRow {
  readonly weekStart: IsoDate;
  readonly capacityQty: number;
  readonly loadQty: number;
  readonly availableQty: number;
  /** Null when the week has zero capacity (utilization undefined). */
  readonly utilizationPct: number | null;
  readonly overloaded: boolean;
}

export class CapacityService {
  constructor(private readonly deps: SupplyChainDeps) {}

  async createCalendar(
    ctx: TenantContext,
    input: {
      supplierId: string;
      sku?: string;
      name?: string;
      defaultWeeklyCapacity?: number;
      weeks?: readonly { weekStart: string; capacityQty: number }[];
    },
  ): Promise<SupplierCapacityCalendar> {
    const calendar = SupplierCapacityCalendar.create(ctx.tenantId, {
      ...input,
      supplierId: parseSupplierId(input.supplierId),
    });
    await this.deps.calendars.save(calendar);
    await this.deps.outbox.publish(calendar.pullEvents());
    return calendar;
  }

  async getCalendar(ctx: TenantContext, id: Ulid): Promise<SupplierCapacityCalendar> {
    const calendar = await this.deps.calendars.findById(ctx.tenantId, id);
    if (!calendar) throw new NotFoundError("SupplierCapacityCalendar", id);
    return calendar;
  }

  async listCalendars(ctx: TenantContext, supplier?: string): Promise<SupplierCapacityCalendar[]> {
    return this.deps.calendars.list(ctx.tenantId, supplier ? parseSupplierId(supplier) : undefined);
  }

  async setWeeks(
    ctx: TenantContext,
    id: Ulid,
    weeks: readonly { weekStart: string; capacityQty: number }[],
  ): Promise<SupplierCapacityCalendar> {
    const calendar = await this.getCalendar(ctx, id);
    calendar.setWeeks(weeks);
    await this.deps.calendars.save(calendar);
    await this.deps.outbox.publish(calendar.pullEvents());
    return calendar;
  }

  /**
   * Weekly capacity vs. load report for one supplier. Load is the sum of
   * open purchase-order receipts plus non-cancelled purchase planned orders
   * (by due week) across the latest supply plans of items preferring this
   * supplier.
   */
  async loadReport(ctx: TenantContext, supplier: string, weeks: number): Promise<CapacityLoadRow[]> {
    const sid: SupplierId = parseSupplierId(supplier);
    const calendar = makeWeeklyCalendar(this.deps.clock.today(), weeks);
    const load = new Array<number>(calendar.weekCount).fill(0);

    const items = await this.deps.items.listActive(ctx.tenantId);
    const supplierItems = items.filter((i) => i.preferredSupplierId === sid);
    const receipts = await this.deps.receipts.list(ctx.tenantId);
    const supplierSkus = new Set(supplierItems.map((i) => i.sku));

    for (const receipt of receipts) {
      if (!supplierSkus.has(receipt.sku) || receipt.sourceType !== "PURCHASE_ORDER") continue;
      const idx = bucketIndexOf(calendar, receipt.dueDate);
      if (idx >= 0 && idx < calendar.weekCount) load[idx] += receipt.qty;
    }

    for (const item of supplierItems) {
      const plans = await this.deps.plans.list(ctx.tenantId, { sku: item.sku });
      const latest = plans.at(-1);
      if (!latest) continue;
      for (const order of latest.orders) {
        if (order.orderType !== "PURCHASE" || order.status === "CANCELLED") continue;
        const idx = clampedBucketIndexOf(calendar, order.dueDate);
        load[idx] += order.qty;
      }
    }

    const calendars = await this.deps.calendars.list(ctx.tenantId, sid);
    const supplierWide = calendars.find((c) => c.sku === null) ?? calendars[0] ?? null;

    return calendar.weekStarts.map((weekStart, i) => {
      const capacityQty = supplierWide ? supplierWide.capacityFor(weekStart) : 0;
      const loadQty = roundQty(load[i]);
      const availableQty = roundQty(Math.max(0, capacityQty - loadQty));
      return {
        weekStart,
        capacityQty,
        loadQty,
        availableQty,
        utilizationPct: capacityQty > 0 ? Math.round((loadQty / capacityQty) * 1000) / 10 : null,
        overloaded: loadQty > capacityQty,
      };
    });
  }
}
