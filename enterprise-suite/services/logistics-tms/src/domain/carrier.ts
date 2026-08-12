import {
  AggregateRoot,
  ConflictError,
  DomainError,
  NotFoundError,
  envelope,
  type TenantId,
} from "@enterprise-suite/shared-kernel";
import { LogisticsEvents, type CarrierCreatedPayload } from "./events.js";
import { isTransportMode, type TransportMode } from "./values.js";

export type CarrierStatus = "active" | "inactive";

/**
 * A service level (a.k.a. service product) offered by a carrier,
 * e.g. GROUND, EXPRESS, LTL_STANDARD. Rate cards are keyed by
 * (carrierId, serviceLevelCode).
 */
export interface ServiceLevel {
  readonly code: string;
  readonly name: string;
  /** Business-day transit commitment. 0 means same-day. */
  readonly transitDays: number;
  /** Local hour (0-23) after which pickups roll to the next day. */
  readonly cutoffHour: number;
  readonly signatureRequired: boolean;
}

export interface CarrierProps {
  code: string;
  name: string;
  mode: TransportMode;
  status: CarrierStatus;
  /** Standard Carrier Alpha Code, when the carrier has one. */
  scac?: string;
  serviceLevels: ServiceLevel[];
}

export interface CreateCarrierInput {
  readonly code: string;
  readonly name: string;
  readonly mode: TransportMode;
  readonly scac?: string;
}

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,19}$/;

function validateServiceLevel(input: ServiceLevel): ServiceLevel {
  if (!CODE_PATTERN.test(input.code?.toUpperCase() ?? "")) {
    throw new DomainError(
      "serviceLevel.code must be 2-20 chars of A-Z, 0-9, '_' or '-'",
      "VALIDATION",
    );
  }
  if (typeof input.name !== "string" || input.name.trim().length === 0) {
    throw new DomainError("serviceLevel.name is required", "VALIDATION");
  }
  if (!Number.isInteger(input.transitDays) || input.transitDays < 0 || input.transitDays > 60) {
    throw new DomainError("serviceLevel.transitDays must be an integer 0-60", "VALIDATION");
  }
  if (!Number.isInteger(input.cutoffHour) || input.cutoffHour < 0 || input.cutoffHour > 23) {
    throw new DomainError("serviceLevel.cutoffHour must be an integer 0-23", "VALIDATION");
  }
  return {
    code: input.code.toUpperCase(),
    name: input.name.trim(),
    transitDays: input.transitDays,
    cutoffHour: input.cutoffHour,
    signatureRequired: Boolean(input.signatureRequired),
  };
}

export class Carrier extends AggregateRoot<CarrierProps> {
  private constructor(tenantId: TenantId, props: CarrierProps) {
    super(tenantId, props);
  }

  static create(tenantId: TenantId, input: CreateCarrierInput): Carrier {
    const code = input.code?.toUpperCase() ?? "";
    if (!CODE_PATTERN.test(code)) {
      throw new DomainError(
        "carrier.code must be 2-20 chars of A-Z, 0-9, '_' or '-'",
        "VALIDATION",
      );
    }
    if (typeof input.name !== "string" || input.name.trim().length === 0) {
      throw new DomainError("carrier.name is required", "VALIDATION");
    }
    if (!isTransportMode(input.mode)) {
      throw new DomainError("carrier.mode must be one of parcel|ltl|ftl", "VALIDATION");
    }
    if (input.scac !== undefined && !/^[A-Z]{2,4}$/.test(input.scac.toUpperCase())) {
      throw new DomainError("carrier.scac must be 2-4 letters", "VALIDATION");
    }
    const carrier = new Carrier(tenantId, {
      code,
      name: input.name.trim(),
      mode: input.mode,
      status: "active",
      scac: input.scac?.toUpperCase(),
      serviceLevels: [],
    });
    carrier.raise(
      envelope<CarrierCreatedPayload>({
        eventType: LogisticsEvents.CarrierCreated,
        aggregateType: "Carrier",
        aggregateId: carrier.id,
        tenantId,
        payload: { carrierId: carrier.id, code, name: carrier.props.name, mode: input.mode },
      }),
    );
    return carrier;
  }

  get code(): string {
    return this.props.code;
  }

  get name(): string {
    return this.props.name;
  }

  get mode(): TransportMode {
    return this.props.mode;
  }

  get status(): CarrierStatus {
    return this.props.status;
  }

  get serviceLevels(): readonly ServiceLevel[] {
    return this.props.serviceLevels;
  }

  isActive(): boolean {
    return this.props.status === "active";
  }

  serviceLevel(code: string): ServiceLevel | undefined {
    const upper = code.toUpperCase();
    return this.props.serviceLevels.find((sl) => sl.code === upper);
  }

  update(input: { name?: string; scac?: string }): void {
    if (input.name !== undefined) {
      if (input.name.trim().length === 0) {
        throw new DomainError("carrier.name cannot be blank", "VALIDATION");
      }
      this.props.name = input.name.trim();
    }
    if (input.scac !== undefined) {
      if (!/^[A-Z]{2,4}$/.test(input.scac.toUpperCase())) {
        throw new DomainError("carrier.scac must be 2-4 letters", "VALIDATION");
      }
      this.props.scac = input.scac.toUpperCase();
    }
    this.raise(
      envelope({
        eventType: LogisticsEvents.CarrierUpdated,
        aggregateType: "Carrier",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { carrierId: this.id, name: this.props.name, scac: this.props.scac },
      }),
    );
  }

  activate(): void {
    if (this.props.status === "active") {
      throw new ConflictError(`Carrier ${this.props.code} is already active`);
    }
    this.props.status = "active";
    this.raise(
      envelope({
        eventType: LogisticsEvents.CarrierActivated,
        aggregateType: "Carrier",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { carrierId: this.id, code: this.props.code },
      }),
    );
  }

  deactivate(): void {
    if (this.props.status === "inactive") {
      throw new ConflictError(`Carrier ${this.props.code} is already inactive`);
    }
    this.props.status = "inactive";
    this.raise(
      envelope({
        eventType: LogisticsEvents.CarrierDeactivated,
        aggregateType: "Carrier",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { carrierId: this.id, code: this.props.code },
      }),
    );
  }

  /** Adds a new service level or replaces an existing one with the same code. */
  upsertServiceLevel(input: ServiceLevel): ServiceLevel {
    const level = validateServiceLevel(input);
    const idx = this.props.serviceLevels.findIndex((sl) => sl.code === level.code);
    if (idx >= 0) {
      this.props.serviceLevels[idx] = level;
    } else {
      this.props.serviceLevels.push(level);
    }
    this.raise(
      envelope({
        eventType: LogisticsEvents.CarrierServiceLevelUpserted,
        aggregateType: "Carrier",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { carrierId: this.id, serviceLevel: level },
      }),
    );
    return level;
  }

  removeServiceLevel(code: string): void {
    const upper = code.toUpperCase();
    const idx = this.props.serviceLevels.findIndex((sl) => sl.code === upper);
    if (idx < 0) {
      throw new NotFoundError("ServiceLevel", upper);
    }
    this.props.serviceLevels.splice(idx, 1);
    this.raise(
      envelope({
        eventType: LogisticsEvents.CarrierServiceLevelRemoved,
        aggregateType: "Carrier",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { carrierId: this.id, serviceLevelCode: upper },
      }),
    );
  }
}
