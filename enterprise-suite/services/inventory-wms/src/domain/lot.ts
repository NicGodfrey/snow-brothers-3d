import {
  DomainError,
  Entity,
  nowIso,
  type IsoDateTime,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { assertTransition, type TransitionMap } from "./state-machine.js";

// ---------------------------------------------------------------------------
// Lot (batch) — the granularity at which expiry/quarantine is managed.
// ---------------------------------------------------------------------------

export type LotStatus = "AVAILABLE" | "QUARANTINE" | "EXPIRED" | "CONSUMED";

const LOT_TRANSITIONS: TransitionMap<LotStatus> = {
  AVAILABLE: ["QUARANTINE", "EXPIRED", "CONSUMED"],
  QUARANTINE: ["AVAILABLE", "EXPIRED", "CONSUMED"],
  EXPIRED: ["CONSUMED"],
  CONSUMED: [],
};

const LOT_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export interface LotProps {
  sku: string;
  lotCode: string;
  status: LotStatus;
  receivedAt: IsoDateTime;
  manufacturedAt?: IsoDateTime;
  expiresAt?: IsoDateTime;
  supplierRef?: string;
}

export class Lot extends Entity<LotProps> {
  static create(
    tenantId: TenantId,
    input: {
      sku: string;
      lotCode: string;
      manufacturedAt?: IsoDateTime;
      expiresAt?: IsoDateTime;
      supplierRef?: string;
    },
  ): Lot {
    const lotCode = input.lotCode.trim();
    if (!LOT_CODE_PATTERN.test(lotCode)) {
      throw new DomainError(`Invalid lot code "${input.lotCode}"`, "INVALID_LOT_CODE", 400);
    }
    if (input.manufacturedAt && input.expiresAt && input.manufacturedAt >= input.expiresAt) {
      throw new DomainError(
        "Lot expiresAt must be after manufacturedAt",
        "INVALID_LOT_DATES",
        400,
      );
    }
    return new Lot(tenantId, {
      sku: input.sku,
      lotCode,
      status: "AVAILABLE",
      receivedAt: nowIso(),
      manufacturedAt: input.manufacturedAt,
      expiresAt: input.expiresAt,
      supplierRef: input.supplierRef?.trim(),
    });
  }

  get sku(): string {
    return this.props.sku;
  }

  get lotCode(): string {
    return this.props.lotCode;
  }

  get status(): LotStatus {
    return this.props.status;
  }

  get expiresAt(): IsoDateTime | undefined {
    return this.props.expiresAt;
  }

  get receivedAt(): IsoDateTime {
    return this.props.receivedAt;
  }

  isExpiredAt(now: IsoDateTime): boolean {
    return this.props.expiresAt !== undefined && this.props.expiresAt <= now;
  }

  /** A lot is usable for receipt/allocation only when AVAILABLE and not past expiry. */
  isUsableAt(now: IsoDateTime): boolean {
    return this.props.status === "AVAILABLE" && !this.isExpiredAt(now);
  }

  assertUsable(now: IsoDateTime): void {
    if (!this.isUsableAt(now)) {
      throw new DomainError(
        `Lot ${this.props.lotCode} for ${this.props.sku} is not usable (status=${this.props.status}${
          this.isExpiredAt(now) ? ", expired" : ""
        })`,
        "LOT_NOT_USABLE",
        409,
      );
    }
  }

  quarantine(): void {
    this.changeStatus("QUARANTINE");
  }

  release(): void {
    this.changeStatus("AVAILABLE");
  }

  markExpired(): void {
    this.changeStatus("EXPIRED");
  }

  markConsumed(): void {
    this.changeStatus("CONSUMED");
  }

  private changeStatus(to: LotStatus): void {
    assertTransition(`Lot ${this.props.lotCode}`, LOT_TRANSITIONS, this.props.status, to);
    this.props.status = to;
    this.touch();
  }
}

// ---------------------------------------------------------------------------
// Serial unit — individually tracked items, optionally tied to a lot.
// ---------------------------------------------------------------------------

export type SerialStatus = "IN_STOCK" | "RESERVED" | "SHIPPED" | "RETURNED" | "SCRAPPED";

const SERIAL_TRANSITIONS: TransitionMap<SerialStatus> = {
  IN_STOCK: ["RESERVED", "SHIPPED", "SCRAPPED"],
  RESERVED: ["IN_STOCK", "SHIPPED"],
  SHIPPED: ["RETURNED"],
  RETURNED: ["IN_STOCK", "SCRAPPED"],
  SCRAPPED: [],
};

const SERIAL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export interface SerialUnitProps {
  sku: string;
  serialNumber: string;
  status: SerialStatus;
  warehouseId: Ulid | null;
  binId: Ulid | null;
  lotId: Ulid | null;
}

export class SerialUnit extends Entity<SerialUnitProps> {
  static register(
    tenantId: TenantId,
    input: {
      sku: string;
      serialNumber: string;
      warehouseId: Ulid;
      binId: Ulid;
      lotId?: Ulid | null;
    },
  ): SerialUnit {
    const serialNumber = input.serialNumber.trim();
    if (!SERIAL_PATTERN.test(serialNumber)) {
      throw new DomainError(
        `Invalid serial number "${input.serialNumber}"`,
        "INVALID_SERIAL",
        400,
      );
    }
    return new SerialUnit(tenantId, {
      sku: input.sku,
      serialNumber,
      status: "IN_STOCK",
      warehouseId: input.warehouseId,
      binId: input.binId,
      lotId: input.lotId ?? null,
    });
  }

  get sku(): string {
    return this.props.sku;
  }

  get serialNumber(): string {
    return this.props.serialNumber;
  }

  get status(): SerialStatus {
    return this.props.status;
  }

  get binId(): Ulid | null {
    return this.props.binId;
  }

  reserve(): void {
    this.changeStatus("RESERVED");
  }

  unreserve(): void {
    if (this.props.status !== "RESERVED") {
      throw new DomainError(
        `Serial ${this.props.serialNumber} is not reserved`,
        "CONFLICT",
        409,
      );
    }
    this.changeStatus("IN_STOCK");
  }

  ship(): void {
    this.changeStatus("SHIPPED");
    this.props.binId = null;
    this.props.warehouseId = null;
  }

  returnToStock(warehouseId: Ulid, binId: Ulid): void {
    if (this.props.status === "SHIPPED") {
      // A shipped unit passes through RETURNED, then re-enters stock.
      this.changeStatus("RETURNED");
    }
    this.changeStatus("IN_STOCK");
    this.props.warehouseId = warehouseId;
    this.props.binId = binId;
  }

  moveTo(binId: Ulid): void {
    if (this.props.status !== "IN_STOCK" && this.props.status !== "RESERVED") {
      throw new DomainError(
        `Serial ${this.props.serialNumber} cannot move while ${this.props.status}`,
        "CONFLICT",
        409,
      );
    }
    this.props.binId = binId;
    this.touch();
  }

  scrap(): void {
    this.changeStatus("SCRAPPED");
    this.props.binId = null;
  }

  private changeStatus(to: SerialStatus): void {
    assertTransition(
      `Serial ${this.props.serialNumber}`,
      SERIAL_TRANSITIONS,
      this.props.status,
      to,
    );
    this.props.status = to;
    this.touch();
  }
}
