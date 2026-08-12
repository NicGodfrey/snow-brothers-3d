import {
  AggregateRoot,
  DomainError,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { assertNonNegativeQuantity, assertPositiveQuantity, normalizeUom } from "./quantity.js";

/**
 * Identity of a stock balance: one row per (warehouse, bin, sku, lot).
 * `lotId: null` is the balance for un-lotted stock of that SKU in that bin.
 */
export interface StockKey {
  readonly warehouseId: Ulid;
  readonly binId: Ulid;
  readonly sku: string;
  readonly lotId: Ulid | null;
}

export function stockKeyString(tenantId: TenantId, key: StockKey): string {
  return [tenantId, key.warehouseId, key.binId, key.sku, key.lotId ?? "-"].join("|");
}

export interface StockBalanceProps {
  warehouseId: Ulid;
  binId: Ulid;
  sku: string;
  lotId: Ulid | null;
  uom: string;
  onHand: number;
  reserved: number;
}

/**
 * StockBalance enforces the core invariants of the whole context:
 *   0 <= reserved <= onHand   and   available = onHand - reserved.
 * All mutations go through the named operations below; there is no setter.
 */
export class StockBalance extends AggregateRoot<StockBalanceProps> {
  static open(tenantId: TenantId, key: StockKey, uom: string): StockBalance {
    const sku = key.sku.trim();
    if (sku.length === 0 || sku.length > 64) {
      throw new DomainError("SKU must be 1-64 characters", "INVALID_SKU", 400);
    }
    return new StockBalance(tenantId, {
      warehouseId: key.warehouseId,
      binId: key.binId,
      sku,
      lotId: key.lotId,
      uom: normalizeUom(uom),
      onHand: 0,
      reserved: 0,
    });
  }

  get key(): StockKey {
    return {
      warehouseId: this.props.warehouseId,
      binId: this.props.binId,
      sku: this.props.sku,
      lotId: this.props.lotId,
    };
  }

  get warehouseId(): Ulid {
    return this.props.warehouseId;
  }

  get binId(): Ulid {
    return this.props.binId;
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

  get onHand(): number {
    return this.props.onHand;
  }

  get reserved(): number {
    return this.props.reserved;
  }

  get available(): number {
    return this.props.onHand - this.props.reserved;
  }

  get isEmpty(): boolean {
    return this.props.onHand === 0 && this.props.reserved === 0;
  }

  assertUomMatches(uom: string): void {
    const normalized = normalizeUom(uom);
    if (normalized !== this.props.uom) {
      throw new DomainError(
        `UOM mismatch for ${this.props.sku}: balance is ${this.props.uom}, got ${normalized}`,
        "UOM_MISMATCH",
        409,
      );
    }
  }

  /** Physical goods arrive: on-hand grows. */
  receive(qty: number): void {
    assertPositiveQuantity(qty);
    this.props.onHand += qty;
    this.touch();
  }

  /** Physical goods leave from the *available* portion (never touches reservations). */
  issue(qty: number): void {
    assertPositiveQuantity(qty);
    if (qty > this.available) {
      throw new DomainError(
        `Insufficient available stock for ${this.props.sku}: requested ${qty}, available ${this.available} (onHand ${this.props.onHand}, reserved ${this.props.reserved})`,
        "INSUFFICIENT_STOCK",
        409,
      );
    }
    this.props.onHand -= qty;
    this.touch();
  }

  /** Soft-allocate available units to a reservation. */
  reserve(qty: number): void {
    assertPositiveQuantity(qty);
    if (qty > this.available) {
      throw new DomainError(
        `Cannot reserve ${qty} of ${this.props.sku}: only ${this.available} available`,
        "INSUFFICIENT_STOCK",
        409,
      );
    }
    this.props.reserved += qty;
    this.touch();
  }

  /** Undo a soft allocation (reservation released or cancelled). */
  releaseReservation(qty: number): void {
    assertPositiveQuantity(qty);
    if (qty > this.props.reserved) {
      throw new DomainError(
        `Cannot release ${qty} of ${this.props.sku}: only ${this.props.reserved} reserved`,
        "RESERVATION_UNDERFLOW",
        409,
      );
    }
    this.props.reserved -= qty;
    this.touch();
  }

  /** Fulfillment: reserved units physically leave; both counters shrink together. */
  consumeReserved(qty: number): void {
    assertPositiveQuantity(qty);
    if (qty > this.props.reserved) {
      throw new DomainError(
        `Cannot consume ${qty} reserved of ${this.props.sku}: only ${this.props.reserved} reserved`,
        "RESERVATION_UNDERFLOW",
        409,
      );
    }
    this.props.reserved -= qty;
    this.props.onHand -= qty;
    this.touch();
  }

  /**
   * Set on-hand to an absolute value (cycle count / correction).
   * Cannot drop below the reserved quantity — reservations must be released first.
   * Returns the signed delta actually applied.
   */
  adjustTo(newOnHand: number): number {
    assertNonNegativeQuantity(newOnHand, "newOnHand");
    if (newOnHand < this.props.reserved) {
      throw new DomainError(
        `Cannot adjust ${this.props.sku} to ${newOnHand}: ${this.props.reserved} units are reserved`,
        "ADJUSTMENT_BELOW_RESERVED",
        409,
      );
    }
    const delta = newOnHand - this.props.onHand;
    this.props.onHand = newOnHand;
    this.touch();
    return delta;
  }

  /** Relative adjustment; delegates to adjustTo for the invariant checks. */
  adjustBy(delta: number): number {
    const target = this.props.onHand + delta;
    if (target < 0) {
      throw new DomainError(
        `Cannot adjust ${this.props.sku} by ${delta}: on-hand is ${this.props.onHand}`,
        "INSUFFICIENT_STOCK",
        409,
      );
    }
    return this.adjustTo(target);
  }
}
