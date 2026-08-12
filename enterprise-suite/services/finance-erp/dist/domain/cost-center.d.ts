import { AggregateRoot, type Result, type TenantId } from "@enterprise-suite/shared-kernel";
export interface CostCenterProps {
    code: string;
    name: string;
    parentCode?: string;
    managerUserId?: string;
    active: boolean;
}
export declare class CostCenter extends AggregateRoot<CostCenterProps> {
    private constructor();
    static create(tenantId: TenantId, input: {
        code: string;
        name: string;
        parentCode?: string;
        managerUserId?: string;
    }): Result<CostCenter>;
    get code(): string;
    get name(): string;
    get parentCode(): string | undefined;
    get active(): boolean;
    deactivate(): Result<void>;
}
//# sourceMappingURL=cost-center.d.ts.map