import {
  AggregateRoot,
  DomainError,
  envelope,
  mulMoney,
  type Money,
  type TenantId,
  type Ulid,
  newId,
} from "@enterprise-suite/shared-kernel";
import { SupplyChainEvents, type PlannedOrderReleasedPayload } from "./events.js";
import type { MrpException, MrpRow } from "./mrp.js";
import type { IsoDate, LocationCode, SupplierId } from "./types.js";

export type PlannedOrderType = "PURCHASE" | "PRODUCTION";
export type PlannedOrderStatus = "PLANNED" | "FIRMED" | "RELEASED" | "CANCELLED";

/**
 * A time-phased supply proposal produced by MRP.
 *
 * - PLANNED   regenerated freely by the next planning run
 * - FIRMED    pinned by a planner; the next run treats it as a scheduled
 *             receipt instead of re-deriving it
 * - RELEASED  handed off to procurement (PURCHASE) or manufacturing
 *             (PRODUCTION); becomes a real order outside this context
 * - CANCELLED removed from consideration
 */
export interface PlannedOrder {
  readonly orderId: string;
  readonly orderType: PlannedOrderType;
  readonly sku: string;
  readonly qty: number;
  readonly dueDate: IsoDate;
  readonly releaseDate: IsoDate;
  readonly status: PlannedOrderStatus;
  readonly supplierId: SupplierId | null;
  readonly estimatedCost: Money | null;
  readonly pastDue: boolean;
}

export interface SupplyPlanStats {
  readonly totalGrossRequirement: number;
  readonly totalPlannedQty: number;
  readonly orderCount: number;
  readonly exceptionCount: number;
  readonly endingOnHand: number;
}

interface SupplyPlanProps {
  runId: Ulid;
  sku: string;
  location: LocationCode;
  horizonStart: IsoDate;
  weekCount: number;
  safetyStock: number;
  rows: readonly MrpRow[];
  orders: readonly PlannedOrder[];
  exceptions: readonly MrpException[];
  stats: SupplyPlanStats;
}

export interface CreateSupplyPlanInput {
  runId: Ulid;
  sku: string;
  location: LocationCode;
  horizonStart: IsoDate;
  weekCount: number;
  safetyStock: number;
  rows: readonly MrpRow[];
  exceptions: readonly MrpException[];
  orders: readonly {
    orderType: PlannedOrderType;
    qty: number;
    dueDate: IsoDate;
    releaseDate: IsoDate;
    supplierId: SupplierId | null;
    unitCost: Money | null;
    pastDue: boolean;
  }[];
}

/**
 * The persisted result of netting one item at one location in one planning
 * run: the full MRP grid, generated planned orders and exception messages.
 * Order lifecycle transitions happen here so the invariants (no firming a
 * released order, etc.) live with the data they protect.
 */
export class SupplyPlan extends AggregateRoot<SupplyPlanProps> {
  static create(tenantId: TenantId, input: CreateSupplyPlanInput): SupplyPlan {
    const orders: PlannedOrder[] = input.orders.map((order) => ({
      orderId: newId("po") as string,
      orderType: order.orderType,
      sku: input.sku,
      qty: order.qty,
      dueDate: order.dueDate,
      releaseDate: order.releaseDate,
      status: "PLANNED",
      supplierId: order.supplierId,
      estimatedCost: order.unitCost ? mulMoney(order.unitCost, order.qty) : null,
      pastDue: order.pastDue,
    }));
    const stats: SupplyPlanStats = {
      totalGrossRequirement: sum(input.rows.map((r) => r.grossRequirement)),
      totalPlannedQty: sum(orders.map((o) => o.qty)),
      orderCount: orders.length,
      exceptionCount: input.exceptions.length,
      endingOnHand: input.rows.at(-1)?.projectedOnHand ?? 0,
    };
    const plan = new SupplyPlan(tenantId, {
      runId: input.runId,
      sku: input.sku,
      location: input.location,
      horizonStart: input.horizonStart,
      weekCount: input.weekCount,
      safetyStock: input.safetyStock,
      rows: input.rows,
      orders,
      exceptions: input.exceptions,
      stats,
    });
    plan.raise(
      envelope({
        eventType: SupplyChainEvents.SupplyPlanCreated,
        aggregateType: "SupplyPlan",
        aggregateId: plan.id,
        tenantId,
        payload: {
          planId: plan.id,
          runId: input.runId,
          sku: input.sku,
          location: input.location,
          orderCount: orders.length,
          exceptionCount: input.exceptions.length,
        },
      }),
    );
    return plan;
  }

  get runId(): Ulid {
    return this.props.runId;
  }

  get sku(): string {
    return this.props.sku;
  }

  get location(): LocationCode {
    return this.props.location;
  }

  get rows(): readonly MrpRow[] {
    return this.props.rows;
  }

  get orders(): readonly PlannedOrder[] {
    return this.props.orders;
  }

  get exceptions(): readonly MrpException[] {
    return this.props.exceptions;
  }

  get stats(): SupplyPlanStats {
    return this.props.stats;
  }

  /** Orders the next planning run must respect as committed supply. */
  firmedOrders(): readonly PlannedOrder[] {
    return this.props.orders.filter((o) => o.status === "FIRMED");
  }

  firmOrder(orderId: string): PlannedOrder {
    const order = this.getOrder(orderId);
    if (order.status !== "PLANNED") {
      throw new DomainError(`Order ${orderId} is ${order.status}; only PLANNED orders can be firmed`, "CONFLICT", 409);
    }
    const updated = this.transition(orderId, "FIRMED");
    this.raise(
      envelope({
        eventType: SupplyChainEvents.PlannedOrderFirmed,
        aggregateType: "SupplyPlan",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { planId: this.id, orderId, sku: updated.sku, qty: updated.qty, dueDate: updated.dueDate },
      }),
    );
    return updated;
  }

  releaseOrder(orderId: string): PlannedOrder {
    const order = this.getOrder(orderId);
    if (order.status !== "PLANNED" && order.status !== "FIRMED") {
      throw new DomainError(`Order ${orderId} is ${order.status}; cannot release`, "CONFLICT", 409);
    }
    const updated = this.transition(orderId, "RELEASED");
    const payload: PlannedOrderReleasedPayload = {
      planId: this.id,
      orderId,
      sku: updated.sku,
      location: this.props.location,
      orderType: updated.orderType,
      qty: updated.qty,
      dueDate: updated.dueDate,
      releaseDate: updated.releaseDate,
      supplierId: updated.supplierId,
    };
    this.raise(
      envelope({
        eventType: SupplyChainEvents.PlannedOrderReleased,
        aggregateType: "SupplyPlan",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload,
      }),
    );
    return updated;
  }

  cancelOrder(orderId: string): PlannedOrder {
    const order = this.getOrder(orderId);
    if (order.status === "RELEASED") {
      throw new DomainError(`Order ${orderId} is RELEASED; cancel it in the downstream system`, "CONFLICT", 409);
    }
    if (order.status === "CANCELLED") {
      throw new DomainError(`Order ${orderId} is already cancelled`, "CONFLICT", 409);
    }
    const updated = this.transition(orderId, "CANCELLED");
    this.raise(
      envelope({
        eventType: SupplyChainEvents.PlannedOrderCancelled,
        aggregateType: "SupplyPlan",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { planId: this.id, orderId, sku: updated.sku, qty: updated.qty },
      }),
    );
    return updated;
  }

  private getOrder(orderId: string): PlannedOrder {
    const order = this.props.orders.find((o) => o.orderId === orderId);
    if (!order) throw new DomainError(`Planned order not found: ${orderId}`, "NOT_FOUND", 404);
    return order;
  }

  private transition(orderId: string, status: PlannedOrderStatus): PlannedOrder {
    let updated: PlannedOrder | undefined;
    this.props = {
      ...this.props,
      orders: this.props.orders.map((o) => {
        if (o.orderId !== orderId) return o;
        updated = { ...o, status };
        return updated;
      }),
    };
    this.touch();
    return updated as PlannedOrder;
  }
}

function sum(values: readonly number[]): number {
  return Math.round(values.reduce((s, v) => s + v, 0) * 1000) / 1000;
}
