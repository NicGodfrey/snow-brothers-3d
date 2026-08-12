import { type IsoDateTime, type Ulid } from "../types/branded.js";
import type { TenantId } from "../types/tenant.js";
export interface EntityProps {
    readonly id: Ulid;
    readonly tenantId: TenantId;
    readonly createdAt: IsoDateTime;
    readonly updatedAt: IsoDateTime;
    readonly version: number;
}
export declare abstract class Entity<TProps extends object> {
    readonly id: Ulid;
    readonly tenantId: TenantId;
    createdAt: IsoDateTime;
    updatedAt: IsoDateTime;
    version: number;
    protected props: TProps;
    protected constructor(tenantId: TenantId, props: TProps, existing?: Partial<EntityProps>);
    touch(): void;
    toJSON(): EntityProps & TProps;
}
//# sourceMappingURL=entity.d.ts.map