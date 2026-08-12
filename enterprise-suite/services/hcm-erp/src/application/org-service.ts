import {
  ConflictError,
  NotFoundError,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { DomainError } from "@enterprise-suite/shared-kernel";
import { OrgUnit, type OrgUnitKind } from "../domain/org-unit.js";
import { Position, type Grade } from "../domain/position.js";
import type { EventOutbox, OrgUnitRepository, PositionRepository } from "./ports.js";

const MAX_TREE_DEPTH = 32;

export class OrgService {
  constructor(
    private readonly orgUnits: OrgUnitRepository,
    private readonly positions: PositionRepository,
    private readonly outbox: EventOutbox,
  ) {}

  // ------------------------------------------------------------- org units

  createOrgUnit(
    tenantId: TenantId,
    input: {
      code: string;
      name: string;
      kind: OrgUnitKind;
      parentId?: string;
      costCenter?: string;
    },
  ): OrgUnit {
    if (this.orgUnits.findByCode(tenantId, input.code.trim().toUpperCase())) {
      throw new ConflictError(`Org unit code already exists: ${input.code}`);
    }
    let parentKind: OrgUnitKind | undefined;
    if (input.parentId) {
      const parent = this.getOrgUnit(tenantId, input.parentId as Ulid);
      if (!parent.isActive()) {
        throw new ConflictError(`Parent org unit ${parent.code} is inactive`);
      }
      parentKind = parent.kind;
    }
    const unit = OrgUnit.create(tenantId, {
      code: input.code,
      name: input.name,
      kind: input.kind,
      parentId: input.parentId as Ulid | undefined,
      parentKind,
      costCenter: input.costCenter,
    });
    this.orgUnits.save(unit);
    this.outbox.append(unit.pullEvents());
    return unit;
  }

  getOrgUnit(tenantId: TenantId, id: Ulid): OrgUnit {
    const unit = this.orgUnits.findById(tenantId, id);
    if (!unit) throw new NotFoundError("OrgUnit", id);
    return unit;
  }

  listOrgUnits(tenantId: TenantId): OrgUnit[] {
    return this.orgUnits.listByTenant(tenantId);
  }

  renameOrgUnit(tenantId: TenantId, id: Ulid, name: string): OrgUnit {
    const unit = this.getOrgUnit(tenantId, id);
    unit.rename(name);
    this.orgUnits.save(unit);
    return unit;
  }

  moveOrgUnit(tenantId: TenantId, id: Ulid, newParentId: Ulid): OrgUnit {
    const unit = this.getOrgUnit(tenantId, id);
    const newParent = this.getOrgUnit(tenantId, newParentId);
    if (!newParent.isActive()) {
      throw new ConflictError(`Target parent ${newParent.code} is inactive`);
    }
    // Walking up from the target parent must never reach the moved unit.
    let cursor: OrgUnit | undefined = newParent;
    let depth = 0;
    while (cursor) {
      if (cursor.id === unit.id) {
        throw new DomainError(
          `Moving ${unit.code} under ${newParent.code} would create a cycle`,
          "ORG_CYCLE",
          409,
        );
      }
      if (++depth > MAX_TREE_DEPTH) {
        throw new DomainError("Org tree exceeds maximum depth", "ORG_TREE_TOO_DEEP", 500);
      }
      cursor = cursor.parentId ? this.orgUnits.findById(tenantId, cursor.parentId) : undefined;
    }
    unit.moveTo(newParentId, newParent.kind);
    this.orgUnits.save(unit);
    this.outbox.append(unit.pullEvents());
    return unit;
  }

  /**
   * Deactivates a unit. Requires all child units inactive and no filled
   * positions; any remaining open/frozen positions are eliminated as part of
   * the same operation.
   */
  deactivateOrgUnit(tenantId: TenantId, id: Ulid): OrgUnit {
    const unit = this.getOrgUnit(tenantId, id);
    const activeChildren = this.orgUnits.findChildren(tenantId, id).filter((c) => c.isActive());
    if (activeChildren.length > 0) {
      throw new ConflictError(
        `Org unit ${unit.code} still has active children: ${activeChildren.map((c) => c.code).join(", ")}`,
      );
    }
    const unitPositions = this.positions.findByOrgUnit(tenantId, id);
    const filled = unitPositions.filter((p) => p.status === "filled");
    if (filled.length > 0) {
      throw new ConflictError(
        `Org unit ${unit.code} still has ${filled.length} filled position(s); transfer or terminate first`,
      );
    }
    for (const position of unitPositions) {
      if (position.status === "open" || position.status === "frozen") {
        if (position.status === "frozen") position.unfreeze();
        position.eliminate();
        this.positions.save(position);
        this.outbox.append(position.pullEvents());
      }
    }
    unit.deactivate();
    this.orgUnits.save(unit);
    this.outbox.append(unit.pullEvents());
    return unit;
  }

  /** Full subtree (breadth-first) of active units under a root. */
  subtree(tenantId: TenantId, rootId: Ulid): OrgUnit[] {
    const root = this.getOrgUnit(tenantId, rootId);
    const result: OrgUnit[] = [root];
    const queue: Ulid[] = [rootId];
    while (queue.length > 0) {
      const current = queue.shift() as Ulid;
      for (const child of this.orgUnits.findChildren(tenantId, current)) {
        result.push(child);
        queue.push(child.id);
      }
      if (result.length > 10_000) {
        throw new DomainError("Org subtree too large to materialize", "ORG_TREE_TOO_DEEP", 500);
      }
    }
    return result;
  }

  // ------------------------------------------------------------- positions

  openPosition(
    tenantId: TenantId,
    input: {
      orgUnitId: Ulid;
      title: string;
      jobFamily?: string;
      grade: Grade;
      fte?: number;
      reportsToPositionId?: Ulid;
    },
  ): Position {
    const unit = this.getOrgUnit(tenantId, input.orgUnitId);
    if (!unit.isActive()) {
      throw new ConflictError(`Cannot open a position in inactive org unit ${unit.code}`);
    }
    if (input.reportsToPositionId) {
      this.getPosition(tenantId, input.reportsToPositionId);
    }
    const position = Position.open(tenantId, {
      orgUnitId: input.orgUnitId,
      title: input.title,
      jobFamily: input.jobFamily ?? "general",
      grade: input.grade,
      fte: input.fte,
      reportsToPositionId: input.reportsToPositionId,
    });
    this.positions.save(position);
    this.outbox.append(position.pullEvents());
    return position;
  }

  getPosition(tenantId: TenantId, id: Ulid): Position {
    const position = this.positions.findById(tenantId, id);
    if (!position) throw new NotFoundError("Position", id);
    return position;
  }

  listPositions(tenantId: TenantId, orgUnitId?: Ulid): Position[] {
    return orgUnitId
      ? this.positions.findByOrgUnit(tenantId, orgUnitId)
      : this.positions.listByTenant(tenantId);
  }

  freezePosition(tenantId: TenantId, id: Ulid, reason: string): Position {
    const position = this.getPosition(tenantId, id);
    position.freeze(reason);
    this.positions.save(position);
    this.outbox.append(position.pullEvents());
    return position;
  }

  unfreezePosition(tenantId: TenantId, id: Ulid): Position {
    const position = this.getPosition(tenantId, id);
    position.unfreeze();
    this.positions.save(position);
    this.outbox.append(position.pullEvents());
    return position;
  }

  eliminatePosition(tenantId: TenantId, id: Ulid): Position {
    const position = this.getPosition(tenantId, id);
    position.eliminate();
    this.positions.save(position);
    this.outbox.append(position.pullEvents());
    return position;
  }

  changePositionReportsTo(tenantId: TenantId, id: Ulid, reportsToPositionId?: Ulid): Position {
    const position = this.getPosition(tenantId, id);
    if (reportsToPositionId) {
      // Walking the reporting chain from the new boss must not reach `position`.
      let cursor: Position | undefined = this.getPosition(tenantId, reportsToPositionId);
      let depth = 0;
      while (cursor) {
        if (cursor.id === position.id) {
          throw new DomainError(
            `Position reporting line would form a cycle via ${cursor.title}`,
            "POSITION_REPORT_CYCLE",
            409,
          );
        }
        if (++depth > MAX_TREE_DEPTH) {
          throw new DomainError("Reporting chain exceeds maximum depth", "ORG_TREE_TOO_DEEP", 500);
        }
        cursor = cursor.reportsToPositionId
          ? this.positions.findById(tenantId, cursor.reportsToPositionId)
          : undefined;
      }
    }
    position.changeReportsTo(reportsToPositionId);
    this.positions.save(position);
    return position;
  }
}
