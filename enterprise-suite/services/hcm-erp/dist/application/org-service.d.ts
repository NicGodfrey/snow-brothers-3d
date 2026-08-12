import { type TenantId, type Ulid } from "@enterprise-suite/shared-kernel";
import { OrgUnit, type OrgUnitKind } from "../domain/org-unit.js";
import { Position, type Grade } from "../domain/position.js";
import type { EventOutbox, OrgUnitRepository, PositionRepository } from "./ports.js";
export declare class OrgService {
    private readonly orgUnits;
    private readonly positions;
    private readonly outbox;
    constructor(orgUnits: OrgUnitRepository, positions: PositionRepository, outbox: EventOutbox);
    createOrgUnit(tenantId: TenantId, input: {
        code: string;
        name: string;
        kind: OrgUnitKind;
        parentId?: string;
        costCenter?: string;
    }): OrgUnit;
    getOrgUnit(tenantId: TenantId, id: Ulid): OrgUnit;
    listOrgUnits(tenantId: TenantId): OrgUnit[];
    renameOrgUnit(tenantId: TenantId, id: Ulid, name: string): OrgUnit;
    moveOrgUnit(tenantId: TenantId, id: Ulid, newParentId: Ulid): OrgUnit;
    /**
     * Deactivates a unit. Requires all child units inactive and no filled
     * positions; any remaining open/frozen positions are eliminated as part of
     * the same operation.
     */
    deactivateOrgUnit(tenantId: TenantId, id: Ulid): OrgUnit;
    /** Full subtree (breadth-first) of active units under a root. */
    subtree(tenantId: TenantId, rootId: Ulid): OrgUnit[];
    openPosition(tenantId: TenantId, input: {
        orgUnitId: Ulid;
        title: string;
        jobFamily?: string;
        grade: Grade;
        fte?: number;
        reportsToPositionId?: Ulid;
    }): Position;
    getPosition(tenantId: TenantId, id: Ulid): Position;
    listPositions(tenantId: TenantId, orgUnitId?: Ulid): Position[];
    freezePosition(tenantId: TenantId, id: Ulid, reason: string): Position;
    unfreezePosition(tenantId: TenantId, id: Ulid): Position;
    eliminatePosition(tenantId: TenantId, id: Ulid): Position;
    changePositionReportsTo(tenantId: TenantId, id: Ulid, reportsToPositionId?: Ulid): Position;
}
//# sourceMappingURL=org-service.d.ts.map