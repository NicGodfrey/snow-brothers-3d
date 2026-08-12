import {
  AggregateRoot,
  DomainError,
  envelope,
  newId,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import {
  InventoryEvents,
  type ReservationAllocatedPayload,
  type ReservationClosedPayload,
  type ReservationCreatedPayload,
} from "./events.js";
import { assertPositiveQuantity, normalizeUom } from "./quantity.js";
import { assertTransition, type TransitionMap } from "./state-machine.js";

/**
 * Reservation lifecycle:
 *
 *   OPEN ──allocate──▶ PARTIALLY_ALLOCATED ──allocate──▶ ALLOCATED
 *     │                        │                            │
 *     │ release/cancel         │ release/cancel             │ fulfill
 *     ▼                        ▼                            ▼
 *   CANCELLED/RELEASED   CANCELLED/RELEASED             FULFILLED
 *
 * RELEASED = allocations returned to stock, reservation kept for audit.
 * CANCELLED = same physical effect, but the demand itself is void.
 */
export type ReservationStatus =
  | "OPEN"
  | "PARTIALLY_ALLOCATED"
  | "ALLOCATED"
  | "RELEASED"
  | "FULFILLED"
  | "CANCELLED";

export const RESERVATION_TRANSITIONS: TransitionMap<ReservationStatus> = {
  OPEN: ["PARTIALLY_ALLOCATED", "ALLOCATED", "RELEASED", "CANCELLED"],
  PARTIALLY_ALLOCATED: ["PARTIALLY_ALLOCATED", "ALLOCATED", "RELEASED", "CANCELLED", "FULFILLED"],
  ALLOCATED: ["RELEASED", "CANCELLED", "FULFILLED"],
  RELEASED: [],
  FULFILLED: [],
  CANCELLED: [],
};

export const ACTIVE_RESERVATION_STATUSES: readonly ReservationStatus[] = [
  "OPEN",
  "PARTIALLY_ALLOCATED",
  "ALLOCATED",
];

export interface ReservationLine {
  readonly lineId: Ulid;
  readonly sku: string;
  readonly uom: string;
  readonly requestedQty: number;
  allocatedQty: number;
  fulfilledQty: number;
}

export interface StockAllocation {
  readonly allocationId: Ulid;
  readonly lineId: Ulid;
  readonly sku: string;
  readonly binId: Ulid;
  readonly lotId: Ulid | null;
  readonly qty: number;
}

export interface ReservationProps {
  salesOrderId: string;
  warehouseId: Ulid;
  status: ReservationStatus;
  lines: ReservationLine[];
  allocations: StockAllocation[];
  notes?: string;
}

export class Reservation extends AggregateRoot<ReservationProps> {
  static create(
    tenantId: TenantId,
    input: {
      salesOrderId: string;
      warehouseId: Ulid;
      lines: { sku: string; qty: number; uom?: string }[];
      notes?: string;
    },
  ): Reservation {
    const salesOrderId = input.salesOrderId.trim();
    if (salesOrderId.length === 0) {
      throw new DomainError("salesOrderId is required", "INVALID_RESERVATION", 400);
    }
    if (input.lines.length === 0) {
      throw new DomainError("Reservation needs at least one line", "INVALID_RESERVATION", 400);
    }
    const lines: ReservationLine[] = input.lines.map((line) => {
      assertPositiveQuantity(line.qty, `qty for ${line.sku}`);
      const sku = line.sku.trim();
      if (sku.length === 0 || sku.length > 64) {
        throw new DomainError("SKU must be 1-64 characters", "INVALID_SKU", 400);
      }
      return {
        lineId: newId("resline"),
        sku,
        uom: normalizeUom(line.uom),
        requestedQty: line.qty,
        allocatedQty: 0,
        fulfilledQty: 0,
      };
    });
    const seen = new Set<string>();
    for (const line of lines) {
      if (seen.has(line.sku)) {
        throw new DomainError(
          `Duplicate SKU ${line.sku} on reservation; merge quantities into one line`,
          "INVALID_RESERVATION",
          400,
        );
      }
      seen.add(line.sku);
    }

    const reservation = new Reservation(tenantId, {
      salesOrderId,
      warehouseId: input.warehouseId,
      status: "OPEN",
      lines,
      allocations: [],
      notes: input.notes?.trim(),
    });
    reservation.raise(
      envelope<ReservationCreatedPayload>({
        eventType: InventoryEvents.ReservationCreated,
        aggregateType: "Reservation",
        aggregateId: reservation.id,
        tenantId,
        payload: {
          salesOrderId,
          warehouseId: input.warehouseId,
          lines: lines.map((l) => ({ sku: l.sku, requestedQty: l.requestedQty, uom: l.uom })),
        },
      }),
    );
    return reservation;
  }

  get salesOrderId(): string {
    return this.props.salesOrderId;
  }

  get warehouseId(): Ulid {
    return this.props.warehouseId;
  }

  get status(): ReservationStatus {
    return this.props.status;
  }

  get lines(): readonly ReservationLine[] {
    return this.props.lines;
  }

  get allocations(): readonly StockAllocation[] {
    return this.props.allocations;
  }

  get isActive(): boolean {
    return ACTIVE_RESERVATION_STATUSES.includes(this.props.status);
  }

  get isFullyAllocated(): boolean {
    return this.props.lines.every((l) => l.allocatedQty >= l.requestedQty);
  }

  lineById(lineId: Ulid): ReservationLine {
    const line = this.props.lines.find((l) => l.lineId === lineId);
    if (!line) {
      throw new DomainError(`Reservation line not found: ${lineId}`, "NOT_FOUND", 404);
    }
    return line;
  }

  remainingForLine(lineId: Ulid): number {
    const line = this.lineById(lineId);
    return line.requestedQty - line.allocatedQty;
  }

  /**
   * Record that `qty` of a line has been reserved on a concrete balance.
   * The caller (application service) is responsible for having called
   * StockBalance.reserve first; the two writes commit together.
   */
  addAllocation(input: { lineId: Ulid; binId: Ulid; lotId: Ulid | null; qty: number }): StockAllocation {
    if (!this.isActive || this.props.status === "ALLOCATED") {
      throw new DomainError(
        `Cannot allocate reservation in status ${this.props.status}`,
        "CONFLICT",
        409,
      );
    }
    const line = this.lineById(input.lineId);
    assertPositiveQuantity(input.qty);
    if (input.qty > line.requestedQty - line.allocatedQty) {
      throw new DomainError(
        `Over-allocation on ${line.sku}: requested ${line.requestedQty}, already allocated ${line.allocatedQty}, tried to add ${input.qty}`,
        "OVER_ALLOCATION",
        409,
      );
    }
    const allocation: StockAllocation = {
      allocationId: newId("alloc"),
      lineId: line.lineId,
      sku: line.sku,
      binId: input.binId,
      lotId: input.lotId,
      qty: input.qty,
    };
    line.allocatedQty += input.qty;
    this.props.allocations.push(allocation);
    this.touch();
    return allocation;
  }

  /** Recompute status after an allocation pass and emit one summary event. */
  finalizeAllocationPass(): void {
    const anyAllocated = this.props.lines.some((l) => l.allocatedQty > 0);
    if (!anyAllocated) {
      return; // nothing reserved; stays OPEN, no event
    }
    const next: ReservationStatus = this.isFullyAllocated ? "ALLOCATED" : "PARTIALLY_ALLOCATED";
    if (next !== this.props.status) {
      assertTransition(
        `Reservation ${this.props.salesOrderId}`,
        RESERVATION_TRANSITIONS,
        this.props.status,
        next,
      );
      this.props.status = next;
    }
    this.raise(
      envelope<ReservationAllocatedPayload>({
        eventType: InventoryEvents.ReservationAllocated,
        aggregateType: "Reservation",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          salesOrderId: this.props.salesOrderId,
          warehouseId: this.props.warehouseId,
          status: this.props.status,
          allocations: this.props.allocations.map((a) => ({
            allocationId: a.allocationId,
            lineId: a.lineId,
            sku: a.sku,
            binId: a.binId,
            lotId: a.lotId,
            qty: a.qty,
          })),
        },
      }),
    );
  }

  /**
   * Return allocations to stock and close. Caller un-reserves the balances
   * using the returned allocation list.
   */
  release(): StockAllocation[] {
    return this.close("RELEASED", InventoryEvents.ReservationReleased);
  }

  cancel(reason?: string): StockAllocation[] {
    return this.close("CANCELLED", InventoryEvents.ReservationCancelled, reason);
  }

  private close(
    to: ReservationStatus,
    eventType: string,
    reason?: string,
  ): StockAllocation[] {
    assertTransition(
      `Reservation ${this.props.salesOrderId}`,
      RESERVATION_TRANSITIONS,
      this.props.status,
      to,
    );
    const toReturn = [...this.props.allocations];
    for (const line of this.props.lines) {
      line.allocatedQty = 0;
    }
    this.props.allocations = [];
    this.props.status = to;
    this.raise(
      envelope<ReservationClosedPayload>({
        eventType,
        aggregateType: "Reservation",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          salesOrderId: this.props.salesOrderId,
          warehouseId: this.props.warehouseId,
          reason,
        },
      }),
    );
    return toReturn;
  }

  /**
   * Mark the reservation shipped. Requires full allocation unless
   * allowPartial; the caller consumes the reserved stock and writes ISSUE
   * ledger rows for the returned allocations.
   */
  fulfill(options: { allowPartial?: boolean } = {}): StockAllocation[] {
    if (this.props.status !== "ALLOCATED" && !options.allowPartial) {
      throw new DomainError(
        `Reservation ${this.props.salesOrderId} is ${this.props.status}; fulfill requires ALLOCATED (or allowPartial)`,
        "CONFLICT",
        409,
      );
    }
    assertTransition(
      `Reservation ${this.props.salesOrderId}`,
      RESERVATION_TRANSITIONS,
      this.props.status,
      "FULFILLED",
    );
    const shipped = [...this.props.allocations];
    for (const line of this.props.lines) {
      line.fulfilledQty = line.allocatedQty;
    }
    this.props.status = "FULFILLED";
    this.raise(
      envelope<ReservationClosedPayload>({
        eventType: InventoryEvents.ReservationFulfilled,
        aggregateType: "Reservation",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          salesOrderId: this.props.salesOrderId,
          warehouseId: this.props.warehouseId,
        },
      }),
    );
    return shipped;
  }
}
