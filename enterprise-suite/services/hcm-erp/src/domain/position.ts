import {
  AggregateRoot,
  DomainError,
  envelope,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { HcmEvents } from "./events.js";

export type PositionStatus = "open" | "filled" | "frozen" | "eliminated";

/** Individual-contributor and management grade ladders. */
export const GRADES = ["IC1", "IC2", "IC3", "IC4", "IC5", "IC6", "IC7", "M1", "M2", "M3", "M4", "M5"] as const;
export type Grade = (typeof GRADES)[number];

export interface PositionProps {
  orgUnitId: Ulid;
  title: string;
  jobFamily: string;
  grade: Grade;
  fte: number;
  reportsToPositionId?: Ulid;
  status: PositionStatus;
  currentEmployeeId?: Ulid;
}

export class Position extends AggregateRoot<PositionProps> {
  private constructor(tenantId: TenantId, props: PositionProps) {
    super(tenantId, props);
  }

  static open(
    tenantId: TenantId,
    input: {
      orgUnitId: Ulid;
      title: string;
      jobFamily: string;
      grade: Grade;
      fte?: number;
      reportsToPositionId?: Ulid;
    },
  ): Position {
    if (!input.title.trim()) throw new DomainError("Position title is required", "INVALID_POSITION");
    if (!GRADES.includes(input.grade)) {
      throw new DomainError(`Unknown grade "${input.grade}"`, "INVALID_GRADE");
    }
    const fte = input.fte ?? 1;
    if (fte <= 0 || fte > 1) {
      throw new DomainError(`FTE must be in (0, 1], got ${fte}`, "INVALID_FTE");
    }
    const position = new Position(tenantId, {
      orgUnitId: input.orgUnitId,
      title: input.title.trim(),
      jobFamily: input.jobFamily.trim() || "general",
      grade: input.grade,
      fte,
      reportsToPositionId: input.reportsToPositionId,
      status: "open",
    });
    position.raise(
      envelope({
        eventType: HcmEvents.PositionOpened,
        aggregateType: "Position",
        aggregateId: position.id,
        tenantId,
        payload: { orgUnitId: input.orgUnitId, title: position.props.title, grade: input.grade },
      }),
    );
    return position;
  }

  get orgUnitId(): Ulid {
    return this.props.orgUnitId;
  }
  get title(): string {
    return this.props.title;
  }
  get grade(): Grade {
    return this.props.grade;
  }
  get status(): PositionStatus {
    return this.props.status;
  }
  get currentEmployeeId(): Ulid | undefined {
    return this.props.currentEmployeeId;
  }
  get reportsToPositionId(): Ulid | undefined {
    return this.props.reportsToPositionId;
  }
  get fte(): number {
    return this.props.fte;
  }

  isFillable(): boolean {
    return this.props.status === "open";
  }

  fill(employeeId: Ulid): void {
    if (this.props.status !== "open") {
      throw new DomainError(
        `Position "${this.props.title}" cannot be filled from status ${this.props.status}`,
        "POSITION_NOT_OPEN",
        409,
      );
    }
    this.props.status = "filled";
    this.props.currentEmployeeId = employeeId;
    this.raise(
      envelope({
        eventType: HcmEvents.PositionFilled,
        aggregateType: "Position",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { positionId: this.id, employeeId, orgUnitId: this.props.orgUnitId },
      }),
    );
  }

  vacate(): void {
    if (this.props.status !== "filled") {
      throw new DomainError(
        `Position "${this.props.title}" is not filled and cannot be vacated`,
        "POSITION_NOT_FILLED",
        409,
      );
    }
    const previousEmployeeId = this.props.currentEmployeeId;
    this.props.status = "open";
    this.props.currentEmployeeId = undefined;
    this.raise(
      envelope({
        eventType: HcmEvents.PositionVacated,
        aggregateType: "Position",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { positionId: this.id, previousEmployeeId },
      }),
    );
  }

  freeze(reason: string): void {
    if (this.props.status !== "open") {
      throw new DomainError(
        `Only open positions can be frozen (status: ${this.props.status})`,
        "POSITION_NOT_OPEN",
        409,
      );
    }
    this.props.status = "frozen";
    this.raise(
      envelope({
        eventType: HcmEvents.PositionFrozen,
        aggregateType: "Position",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { reason },
      }),
    );
  }

  unfreeze(): void {
    if (this.props.status !== "frozen") {
      throw new DomainError(`Position is not frozen (status: ${this.props.status})`, "POSITION_NOT_FROZEN", 409);
    }
    this.props.status = "open";
    this.raise(
      envelope({
        eventType: HcmEvents.PositionUnfrozen,
        aggregateType: "Position",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {},
      }),
    );
  }

  eliminate(): void {
    if (this.props.status === "filled") {
      throw new DomainError("A filled position must be vacated before elimination", "POSITION_FILLED", 409);
    }
    if (this.props.status === "eliminated") {
      throw new DomainError("Position is already eliminated", "ALREADY_ELIMINATED", 409);
    }
    this.props.status = "eliminated";
    this.raise(
      envelope({
        eventType: HcmEvents.PositionEliminated,
        aggregateType: "Position",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { title: this.props.title, orgUnitId: this.props.orgUnitId },
      }),
    );
  }

  changeReportsTo(reportsToPositionId: Ulid | undefined): void {
    if (reportsToPositionId === this.id) {
      throw new DomainError("A position cannot report to itself", "POSITION_SELF_REPORT");
    }
    if (this.props.status === "eliminated") {
      throw new DomainError("Cannot modify an eliminated position", "POSITION_ELIMINATED", 409);
    }
    this.props.reportsToPositionId = reportsToPositionId;
    this.touch();
  }
}
