import {
  AggregateRoot,
  DomainError,
  envelope,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { HcmEvents } from "./events.js";

export type OrgUnitKind = "company" | "division" | "department" | "team";
export type OrgUnitStatus = "active" | "inactive";

const ORG_CODE_RE = /^[A-Z0-9][A-Z0-9_-]{1,31}$/;

/** Which kinds may nest under which parent kinds. `company` is always a root. */
const ALLOWED_PARENT_KINDS: Record<OrgUnitKind, readonly OrgUnitKind[]> = {
  company: [],
  division: ["company"],
  department: ["company", "division"],
  team: ["division", "department"],
};

export interface OrgUnitProps {
  code: string;
  name: string;
  kind: OrgUnitKind;
  parentId?: Ulid;
  costCenter?: string;
  managerPositionId?: Ulid;
  status: OrgUnitStatus;
}

export class OrgUnit extends AggregateRoot<OrgUnitProps> {
  private constructor(tenantId: TenantId, props: OrgUnitProps) {
    super(tenantId, props);
  }

  static create(
    tenantId: TenantId,
    input: {
      code: string;
      name: string;
      kind: OrgUnitKind;
      parentId?: Ulid;
      parentKind?: OrgUnitKind;
      costCenter?: string;
    },
  ): OrgUnit {
    const code = input.code.trim().toUpperCase();
    if (!ORG_CODE_RE.test(code)) {
      throw new DomainError(
        `Org unit code must be 2-32 chars of A-Z, 0-9, '_' or '-': got "${input.code}"`,
        "INVALID_ORG_CODE",
      );
    }
    if (!input.name.trim()) {
      throw new DomainError("Org unit name is required", "INVALID_ORG_NAME");
    }
    OrgUnit.assertNesting(input.kind, input.parentId, input.parentKind);

    const unit = new OrgUnit(tenantId, {
      code,
      name: input.name.trim(),
      kind: input.kind,
      parentId: input.parentId,
      costCenter: input.costCenter?.trim() || undefined,
      status: "active",
    });
    unit.raise(
      envelope({
        eventType: HcmEvents.OrgUnitCreated,
        aggregateType: "OrgUnit",
        aggregateId: unit.id,
        tenantId,
        payload: { code, name: unit.props.name, kind: input.kind, parentId: input.parentId },
      }),
    );
    return unit;
  }

  private static assertNesting(kind: OrgUnitKind, parentId?: Ulid, parentKind?: OrgUnitKind): void {
    if (kind === "company") {
      if (parentId) throw new DomainError("A company org unit cannot have a parent", "INVALID_ORG_NESTING");
      return;
    }
    if (!parentId) {
      throw new DomainError(`A ${kind} must belong to a parent org unit`, "INVALID_ORG_NESTING");
    }
    if (parentKind && !ALLOWED_PARENT_KINDS[kind].includes(parentKind)) {
      throw new DomainError(
        `A ${kind} cannot be nested under a ${parentKind}`,
        "INVALID_ORG_NESTING",
      );
    }
  }

  get code(): string {
    return this.props.code;
  }
  get name(): string {
    return this.props.name;
  }
  get kind(): OrgUnitKind {
    return this.props.kind;
  }
  get parentId(): Ulid | undefined {
    return this.props.parentId;
  }
  get status(): OrgUnitStatus {
    return this.props.status;
  }
  get managerPositionId(): Ulid | undefined {
    return this.props.managerPositionId;
  }

  isActive(): boolean {
    return this.props.status === "active";
  }

  rename(name: string): void {
    this.assertActive();
    if (!name.trim()) throw new DomainError("Org unit name is required", "INVALID_ORG_NAME");
    this.props.name = name.trim();
    this.touch();
  }

  setCostCenter(costCenter: string | undefined): void {
    this.assertActive();
    this.props.costCenter = costCenter?.trim() || undefined;
    this.touch();
  }

  assignManagerPosition(positionId: Ulid): void {
    this.assertActive();
    this.props.managerPositionId = positionId;
    this.touch();
  }

  /**
   * Re-parents the unit. Cycle detection requires walking the tree, so it is
   * enforced by OrgService which has repository access; this method only
   * enforces local invariants.
   */
  moveTo(newParentId: Ulid, newParentKind: OrgUnitKind): void {
    this.assertActive();
    if (this.props.kind === "company") {
      throw new DomainError("A company org unit cannot be moved under another unit", "INVALID_ORG_NESTING");
    }
    if (newParentId === this.id) {
      throw new DomainError("An org unit cannot be its own parent", "ORG_CYCLE");
    }
    if (!ALLOWED_PARENT_KINDS[this.props.kind].includes(newParentKind)) {
      throw new DomainError(
        `A ${this.props.kind} cannot be nested under a ${newParentKind}`,
        "INVALID_ORG_NESTING",
      );
    }
    const previousParentId = this.props.parentId;
    this.props.parentId = newParentId;
    this.raise(
      envelope({
        eventType: HcmEvents.OrgUnitMoved,
        aggregateType: "OrgUnit",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { previousParentId, newParentId },
      }),
    );
  }

  /** Preconditions (no active children, no filled positions) checked by OrgService. */
  deactivate(): void {
    if (this.props.status === "inactive") {
      throw new DomainError(`Org unit ${this.props.code} is already inactive`, "ALREADY_INACTIVE", 409);
    }
    this.props.status = "inactive";
    this.raise(
      envelope({
        eventType: HcmEvents.OrgUnitDeactivated,
        aggregateType: "OrgUnit",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { code: this.props.code },
      }),
    );
  }

  private assertActive(): void {
    if (this.props.status !== "active") {
      throw new DomainError(`Org unit ${this.props.code} is inactive`, "ORG_UNIT_INACTIVE", 409);
    }
  }
}
