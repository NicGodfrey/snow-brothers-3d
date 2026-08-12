import {
  AggregateRoot,
  DomainError,
  envelope,
  nowIso,
  type IsoDateTime,
  type TenantId,
  type Ulid,
  type UserId,
} from "@enterprise-suite/shared-kernel";
import { InventoryEvents, type TaskLifecyclePayload } from "./events.js";
import type { StockRef } from "./inventory-transaction.js";
import { assertPositiveQuantity, normalizeUom } from "./quantity.js";
import { assertTransition, isTerminal, type TransitionMap } from "./state-machine.js";

/**
 * Warehouse execution tasks. These are deliberately thin ("stubs with status
 * machines" per the context charter): the state machines, assignment rules and
 * events are real; labor management, slotting optimization and device
 * integration are out of scope.
 *
 * Putaway:  PENDING ─▶ ASSIGNED ─▶ IN_PROGRESS ─▶ COMPLETED
 *              │           │            │
 *              └───────────┴────────────┴──▶ CANCELLED
 * (completion executes the physical staging-bin -> storage-bin transfer)
 *
 * Pick:     PENDING ─▶ ASSIGNED ─▶ PICKING ─▶ PICKED | SHORT_PICKED
 *              │           │           │
 *              └───────────┴───────────┴──▶ CANCELLED
 * (completion records picked qty; the stock issue itself is posted when the
 *  owning reservation is fulfilled, keeping the ledger single-sourced)
 */

// ---------------------------------------------------------------------------
// Putaway
// ---------------------------------------------------------------------------

export type PutawayStatus = "PENDING" | "ASSIGNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";

export const PUTAWAY_TRANSITIONS: TransitionMap<PutawayStatus> = {
  PENDING: ["ASSIGNED", "CANCELLED"],
  ASSIGNED: ["IN_PROGRESS", "PENDING", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export interface PutawayTaskProps {
  warehouseId: Ulid;
  sku: string;
  lotId: Ulid | null;
  uom: string;
  quantity: number;
  fromBinId: Ulid;
  suggestedBinId: Ulid;
  actualBinId: Ulid | null;
  status: PutawayStatus;
  assignedTo: UserId | null;
  sourceRef: StockRef | null;
  completedAt: IsoDateTime | null;
}

export class PutawayTask extends AggregateRoot<PutawayTaskProps> {
  static create(
    tenantId: TenantId,
    input: {
      warehouseId: Ulid;
      sku: string;
      lotId?: Ulid | null;
      uom: string;
      quantity: number;
      fromBinId: Ulid;
      suggestedBinId: Ulid;
      sourceRef?: StockRef | null;
    },
  ): PutawayTask {
    assertPositiveQuantity(input.quantity);
    if (input.fromBinId === input.suggestedBinId) {
      throw new DomainError(
        "Putaway source and suggested bins must differ",
        "INVALID_TASK",
        400,
      );
    }
    const task = new PutawayTask(tenantId, {
      warehouseId: input.warehouseId,
      sku: input.sku,
      lotId: input.lotId ?? null,
      uom: normalizeUom(input.uom),
      quantity: input.quantity,
      fromBinId: input.fromBinId,
      suggestedBinId: input.suggestedBinId,
      actualBinId: null,
      status: "PENDING",
      assignedTo: null,
      sourceRef: input.sourceRef ?? null,
      completedAt: null,
    });
    task.raise(task.lifecycleEvent(InventoryEvents.PutawayTaskCreated));
    return task;
  }

  get warehouseId(): Ulid {
    return this.props.warehouseId;
  }

  get sku(): string {
    return this.props.sku;
  }

  get lotId(): Ulid | null {
    return this.props.lotId;
  }

  get uom(): string {
    return this.props.uom;
  }

  get quantity(): number {
    return this.props.quantity;
  }

  get fromBinId(): Ulid {
    return this.props.fromBinId;
  }

  get suggestedBinId(): Ulid {
    return this.props.suggestedBinId;
  }

  get targetBinId(): Ulid {
    return this.props.actualBinId ?? this.props.suggestedBinId;
  }

  get status(): PutawayStatus {
    return this.props.status;
  }

  get assignedTo(): UserId | null {
    return this.props.assignedTo;
  }

  get isOpen(): boolean {
    return !isTerminal(PUTAWAY_TRANSITIONS, this.props.status);
  }

  assign(userId: UserId): void {
    this.transition("ASSIGNED");
    this.props.assignedTo = userId;
  }

  unassign(): void {
    this.transition("PENDING");
    this.props.assignedTo = null;
  }

  start(): void {
    this.transition("IN_PROGRESS");
  }

  /**
   * Mark done. The operator may have put stock somewhere other than the
   * suggested bin; `actualBinId` records where it really went.
   */
  complete(actualBinId?: Ulid): void {
    if (actualBinId && actualBinId === this.props.fromBinId) {
      throw new DomainError(
        "Putaway destination cannot be the source bin",
        "INVALID_TASK",
        400,
      );
    }
    this.transition("COMPLETED");
    this.props.actualBinId = actualBinId ?? this.props.suggestedBinId;
    this.props.completedAt = nowIso();
    this.raise(this.lifecycleEvent(InventoryEvents.PutawayTaskCompleted));
  }

  cancel(): void {
    this.transition("CANCELLED");
    this.raise(this.lifecycleEvent(InventoryEvents.PutawayTaskCancelled));
  }

  private transition(to: PutawayStatus): void {
    assertTransition(`PutawayTask ${this.id}`, PUTAWAY_TRANSITIONS, this.props.status, to);
    this.props.status = to;
    this.touch();
  }

  private lifecycleEvent(eventType: string) {
    return envelope<TaskLifecyclePayload>({
      eventType,
      aggregateType: "PutawayTask",
      aggregateId: this.id,
      tenantId: this.tenantId,
      payload: {
        warehouseId: this.props.warehouseId,
        sku: this.props.sku,
        quantity: this.props.quantity,
        status: this.props.status,
        assignedTo: this.props.assignedTo,
        completedAt: this.props.completedAt ?? undefined,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Pick
// ---------------------------------------------------------------------------

export type PickStatus =
  | "PENDING"
  | "ASSIGNED"
  | "PICKING"
  | "PICKED"
  | "SHORT_PICKED"
  | "CANCELLED";

export const PICK_TRANSITIONS: TransitionMap<PickStatus> = {
  PENDING: ["ASSIGNED", "CANCELLED"],
  ASSIGNED: ["PICKING", "PENDING", "CANCELLED"],
  PICKING: ["PICKED", "SHORT_PICKED", "CANCELLED"],
  PICKED: [],
  SHORT_PICKED: [],
  CANCELLED: [],
};

export interface PickTaskProps {
  warehouseId: Ulid;
  reservationId: Ulid;
  allocationId: Ulid;
  sku: string;
  lotId: Ulid | null;
  uom: string;
  quantity: number;
  fromBinId: Ulid;
  status: PickStatus;
  assignedTo: UserId | null;
  pickedQty: number | null;
  completedAt: IsoDateTime | null;
}

export class PickTask extends AggregateRoot<PickTaskProps> {
  static create(
    tenantId: TenantId,
    input: {
      warehouseId: Ulid;
      reservationId: Ulid;
      allocationId: Ulid;
      sku: string;
      lotId?: Ulid | null;
      uom: string;
      quantity: number;
      fromBinId: Ulid;
    },
  ): PickTask {
    assertPositiveQuantity(input.quantity);
    const task = new PickTask(tenantId, {
      warehouseId: input.warehouseId,
      reservationId: input.reservationId,
      allocationId: input.allocationId,
      sku: input.sku,
      lotId: input.lotId ?? null,
      uom: normalizeUom(input.uom),
      quantity: input.quantity,
      fromBinId: input.fromBinId,
      status: "PENDING",
      assignedTo: null,
      pickedQty: null,
      completedAt: null,
    });
    task.raise(task.lifecycleEvent(InventoryEvents.PickTaskCreated));
    return task;
  }

  get warehouseId(): Ulid {
    return this.props.warehouseId;
  }

  get reservationId(): Ulid {
    return this.props.reservationId;
  }

  get allocationId(): Ulid {
    return this.props.allocationId;
  }

  get sku(): string {
    return this.props.sku;
  }

  get quantity(): number {
    return this.props.quantity;
  }

  get fromBinId(): Ulid {
    return this.props.fromBinId;
  }

  get status(): PickStatus {
    return this.props.status;
  }

  get assignedTo(): UserId | null {
    return this.props.assignedTo;
  }

  get pickedQty(): number | null {
    return this.props.pickedQty;
  }

  get isOpen(): boolean {
    return !isTerminal(PICK_TRANSITIONS, this.props.status);
  }

  assign(userId: UserId): void {
    this.transition("ASSIGNED");
    this.props.assignedTo = userId;
  }

  unassign(): void {
    this.transition("PENDING");
    this.props.assignedTo = null;
  }

  start(): void {
    this.transition("PICKING");
  }

  /** Record picked quantity; short picks land in SHORT_PICKED for follow-up. */
  completePick(pickedQty: number): void {
    if (!Number.isInteger(pickedQty) || pickedQty < 0 || pickedQty > this.props.quantity) {
      throw new DomainError(
        `pickedQty must be an integer in [0, ${this.props.quantity}], got ${pickedQty}`,
        "INVALID_QUANTITY",
        400,
      );
    }
    this.transition(pickedQty === this.props.quantity ? "PICKED" : "SHORT_PICKED");
    this.props.pickedQty = pickedQty;
    this.props.completedAt = nowIso();
    this.raise(this.lifecycleEvent(InventoryEvents.PickTaskCompleted));
  }

  cancel(): void {
    this.transition("CANCELLED");
    this.raise(this.lifecycleEvent(InventoryEvents.PickTaskCancelled));
  }

  private transition(to: PickStatus): void {
    assertTransition(`PickTask ${this.id}`, PICK_TRANSITIONS, this.props.status, to);
    this.props.status = to;
    this.touch();
  }

  private lifecycleEvent(eventType: string) {
    return envelope<TaskLifecyclePayload>({
      eventType,
      aggregateType: "PickTask",
      aggregateId: this.id,
      tenantId: this.tenantId,
      payload: {
        warehouseId: this.props.warehouseId,
        sku: this.props.sku,
        quantity: this.props.quantity,
        status: this.props.status,
        assignedTo: this.props.assignedTo,
        completedAt: this.props.completedAt ?? undefined,
      },
    });
  }
}
