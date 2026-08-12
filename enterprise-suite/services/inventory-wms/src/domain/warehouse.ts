import {
  AggregateRoot,
  DomainError,
  Entity,
  envelope,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { InventoryEvents } from "./events.js";
import { assertTransition, type TransitionMap } from "./state-machine.js";

// ---------------------------------------------------------------------------
// Codes
// ---------------------------------------------------------------------------

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,31}$/;

export function normalizeCode(raw: string, field: string): string {
  const value = raw.trim().toUpperCase();
  if (!CODE_PATTERN.test(value)) {
    throw new DomainError(
      `${field} must match ${CODE_PATTERN} (got "${raw}")`,
      "INVALID_CODE",
      400,
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Warehouse
// ---------------------------------------------------------------------------

export type WarehouseStatus = "ACTIVE" | "INACTIVE";

const WAREHOUSE_TRANSITIONS: TransitionMap<WarehouseStatus> = {
  ACTIVE: ["INACTIVE"],
  INACTIVE: ["ACTIVE"],
};

export interface WarehouseProps {
  code: string;
  name: string;
  status: WarehouseStatus;
  addressLine1?: string;
  city?: string;
  country?: string;
  timezone?: string;
}

export class Warehouse extends AggregateRoot<WarehouseProps> {
  static create(
    tenantId: TenantId,
    input: {
      code: string;
      name: string;
      addressLine1?: string;
      city?: string;
      country?: string;
      timezone?: string;
    },
  ): Warehouse {
    const name = input.name.trim();
    if (name.length === 0 || name.length > 120) {
      throw new DomainError("Warehouse name must be 1-120 characters", "INVALID_NAME", 400);
    }
    const warehouse = new Warehouse(tenantId, {
      code: normalizeCode(input.code, "warehouse code"),
      name,
      status: "ACTIVE",
      addressLine1: input.addressLine1?.trim(),
      city: input.city?.trim(),
      country: input.country?.trim().toUpperCase(),
      timezone: input.timezone?.trim(),
    });
    warehouse.raise(
      envelope({
        eventType: InventoryEvents.WarehouseCreated,
        aggregateType: "Warehouse",
        aggregateId: warehouse.id,
        tenantId,
        payload: { code: warehouse.code, name: warehouse.name },
      }),
    );
    return warehouse;
  }

  get code(): string {
    return this.props.code;
  }

  get name(): string {
    return this.props.name;
  }

  get status(): WarehouseStatus {
    return this.props.status;
  }

  get isActive(): boolean {
    return this.props.status === "ACTIVE";
  }

  rename(name: string): void {
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > 120) {
      throw new DomainError("Warehouse name must be 1-120 characters", "INVALID_NAME", 400);
    }
    this.props.name = trimmed;
    this.touch();
  }

  deactivate(): void {
    this.changeStatus("INACTIVE");
  }

  activate(): void {
    this.changeStatus("ACTIVE");
  }

  private changeStatus(to: WarehouseStatus): void {
    assertTransition(`Warehouse ${this.props.code}`, WAREHOUSE_TRANSITIONS, this.props.status, to);
    this.props.status = to;
    this.raise(
      envelope({
        eventType: InventoryEvents.WarehouseStatusChanged,
        aggregateType: "Warehouse",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { code: this.props.code, status: to },
      }),
    );
  }

  /** Guard used by every stock-mutating use case. */
  assertOperational(): void {
    if (!this.isActive) {
      throw new DomainError(
        `Warehouse ${this.props.code} is inactive`,
        "WAREHOUSE_INACTIVE",
        409,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Zone
// ---------------------------------------------------------------------------

export const ZONE_TYPES = [
  "RECEIVING",
  "STORAGE",
  "PICKING",
  "PACKING",
  "SHIPPING",
  "QUARANTINE",
  "RETURNS",
] as const;
export type ZoneType = (typeof ZONE_TYPES)[number];

export interface ZoneProps {
  warehouseId: Ulid;
  code: string;
  name: string;
  zoneType: ZoneType;
}

export class Zone extends Entity<ZoneProps> {
  static create(
    tenantId: TenantId,
    input: { warehouseId: Ulid; code: string; name: string; zoneType: ZoneType },
  ): Zone {
    const name = input.name.trim();
    if (name.length === 0 || name.length > 120) {
      throw new DomainError("Zone name must be 1-120 characters", "INVALID_NAME", 400);
    }
    return new Zone(tenantId, {
      warehouseId: input.warehouseId,
      code: normalizeCode(input.code, "zone code"),
      name,
      zoneType: input.zoneType,
    });
  }

  get warehouseId(): Ulid {
    return this.props.warehouseId;
  }

  get code(): string {
    return this.props.code;
  }

  get zoneType(): ZoneType {
    return this.props.zoneType;
  }
}

// ---------------------------------------------------------------------------
// Bin (storage location)
// ---------------------------------------------------------------------------

export const BIN_TYPES = ["PALLET", "SHELF", "FLOOR", "FLOW_RACK", "BULK", "STAGING"] as const;
export type BinType = (typeof BIN_TYPES)[number];

export type BinStatus = "AVAILABLE" | "BLOCKED";

export interface BinProps {
  warehouseId: Ulid;
  zoneId: Ulid;
  code: string;
  binType: BinType;
  status: BinStatus;
  /** Optional physical capacity in base units; 0/undefined = unbounded. */
  maxUnits?: number;
  /** Travel-path ordering used to sort pick tasks; lower = visited earlier. */
  pickSequence: number;
  blockedReason?: string;
}

export class Bin extends Entity<BinProps> {
  static create(
    tenantId: TenantId,
    input: {
      warehouseId: Ulid;
      zoneId: Ulid;
      code: string;
      binType: BinType;
      maxUnits?: number;
      pickSequence?: number;
    },
  ): Bin {
    if (input.maxUnits !== undefined && (!Number.isInteger(input.maxUnits) || input.maxUnits < 0)) {
      throw new DomainError("maxUnits must be a non-negative integer", "INVALID_CAPACITY", 400);
    }
    const pickSequence = input.pickSequence ?? 0;
    if (!Number.isInteger(pickSequence) || pickSequence < 0) {
      throw new DomainError("pickSequence must be a non-negative integer", "INVALID_SEQUENCE", 400);
    }
    return new Bin(tenantId, {
      warehouseId: input.warehouseId,
      zoneId: input.zoneId,
      code: normalizeCode(input.code, "bin code"),
      binType: input.binType,
      status: "AVAILABLE",
      maxUnits: input.maxUnits,
      pickSequence,
    });
  }

  get warehouseId(): Ulid {
    return this.props.warehouseId;
  }

  get zoneId(): Ulid {
    return this.props.zoneId;
  }

  get code(): string {
    return this.props.code;
  }

  get status(): BinStatus {
    return this.props.status;
  }

  get pickSequence(): number {
    return this.props.pickSequence;
  }

  get maxUnits(): number | undefined {
    return this.props.maxUnits;
  }

  get isAvailable(): boolean {
    return this.props.status === "AVAILABLE";
  }

  block(reason: string): void {
    if (this.props.status === "BLOCKED") {
      throw new DomainError(`Bin ${this.props.code} is already blocked`, "CONFLICT", 409);
    }
    this.props.status = "BLOCKED";
    this.props.blockedReason = reason.trim() || "unspecified";
    this.touch();
  }

  unblock(): void {
    if (this.props.status === "AVAILABLE") {
      throw new DomainError(`Bin ${this.props.code} is not blocked`, "CONFLICT", 409);
    }
    this.props.status = "AVAILABLE";
    this.props.blockedReason = undefined;
    this.touch();
  }

  assertUsable(): void {
    if (!this.isAvailable) {
      throw new DomainError(
        `Bin ${this.props.code} is blocked (${this.props.blockedReason ?? "unspecified"})`,
        "BIN_BLOCKED",
        409,
      );
    }
  }
}
