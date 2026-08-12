import { brand, newId, type Brand, type Ulid } from "./brand.js";

export type TenantId = Brand<string, "TenantId">;
export type UserId = Brand<string, "UserId">;
export type RoleCode = Brand<string, "RoleCode">;

export interface TenantContext {
  readonly tenantId: TenantId;
  readonly userId: UserId;
  readonly roles: readonly RoleCode[];
  readonly requestId: Ulid;
}

export function tenantId(value: string): TenantId {
  return brand<string, "TenantId">(value);
}

export function userId(value: string): UserId {
  return brand<string, "UserId">(value);
}

export function roleCode(value: string): RoleCode {
  return brand<string, "RoleCode">(value);
}

export function createTenantContext(
  tenant: string,
  user: string,
  roles: string[] = ["viewer"],
): TenantContext {
  return {
    tenantId: tenantId(tenant),
    userId: userId(user),
    roles: roles.map(roleCode),
    requestId: newId("req"),
  };
}

export function hasRole(ctx: TenantContext, ...anyOf: string[]): boolean {
  return ctx.roles.some((r) => anyOf.includes(r as unknown as string));
}
