import { tenantId as toTenantId } from "@enterprise-suite/shared-kernel";
import type { IdentityModule } from "../../infrastructure/container.js";
import { objectField, optionalBoolean, optionalString, optionalStringArray, requireString } from "../json.js";
import { created, ok, type Router } from "../router.js";

export function registerTenantRoutes(router: Router, module: IdentityModule): void {
  router.post(
    "/identity/tenants",
    ({ body }) => {
      const tenant = module.tenants.provision({
        tenantId: optionalString(body, "tenantId"),
        slug: requireString(body, "slug"),
        name: requireString(body, "name"),
        activate: optionalBoolean(body, "activate") ?? false,
        settings: settingsPatch(body),
      });
      module.installSystemRoles(tenant.tenantId);
      return created(tenant.toJSON());
    },
    // Tenant creation is a platform operation; the caller must already hold the
    // permission in whichever tenant they authenticated against.
    { permission: "identity.tenant:update" },
  );

  router.get("/identity/tenant", ({ principal }) => ok(module.tenants.get(principal.tenantId).toJSON()), {
    permission: "identity.tenant:read",
  });

  router.get(
    "/identity/tenants/:tenantId",
    ({ params }) => ok(module.tenants.get(toTenantId(params.tenantId)).toJSON()),
    { permission: "identity.tenant:read" },
  );

  router.patch(
    "/identity/tenants/:tenantId",
    ({ params, body }) => {
      const tenantId = toTenantId(params.tenantId);
      const name = optionalString(body, "name");
      if (name) module.tenants.rename(tenantId, name);
      const patch = settingsPatch(body);
      const tenant = Object.keys(patch).length > 0
        ? module.tenants.updateSettings(tenantId, patch)
        : module.tenants.get(tenantId);
      return ok(tenant.toJSON());
    },
    { permission: "identity.tenant:update" },
  );

  router.post(
    "/identity/tenants/:tenantId/activate",
    ({ params }) => ok(module.tenants.activate(toTenantId(params.tenantId)).toJSON()),
    { permission: "identity.tenant:update" },
  );

  router.post(
    "/identity/tenants/:tenantId/suspend",
    ({ params, body }) =>
      ok(
        module.tenants
          .suspend(toTenantId(params.tenantId), requireString(body, "reason"))
          .toJSON(),
      ),
    { permission: "identity.tenant:suspend" },
  );

  router.post(
    "/identity/tenants/:tenantId/archive",
    ({ params }) => ok(module.tenants.archive(toTenantId(params.tenantId)).toJSON()),
    { permission: "identity.tenant:suspend" },
  );
}

function settingsPatch(body: unknown): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const key of ["passwordPolicy", "sessionPolicy", "apiKeyPolicy", "lockoutPolicy"]) {
    const value = objectField(body, key);
    if (value) patch[key] = value;
  }
  const mfaRequired = optionalBoolean(body, "mfaRequired");
  if (mfaRequired !== undefined) patch.mfaRequired = mfaRequired;
  const auditAll = optionalBoolean(body, "auditAllDecisions");
  if (auditAll !== undefined) patch.auditAllDecisions = auditAll;
  const domains = optionalStringArray(body, "allowedEmailDomains");
  if (domains) patch.allowedEmailDomains = domains;
  return patch;
}
