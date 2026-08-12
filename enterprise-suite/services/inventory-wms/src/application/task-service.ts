import {
  ConflictError,
  NotFoundError,
  type TenantContext,
  type Ulid,
  type UserId,
} from "@enterprise-suite/shared-kernel";
import { PickTask, PutawayTask } from "../domain/tasks.js";
import type {
  EventOutbox,
  PickTaskFilter,
  PickTaskRepository,
  PutawayTaskFilter,
  PutawayTaskRepository,
  ReservationRepository,
} from "./ports.js";
import type { StockService } from "./stock-service.js";

/**
 * Warehouse task execution. Putaway completion performs the physical
 * staging->storage transfer through StockService so the ledger and balances
 * stay consistent. Pick tasks are execution stubs: they track operator
 * progress per allocation; the stock issue is posted by reservation
 * fulfillment, not here.
 */
export class TaskService {
  constructor(
    private readonly putaways: PutawayTaskRepository,
    private readonly picks: PickTaskRepository,
    private readonly reservations: ReservationRepository,
    private readonly stockService: StockService,
    private readonly outbox: EventOutbox,
  ) {}

  // -- putaway ----------------------------------------------------------------

  async assignPutaway(ctx: TenantContext, taskId: Ulid, userId: UserId): Promise<PutawayTask> {
    const task = await this.requirePutaway(ctx, taskId);
    task.assign(userId);
    await this.putaways.save(task);
    await this.outbox.publish(task.pullEvents());
    return task;
  }

  async startPutaway(ctx: TenantContext, taskId: Ulid): Promise<PutawayTask> {
    const task = await this.requirePutaway(ctx, taskId);
    task.start();
    await this.putaways.save(task);
    return task;
  }

  /**
   * Complete the putaway and execute the physical move. The transfer is
   * validated first (available qty, destination usable) so a failed move
   * leaves the task IN_PROGRESS rather than falsely COMPLETED.
   */
  async completePutaway(
    ctx: TenantContext,
    taskId: Ulid,
    options: { actualBinId?: Ulid } = {},
  ): Promise<PutawayTask> {
    const task = await this.requirePutaway(ctx, taskId);
    if (task.status !== "IN_PROGRESS") {
      throw new ConflictError(
        `PutawayTask ${taskId} must be IN_PROGRESS to complete (currently ${task.status})`,
      );
    }
    const targetBinId = options.actualBinId ?? task.suggestedBinId;
    await this.stockService.transferStock(ctx, {
      warehouseId: task.warehouseId,
      fromBinId: task.fromBinId,
      toBinId: targetBinId,
      sku: task.sku,
      lotId: task.lotId,
      quantity: task.quantity,
      ref: { type: "PUTAWAY_TASK", id: String(task.id) },
    });
    task.complete(options.actualBinId);
    await this.putaways.save(task);
    await this.outbox.publish(task.pullEvents());
    return task;
  }

  async cancelPutaway(ctx: TenantContext, taskId: Ulid): Promise<PutawayTask> {
    const task = await this.requirePutaway(ctx, taskId);
    task.cancel();
    await this.putaways.save(task);
    await this.outbox.publish(task.pullEvents());
    return task;
  }

  async listPutaways(ctx: TenantContext, filter?: PutawayTaskFilter): Promise<PutawayTask[]> {
    return this.putaways.list(ctx.tenantId, filter);
  }

  async getPutaway(ctx: TenantContext, taskId: Ulid): Promise<PutawayTask> {
    return this.requirePutaway(ctx, taskId);
  }

  // -- pick -------------------------------------------------------------------

  /**
   * Generate one pick task per allocation of an allocated reservation.
   * Idempotent: allocations that already have a task are skipped.
   */
  async generatePickTasks(ctx: TenantContext, reservationId: Ulid): Promise<PickTask[]> {
    const reservation = await this.reservations.findById(ctx.tenantId, reservationId);
    if (!reservation) throw new NotFoundError("Reservation", reservationId);
    if (reservation.status !== "ALLOCATED" && reservation.status !== "PARTIALLY_ALLOCATED") {
      throw new ConflictError(
        `Pick tasks require an allocated reservation (currently ${reservation.status})`,
      );
    }
    const created: PickTask[] = [];
    for (const allocation of reservation.allocations) {
      const existing = await this.picks.findByAllocationId(ctx.tenantId, allocation.allocationId);
      if (existing) continue;
      const task = PickTask.create(ctx.tenantId, {
        warehouseId: reservation.warehouseId,
        reservationId: reservation.id,
        allocationId: allocation.allocationId,
        sku: allocation.sku,
        lotId: allocation.lotId,
        uom: reservation.lines.find((l) => l.lineId === allocation.lineId)?.uom ?? "EA",
        quantity: allocation.qty,
        fromBinId: allocation.binId,
      });
      await this.picks.save(task);
      created.push(task);
    }
    const events = created.flatMap((task) => task.pullEvents());
    if (events.length > 0) await this.outbox.publish(events);
    return created;
  }

  async assignPick(ctx: TenantContext, taskId: Ulid, userId: UserId): Promise<PickTask> {
    const task = await this.requirePick(ctx, taskId);
    task.assign(userId);
    await this.picks.save(task);
    await this.outbox.publish(task.pullEvents());
    return task;
  }

  async startPick(ctx: TenantContext, taskId: Ulid): Promise<PickTask> {
    const task = await this.requirePick(ctx, taskId);
    task.start();
    await this.picks.save(task);
    return task;
  }

  async completePick(ctx: TenantContext, taskId: Ulid, pickedQty: number): Promise<PickTask> {
    const task = await this.requirePick(ctx, taskId);
    task.completePick(pickedQty);
    await this.picks.save(task);
    await this.outbox.publish(task.pullEvents());
    return task;
  }

  async cancelPick(ctx: TenantContext, taskId: Ulid): Promise<PickTask> {
    const task = await this.requirePick(ctx, taskId);
    task.cancel();
    await this.picks.save(task);
    await this.outbox.publish(task.pullEvents());
    return task;
  }

  async listPicks(ctx: TenantContext, filter?: PickTaskFilter): Promise<PickTask[]> {
    return this.picks.list(ctx.tenantId, filter);
  }

  async getPick(ctx: TenantContext, taskId: Ulid): Promise<PickTask> {
    return this.requirePick(ctx, taskId);
  }

  // -- internals ----------------------------------------------------------------

  private async requirePutaway(ctx: TenantContext, id: Ulid): Promise<PutawayTask> {
    const task = await this.putaways.findById(ctx.tenantId, id);
    if (!task) throw new NotFoundError("PutawayTask", id);
    return task;
  }

  private async requirePick(ctx: TenantContext, id: Ulid): Promise<PickTask> {
    const task = await this.picks.findById(ctx.tenantId, id);
    if (!task) throw new NotFoundError("PickTask", id);
    return task;
  }
}
