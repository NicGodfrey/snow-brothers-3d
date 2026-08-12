import { AggregateRoot, type TenantId, type Ulid } from "@enterprise-suite/shared-kernel";
export type OrgUnitKind = "company" | "division" | "department" | "team";
export type OrgUnitStatus = "active" | "inactive";
export interface OrgUnitProps {
    code: string;
    name: string;
    kind: OrgUnitKind;
    parentId?: Ulid;
    costCenter?: string;
    managerPositionId?: Ulid;
    status: OrgUnitStatus;
}
export declare class OrgUnit extends AggregateRoot<OrgUnitProps> {
    private constructor();
    static create(tenantId: TenantId, input: {
        code: string;
        name: string;
        kind: OrgUnitKind;
        parentId?: Ulid;
        parentKind?: OrgUnitKind;
        costCenter?: string;
    }): OrgUnit;
    private static assertNesting;
    get code(): string;
    get name(): string;
    get kind(): OrgUnitKind;
    get parentId(): Ulid | undefined;
    get status(): OrgUnitStatus;
    get managerPositionId(): Ulid | undefined;
    isActive(): boolean;
    rename(name: string): void;
    setCostCenter(costCenter: string | undefined): void;
    assignManagerPosition(positionId: Ulid): void;
    /**
     * Re-parents the unit. Cycle detection requires walking the tree, so it is
     * enforced by OrgService which has repository access; this method only
     * enforces local invariants.
     */
    moveTo(newParentId: Ulid, newParentKind: OrgUnitKind): void;
    /** Preconditions (no active children, no filled positions) checked by OrgService. */
    deactivate(): void;
    private assertActive;
}
//# sourceMappingURL=org-unit.d.ts.map