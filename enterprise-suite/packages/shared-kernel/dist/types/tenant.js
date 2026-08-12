import { brand, newId } from "./branded.js";
export function tenantId(value) {
    return brand(value);
}
export function userId(value) {
    return brand(value);
}
export function roleCode(value) {
    return brand(value);
}
export function createTenantContext(tenant, user, roles = ["viewer"]) {
    return {
        tenantId: tenantId(tenant),
        userId: userId(user),
        roles: roles.map(roleCode),
        requestId: newId("req"),
    };
}
//# sourceMappingURL=tenant.js.map