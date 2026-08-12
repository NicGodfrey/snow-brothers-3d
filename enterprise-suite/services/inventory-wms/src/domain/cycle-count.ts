import {
  AggregateRoot,
  DomainError,
  envelope,
  newId,
  nowIso,
  type IsoDateTime,
  type TenantId,
  type Ulid,
  type UserId,
} from "@enterprise-suite/shared-kernel";
import { InventoryEvents, type CycleCountCompletedPayload } from "./events.js";
import { assertNonNegativeQuantity } from "./quantity.js";
import { assertTransition, type TransitionMap } from "./state-machine.js";

/**
 * Cycle count lifecycle:
 *
 *   DRAFT ──start──▶ IN_PROGRESS ──all lines counted──▶ REVIEW ──complete──▶ COMPLETED
 *     │                  │                                │
 *     └──cancel──────────┴──cancel───────────────────────┘──▶ CANCELLED
 *
 * Expected quantities are snapshotted at `start` so counting happens against a
 * frozen baseline; adjustments post the *variance* (counted - expected), which
 * tolerates concurrent movements between start and complete.
 */
export type CycleCountStatus = "DRAFT" | "IN_PROGRESS" | "REVIEW" | "COMPLETED" | "CANCELLED";

export const CYCLE_COUNT_TRANSITIONS: TransitionMap<CycleCountStatus> = {
  DRAFT: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["REVIEW", "CANCELLED"],
  REVIEW: ["COMPLETED", "IN_PROGRESS", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export interface CycleCountLine {
  readonly lineId: Ulid;
  readonly binId: Ulid;
  readonly sku: string;
  readonly lotId: Ulid | null;
  expectedQty: number | null;
  countedQty: number | null;
  varianceQty: number | null;
  countedBy: UserId | null;
  countedAt: IsoDateTime | null;
}

export interface CycleCountProps {
  warehouseId: Ulid;
  status: CycleCountStatus;
  lines: CycleCountLine[];
  scheduledFor?: IsoDateTime;
  startedAt?: IsoDateTime;
  completedAt?: IsoDateTime;
  notes?: string;
}

export class CycleCountOrder extends AggregateRoot<CycleCountProps> {
  static create(
    tenantId: TenantId,
    input: {
      warehouseId: Ulid;
      lines: { binId: Ulid; sku: string; lotId?: Ulid | null }[];
      scheduledFor?: IsoDateTime;
      notes?: string;
    },
  ): CycleCountOrder {
    if (input.lines.length === 0) {
      throw new DomainError(
        "Cycle count order needs at least one line",
        "INVALID_CYCLE_COUNT",
        400,
      );
    }
    const order = new CycleCountOrder(tenantId, {
      warehouseId: input.warehouseId,
      status: "DRAFT",
      lines: [],
      scheduledFor: input.scheduledFor,
      notes: input.notes?.trim(),
    });
    for (const line of input.lines) {
      order.addLine(line);
    }
    order.raise(
      envelope({
        eventType: InventoryEvents.CycleCountCreated,
        aggregateType: "CycleCountOrder",
        aggregateId: order.id,
        tenantId,
        payload: { warehouseId: input.warehouseId, lineCount: order.props.lines.length },
      }),
    );
    return order;
  }

  get warehouseId(): Ulid {
    return this.props.warehouseId;
  }

  get status(): CycleCountStatus {
    return this.props.status;
  }

  get lines(): readonly CycleCountLine[] {
    return this.props.lines;
  }

  lineById(lineId: Ulid): CycleCountLine {
    const line = this.props.lines.find((l) => l.lineId === lineId);
    if (!line) {
      throw new DomainError(`Cycle count line not found: ${lineId}`, "NOT_FOUND", 404);
    }
    return line;
  }

  addLine(input: { binId: Ulid; sku: string; lotId?: Ulid | null }): CycleCountLine {
    if (this.props.status !== "DRAFT") {
      throw new DomainError(
        `Lines can only be added in DRAFT (currently ${this.props.status})`,
        "CONFLICT",
        409,
      );
    }
    const sku = input.sku.trim();
    if (sku.length === 0 || sku.length > 64) {
      throw new DomainError("SKU must be 1-64 characters", "INVALID_SKU", 400);
    }
    const lotId = input.lotId ?? null;
    const duplicate = this.props.lines.some(
      (l) => l.binId === input.binId && l.sku === sku && l.lotId === lotId,
    );
    if (duplicate) {
      throw new DomainError(
        `Duplicate count line for ${sku} in bin ${input.binId}`,
        "INVALID_CYCLE_COUNT",
        400,
      );
    }
    const line: CycleCountLine = {
      lineId: newId("ccline"),
      binId: input.binId,
      sku,
      lotId,
      expectedQty: null,
      countedQty: null,
      varianceQty: null,
      countedBy: null,
      countedAt: null,
    };
    this.props.lines.push(line);
    this.touch();
    return line;
  }

  /**
   * Freeze the baseline and open for counting. `expectedProvider` resolves the
   * current system quantity for each line (0 when no balance exists).
   */
  start(expectedProvider: (line: CycleCountLine) => number): void {
    assertTransition("CycleCountOrder", CYCLE_COUNT_TRANSITIONS, this.props.status, "IN_PROGRESS");
    for (const line of this.props.lines) {
      const expected = expectedProvider(line);
      assertNonNegativeQuantity(expected, `expected qty for ${line.sku}`);
      line.expectedQty = expected;
    }
    this.props.status = "IN_PROGRESS";
    this.props.startedAt = nowIso();
    this.raise(
      envelope({
        eventType: InventoryEvents.CycleCountStarted,
        aggregateType: "CycleCountOrder",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { warehouseId: this.props.warehouseId, lineCount: this.props.lines.length },
      }),
    );
  }

  /** Record (or re-record) a physical count; auto-advances to REVIEW when complete. */
  recordCount(lineId: Ulid, countedQty: number, countedBy: UserId): void {
    if (this.props.status !== "IN_PROGRESS" && this.props.status !== "REVIEW") {
      throw new DomainError(
        `Counts can only be recorded while IN_PROGRESS or REVIEW (currently ${this.props.status})`,
        "CONFLICT",
        409,
      );
    }
    assertNonNegativeQuantity(countedQty, "countedQty");
    const line = this.lineById(lineId);
    line.countedQty = countedQty;
    line.varianceQty = countedQty - (line.expectedQty ?? 0);
    line.countedBy = countedBy;
    line.countedAt = nowIso();
    this.touch();
    if (this.props.status === "IN_PROGRESS" && this.allLinesCounted) {
      this.props.status = "REVIEW";
    }
  }

  get allLinesCounted(): boolean {
    return this.props.lines.every((l) => l.countedQty !== null);
  }

  get varianceLines(): readonly CycleCountLine[] {
    return this.props.lines.filter((l) => (l.varianceQty ?? 0) !== 0);
  }

  /** Send back for a recount (REVIEW -> IN_PROGRESS), clearing selected lines. */
  requestRecount(lineIds: readonly Ulid[]): void {
    assertTransition("CycleCountOrder", CYCLE_COUNT_TRANSITIONS, this.props.status, "IN_PROGRESS");
    if (lineIds.length === 0) {
      throw new DomainError("requestRecount needs at least one line", "INVALID_CYCLE_COUNT", 400);
    }
    for (const lineId of lineIds) {
      const line = this.lineById(lineId);
      line.countedQty = null;
      line.varianceQty = null;
      line.countedBy = null;
      line.countedAt = null;
    }
    this.props.status = "IN_PROGRESS";
    this.touch();
  }

  /**
   * Close the order. Returns variance lines; the application service posts a
   * COUNT_ADJUSTMENT ledger row per variance line.
   */
  complete(): readonly CycleCountLine[] {
    assertTransition("CycleCountOrder", CYCLE_COUNT_TRANSITIONS, this.props.status, "COMPLETED");
    if (!this.allLinesCounted) {
      throw new DomainError("All lines must be counted before completion", "CONFLICT", 409);
    }
    const variances = this.varianceLines;
    this.props.status = "COMPLETED";
    this.props.completedAt = nowIso();
    this.raise(
      envelope<CycleCountCompletedPayload>({
        eventType: InventoryEvents.CycleCountCompleted,
        aggregateType: "CycleCountOrder",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          warehouseId: this.props.warehouseId,
          countedLines: this.props.lines.length,
          variances: variances.map((l) => ({
            lineId: l.lineId,
            binId: l.binId,
            sku: l.sku,
            lotId: l.lotId,
            expectedQty: l.expectedQty ?? 0,
            countedQty: l.countedQty ?? 0,
            varianceQty: l.varianceQty ?? 0,
          })),
        },
      }),
    );
    return variances;
  }

  cancel(reason?: string): void {
    assertTransition("CycleCountOrder", CYCLE_COUNT_TRANSITIONS, this.props.status, "CANCELLED");
    this.props.status = "CANCELLED";
    this.raise(
      envelope({
        eventType: InventoryEvents.CycleCountCancelled,
        aggregateType: "CycleCountOrder",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { warehouseId: this.props.warehouseId, reason: reason ?? null },
      }),
    );
  }
}
