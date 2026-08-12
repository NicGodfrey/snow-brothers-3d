import type { IsoDateTime, Ulid } from "@enterprise-suite/shared-kernel";

/**
 * Canonical event type names for the inventory-wms bounded context.
 * Downstream contexts (sales, logistics, reporting) subscribe by these names.
 */
export const InventoryEvents = {
  WarehouseCreated: "inventory.warehouse.created",
  WarehouseStatusChanged: "inventory.warehouse.status-changed",
  ZoneAdded: "inventory.zone.added",
  BinAdded: "inventory.bin.added",
  BinBlocked: "inventory.bin.blocked",
  BinUnblocked: "inventory.bin.unblocked",
  LotCreated: "inventory.lot.created",
  LotStatusChanged: "inventory.lot.status-changed",
  StockReceived: "inventory.stock.received",
  StockIssued: "inventory.stock.issued",
  StockTransferred: "inventory.stock.transferred",
  StockAdjusted: "inventory.stock.adjusted",
  ReservationCreated: "inventory.reservation.created",
  ReservationAllocated: "inventory.reservation.allocated",
  ReservationReleased: "inventory.reservation.released",
  ReservationCancelled: "inventory.reservation.cancelled",
  ReservationFulfilled: "inventory.reservation.fulfilled",
  CycleCountCreated: "inventory.cycle-count.created",
  CycleCountStarted: "inventory.cycle-count.started",
  CycleCountCompleted: "inventory.cycle-count.completed",
  CycleCountCancelled: "inventory.cycle-count.cancelled",
  PutawayTaskCreated: "inventory.putaway-task.created",
  PutawayTaskCompleted: "inventory.putaway-task.completed",
  PutawayTaskCancelled: "inventory.putaway-task.cancelled",
  PickTaskCreated: "inventory.pick-task.created",
  PickTaskCompleted: "inventory.pick-task.completed",
  PickTaskCancelled: "inventory.pick-task.cancelled",
} as const;

export type InventoryEventType = (typeof InventoryEvents)[keyof typeof InventoryEvents];

// ---------------------------------------------------------------------------
// Payload contracts for the most integration-relevant events. Payloads are
// intentionally flat and serializable; consumers should not need our classes.
// ---------------------------------------------------------------------------

export interface StockMovementPayload {
  readonly transactionId: Ulid;
  readonly warehouseId: Ulid;
  readonly sku: string;
  readonly lotId: Ulid | null;
  readonly uom: string;
  readonly quantity: number;
  readonly fromBinId: Ulid | null;
  readonly toBinId: Ulid | null;
  readonly refType: string | null;
  readonly refId: string | null;
  readonly reasonCode: string | null;
}

export interface ReservationCreatedPayload {
  readonly salesOrderId: string;
  readonly warehouseId: Ulid;
  readonly lines: readonly { sku: string; requestedQty: number; uom: string }[];
}

export interface ReservationAllocatedPayload {
  readonly salesOrderId: string;
  readonly warehouseId: Ulid;
  readonly status: string;
  readonly allocations: readonly {
    allocationId: Ulid;
    lineId: Ulid;
    sku: string;
    binId: Ulid;
    lotId: Ulid | null;
    qty: number;
  }[];
}

export interface ReservationClosedPayload {
  readonly salesOrderId: string;
  readonly warehouseId: Ulid;
  readonly reason?: string;
}

export interface CycleCountCompletedPayload {
  readonly warehouseId: Ulid;
  readonly countedLines: number;
  readonly variances: readonly {
    lineId: Ulid;
    binId: Ulid;
    sku: string;
    lotId: Ulid | null;
    expectedQty: number;
    countedQty: number;
    varianceQty: number;
  }[];
}

export interface TaskLifecyclePayload {
  readonly warehouseId: Ulid;
  readonly sku: string;
  readonly quantity: number;
  readonly status: string;
  readonly assignedTo: string | null;
  readonly completedAt?: IsoDateTime;
}
