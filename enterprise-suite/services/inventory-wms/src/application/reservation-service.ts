import {
  ConflictError,
  NotFoundError,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { newTransaction } from "../domain/inventory-transaction.js";
import { Reservation } from "../domain/reservation.js";
import type { StockBalance } from "../domain/stock-balance.js";
import {
  sortCandidates,
  usableCandidates,
  type AllocationCandidate,
  type AllocationStrategy,
} from "./allocation.js";
import type {
  BinRepository,
  EventOutbox,
  InventoryTransactionRepository,
  LotRepository,
  ReservationFilter,
  ReservationRepository,
  StockBalanceRepository,
} from "./ports.js";
import type { StockService } from "./stock-service.js";

export interface CreateReservationCommand {
  salesOrderId: string;
  warehouseId: Ulid;
  lines: { sku: string; qty: number; uom?: string }[];
  strategy?: AllocationStrategy;
  /** Allocate immediately after creation (default true). */
  autoAllocate?: boolean;
  notes?: string;
}

export interface AllocationReport {
  reservation: Reservation;
  /** Lines that could not be fully allocated in this pass. */
  shortages: { sku: string; requestedQty: number; allocatedQty: number; shortQty: number }[];
}

export class ReservationService {
  constructor(
    private readonly reservations: ReservationRepository,
    private readonly balances: StockBalanceRepository,
    private readonly bins: BinRepository,
    private readonly lots: LotRepository,
    private readonly ledger: InventoryTransactionRepository,
    private readonly stockService: StockService,
    private readonly outbox: EventOutbox,
  ) {}

  async createReservation(
    ctx: TenantContext,
    cmd: CreateReservationCommand,
  ): Promise<AllocationReport> {
    const warehouse = await this.stockService.requireWarehouse(ctx, cmd.warehouseId);
    warehouse.assertOperational();

    const duplicates = await this.reservations.list(ctx.tenantId, {
      salesOrderId: cmd.salesOrderId.trim(),
      activeOnly: true,
    });
    if (duplicates.length > 0) {
      throw new ConflictError(
        `Sales order ${cmd.salesOrderId} already has an active reservation (${duplicates[0]!.id})`,
      );
    }

    const reservation = Reservation.create(ctx.tenantId, {
      salesOrderId: cmd.salesOrderId,
      warehouseId: warehouse.id,
      lines: cmd.lines,
      notes: cmd.notes,
    });
    await this.reservations.save(reservation);
    await this.outbox.publish(reservation.pullEvents());

    if (cmd.autoAllocate === false) {
      return { reservation, shortages: this.shortagesOf(reservation) };
    }
    return this.allocate(ctx, reservation.id, cmd.strategy ?? "FEFO");
  }

  /**
   * Allocation pass: for each unfilled line, walk usable stock sorted by the
   * strategy and reserve until the line is filled or sources run out.
   * Balance reservation and allocation records commit together.
   */
  async allocate(
    ctx: TenantContext,
    reservationId: Ulid,
    strategy: AllocationStrategy = "FEFO",
  ): Promise<AllocationReport> {
    const reservation = await this.requireReservation(ctx, reservationId);
    if (!reservation.isActive || reservation.status === "ALLOCATED") {
      throw new ConflictError(
        `Reservation ${reservation.salesOrderId} cannot be allocated while ${reservation.status}`,
      );
    }

    const touchedBalances = new Map<string, StockBalance>();
    for (const line of reservation.lines) {
      let remaining = line.requestedQty - line.allocatedQty;
      if (remaining <= 0) continue;

      const candidates = await this.loadCandidates(ctx, reservation.warehouseId, line.sku);
      for (const candidate of sortCandidates(strategy, usableCandidates(candidates))) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, candidate.balance.available);
        if (take <= 0) continue;
        candidate.balance.reserve(take);
        reservation.addAllocation({
          lineId: line.lineId,
          binId: candidate.balance.binId,
          lotId: candidate.balance.lotId,
          qty: take,
        });
        touchedBalances.set(String(candidate.balance.id), candidate.balance);
        remaining -= take;
      }
    }

    reservation.finalizeAllocationPass();
    for (const balance of touchedBalances.values()) {
      await this.balances.save(balance);
    }
    await this.reservations.save(reservation);
    await this.outbox.publish(reservation.pullEvents());

    return { reservation, shortages: this.shortagesOf(reservation) };
  }

  /** Release soft allocations back to stock and close the reservation. */
  async release(ctx: TenantContext, reservationId: Ulid): Promise<Reservation> {
    const reservation = await this.requireReservation(ctx, reservationId);
    const returned = reservation.release();
    await this.unreserve(ctx, reservation, returned);
    await this.reservations.save(reservation);
    await this.outbox.publish(reservation.pullEvents());
    return reservation;
  }

  async cancel(ctx: TenantContext, reservationId: Ulid, reason?: string): Promise<Reservation> {
    const reservation = await this.requireReservation(ctx, reservationId);
    const returned = reservation.cancel(reason);
    await this.unreserve(ctx, reservation, returned);
    await this.reservations.save(reservation);
    await this.outbox.publish(reservation.pullEvents());
    return reservation;
  }

  /**
   * Ship the reservation: consume reserved stock and write one ISSUE ledger
   * row per allocation, all referencing the sales order.
   */
  async fulfill(
    ctx: TenantContext,
    reservationId: Ulid,
    options: { allowPartial?: boolean } = {},
  ): Promise<Reservation> {
    const reservation = await this.requireReservation(ctx, reservationId);
    const shipped = reservation.fulfill(options);

    for (const allocation of shipped) {
      const balance = await this.stockService.requireBalance(ctx, {
        warehouseId: reservation.warehouseId,
        binId: allocation.binId,
        sku: allocation.sku,
        lotId: allocation.lotId,
      });
      balance.consumeReserved(allocation.qty);
      await this.balances.save(balance);
      await this.ledger.append(
        newTransaction({
          tenantId: ctx.tenantId,
          txnType: "ISSUE",
          warehouseId: reservation.warehouseId,
          sku: allocation.sku,
          lotId: allocation.lotId,
          uom: balance.uom,
          quantity: allocation.qty,
          fromBinId: allocation.binId,
          ref: { type: "SALES_ORDER", id: reservation.salesOrderId },
          actorId: ctx.userId,
        }),
      );
    }

    await this.reservations.save(reservation);
    await this.outbox.publish(reservation.pullEvents());
    return reservation;
  }

  async getReservation(ctx: TenantContext, id: Ulid): Promise<Reservation> {
    return this.requireReservation(ctx, id);
  }

  async listReservations(ctx: TenantContext, filter?: ReservationFilter): Promise<Reservation[]> {
    return this.reservations.list(ctx.tenantId, filter);
  }

  // -- internals --------------------------------------------------------------

  private async requireReservation(ctx: TenantContext, id: Ulid): Promise<Reservation> {
    const reservation = await this.reservations.findById(ctx.tenantId, id);
    if (!reservation) throw new NotFoundError("Reservation", id);
    return reservation;
  }

  private async loadCandidates(
    ctx: TenantContext,
    warehouseId: Ulid,
    sku: string,
  ): Promise<AllocationCandidate[]> {
    const balances = await this.balances.list(ctx.tenantId, {
      warehouseId,
      sku,
      nonEmptyOnly: true,
    });
    const candidates: AllocationCandidate[] = [];
    for (const balance of balances) {
      const bin = await this.bins.findById(ctx.tenantId, balance.binId);
      if (!bin) continue;
      const lot = balance.lotId ? await this.lots.findById(ctx.tenantId, balance.lotId) : null;
      candidates.push({ balance, lot, bin });
    }
    return candidates;
  }

  private async unreserve(
    ctx: TenantContext,
    reservation: Reservation,
    allocations: readonly { binId: Ulid; sku: string; lotId: Ulid | null; qty: number }[],
  ): Promise<void> {
    for (const allocation of allocations) {
      const balance = await this.stockService.requireBalance(ctx, {
        warehouseId: reservation.warehouseId,
        binId: allocation.binId,
        sku: allocation.sku,
        lotId: allocation.lotId,
      });
      balance.releaseReservation(allocation.qty);
      await this.balances.save(balance);
    }
  }

  private shortagesOf(reservation: Reservation) {
    return reservation.lines
      .filter((line) => line.allocatedQty < line.requestedQty)
      .map((line) => ({
        sku: line.sku,
        requestedQty: line.requestedQty,
        allocatedQty: line.allocatedQty,
        shortQty: line.requestedQty - line.allocatedQty,
      }));
  }
}
