import { tenantId as toTenantId, type Ulid } from "@enterprise-suite/shared-kernel";
import type { IdentityModule } from "../../infrastructure/container.js";
import { toScope } from "../../rbac/helpers.js";
import { optionalString, requireString } from "../json.js";
import { created, noContent, ok, type Router } from "../router.js";

export function registerAuthRoutes(router: Router, module: IdentityModule): void {
  /** Public: this is where a caller acquires the credential every other route needs. */
  router.post(
    "/identity/auth/login",
    ({ body, ip }) => {
      const result = module.authentication.loginWithPassword(
        toTenantId(requireString(body, "tenantId")),
        {
          email: requireString(body, "email"),
          password: requireString(body, "password"),
          mfaCode: optionalString(body, "mfaCode"),
          device: { ip, userAgent: optionalString(body, "userAgent") },
        },
      );
      return created({
        token: result.token,
        refreshToken: result.refreshToken,
        expiresAt: result.session.expiresAt,
        mustChangePassword: result.mustChangePassword,
        user: result.user.toPublicJSON(),
      });
    },
    { public: true },
  );

  router.post(
    "/identity/auth/refresh",
    ({ body, ip }) => {
      const refreshed = module.sessions.refresh(requireString(body, "refreshToken"), { ip });
      return ok({
        token: refreshed.token,
        refreshToken: refreshed.refreshToken,
        expiresAt: refreshed.session.expiresAt,
      });
    },
    { public: true },
  );

  router.post(
    "/identity/auth/logout",
    ({ body }) => {
      module.authentication.logout(requireString(body, "token"));
      return noContent();
    },
    { public: true },
  );

  /** Who am I, and what am I allowed to do — the call a UI makes on page load. */
  router.get("/identity/me", ({ principal, query }) => {
    const scope = toScope(query.get("scope") ?? undefined);
    return ok({
      principal: {
        tenantId: principal.tenantId,
        subject: principal.subject,
        displayName: principal.displayName,
        sessionId: principal.sessionId,
        apiKeyId: principal.apiKeyId,
        amr: principal.amr,
        mfaSatisfied: principal.mfaSatisfied,
        impersonatedBy: principal.impersonatedBy,
      },
      permissions: module.authorization.permissionsForPrincipal(principal, scope),
    });
  });

  router.get(
    "/identity/users/:userId/sessions",
    ({ principal, params, query }) =>
      ok(
        module.sessions
          .listForUser(principal.tenantId, params.userId as Ulid, {
            activeOnly: query.get("activeOnly") !== "false",
          })
          .map((session) => session.toPublicJSON()),
      ),
    { permission: "identity.session:read" },
  );

  router.delete(
    "/identity/sessions/:sessionId",
    ({ principal, params, query }) =>
      ok(
        module.sessions
          .revoke(principal.tenantId, params.sessionId as Ulid, query.get("reason") ?? "revoked")
          .toPublicJSON(),
      ),
    { permission: "identity.session:revoke" },
  );

  router.delete(
    "/identity/users/:userId/sessions",
    ({ principal, params, query }) =>
      ok({
        revoked: module.sessions.revokeAllForUser(
          principal.tenantId,
          params.userId as Ulid,
          query.get("reason") ?? "revoked_by_admin",
        ),
      }),
    { permission: "identity.session:revoke" },
  );

  router.post(
    "/identity/users/:userId/impersonate",
    ({ principal, params, body, ip }) => {
      const result = module.authentication.impersonate(principal.tenantId, {
        actorId: principal.subject.id,
        targetUserId: params.userId as Ulid,
        reason: requireString(body, "reason"),
        device: { ip },
      });
      return created({
        token: result.token,
        expiresAt: result.session.expiresAt,
        user: result.user.toPublicJSON(),
      });
    },
    { permission: "identity.user:impersonate" },
  );
}
