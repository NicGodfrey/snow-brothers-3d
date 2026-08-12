import { ConflictError, NotFoundError, } from "@enterprise-suite/shared-kernel";
import { DomainError } from "@enterprise-suite/shared-kernel";
import { OrgUnit } from "../domain/org-unit.js";
import { Position } from "../domain/position.js";
const MAX_TREE_DEPTH = 32;
export class OrgService {
    orgUnits;
    positions;
    outbox;
    constructor(orgUnits, positions, outbox) {
        this.orgUnits = orgUnits;
        this.positions = positions;
        this.outbox = outbox;
    }
    // ------------------------------------------------------------- org units
    createOrgUnit(tenantId, input) {
        if (this.orgUnits.findByCode(tenantId, input.code.trim().toUpperCase())) {
            throw new ConflictError(`Org unit code already exists: ${input.code}`);
        }
        let parentKind;
        if (input.parentId) {
            const parent = this.getOrgUnit(tenantId, input.parentId);
            if (!parent.isActive()) {
                throw new ConflictError(`Parent org unit ${parent.code} is inactive`);
            }
            parentKind = parent.kind;
        }
        const unit = OrgUnit.create(tenantId, {
            code: input.code,
            name: input.name,
            kind: input.kind,
            parentId: input.parentId,
            parentKind,
            costCenter: input.costCenter,
        });
        this.orgUnits.save(unit);
        this.outbox.append(unit.pullEvents());
        return unit;
    }
    getOrgUnit(tenantId, id) {
        const unit = this.orgUnits.findById(tenantId, id);
        if (!unit)
            throw new NotFoundError("OrgUnit", id);
        return unit;
    }
    listOrgUnits(tenantId) {
        return this.orgUnits.listByTenant(tenantId);
    }
    renameOrgUnit(tenantId, id, name) {
        const unit = this.getOrgUnit(tenantId, id);
        unit.rename(name);
        this.orgUnits.save(unit);
        return unit;
    }
    moveOrgUnit(tenantId, id, newParentId) {
        const unit = this.getOrgUnit(tenantId, id);
        const newParent = this.getOrgUnit(tenantId, newParentId);
        if (!newParent.isActive()) {
            throw new ConflictError(`Target parent ${newParent.code} is inactive`);
        }
        // Walking up from the target parent must never reach the moved unit.
        let cursor = newParent;
        let depth = 0;
        while (cursor) {
            if (cursor.id === unit.id) {
                throw new DomainError(`Moving ${unit.code} under ${newParent.code} would create a cycle`, "ORG_CYCLE", 409);
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
    deactivateOrgUnit(tenantId, id) {
        const unit = this.getOrgUnit(tenantId, id);
        const activeChildren = this.orgUnits.findChildren(tenantId, id).filter((c) => c.isActive());
        if (activeChildren.length > 0) {
            throw new ConflictError(`Org unit ${unit.code} still has active children: ${activeChildren.map((c) => c.code).join(", ")}`);
        }
        const unitPositions = this.positions.findByOrgUnit(tenantId, id);
        const filled = unitPositions.filter((p) => p.status === "filled");
        if (filled.length > 0) {
            throw new ConflictError(`Org unit ${unit.code} still has ${filled.length} filled position(s); transfer or terminate first`);
        }
        for (const position of unitPositions) {
            if (position.status === "open" || position.status === "frozen") {
                if (position.status === "frozen")
                    position.unfreeze();
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
    subtree(tenantId, rootId) {
        const root = this.getOrgUnit(tenantId, rootId);
        const result = [root];
        const queue = [rootId];
        while (queue.length > 0) {
            const current = queue.shift();
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
    openPosition(tenantId, input) {
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
    getPosition(tenantId, id) {
        const position = this.positions.findById(tenantId, id);
        if (!position)
            throw new NotFoundError("Position", id);
        return position;
    }
    listPositions(tenantId, orgUnitId) {
        return orgUnitId
            ? this.positions.findByOrgUnit(tenantId, orgUnitId)
            : this.positions.listByTenant(tenantId);
    }
    freezePosition(tenantId, id, reason) {
        const position = this.getPosition(tenantId, id);
        position.freeze(reason);
        this.positions.save(position);
        this.outbox.append(position.pullEvents());
        return position;
    }
    unfreezePosition(tenantId, id) {
        const position = this.getPosition(tenantId, id);
        position.unfreeze();
        this.positions.save(position);
        this.outbox.append(position.pullEvents());
        return position;
    }
    eliminatePosition(tenantId, id) {
        const position = this.getPosition(tenantId, id);
        position.eliminate();
        this.positions.save(position);
        this.outbox.append(position.pullEvents());
        return position;
    }
    changePositionReportsTo(tenantId, id, reportsToPositionId) {
        const position = this.getPosition(tenantId, id);
        if (reportsToPositionId) {
            // Walking the reporting chain from the new boss must not reach `position`.
            let cursor = this.getPosition(tenantId, reportsToPositionId);
            let depth = 0;
            while (cursor) {
                if (cursor.id === position.id) {
                    throw new DomainError(`Position reporting line would form a cycle via ${cursor.title}`, "POSITION_REPORT_CYCLE", 409);
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
//# sourceMappingURL=org-service.js.map