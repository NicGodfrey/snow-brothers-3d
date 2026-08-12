import { type Brand, type Ulid } from "./branded.js";
export type TenantId = Brand<string, "TenantId">;
export type UserId = Brand<string, "UserId">;
export type RoleCode = Brand<string, "RoleCode">;
export interface TenantContext {
    readonly tenantId: TenantId;
    readonly userId: UserId;
    readonly roles: readonly RoleCode[];
    readonly requestId: Ulid;
}
export declare function tenantId(value: string): TenantId;
export declare function userId(value: string): UserId;
export declare function roleCode(value: string): RoleCode;
export declare function createTenantContext(tenant: string, user: string, roles?: string[]): TenantContext;
//# sourceMappingURL=tenant.d.ts.map