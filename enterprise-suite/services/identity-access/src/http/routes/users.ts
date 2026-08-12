import type { Ulid } from "@enterprise-suite/shared-kernel";
import type { UserStatus } from "../../domain/user.js";
import type { IdentityModule } from "../../infrastructure/container.js";
import { toScope } from "../../rbac/helpers.js";
import { objectField, optionalBoolean, optionalString, requireString } from "../json.js";
import { created, noContent, ok, type Router } from "../router.js";

export function registerUserRoutes(router: Router, module: IdentityModule): void {
  router.get(
    "/identity/users",
    ({ principal, query }) => {
      const page = module.users.page(
        principal.tenantId,
        {
          page: Number(query.get("page") ?? 1),
          pageSize: Number(query.get("pageSize") ?? 20),
        },
        {
          status: (query.get("status") as UserStatus | null) ?? undefined,
          search: query.get("search") ?? undefined,
          lockedOnly: query.get("lockedOnly") === "true",
        },
      );
      return ok({ ...page, items: page.items.map((user) => user.toPublicJSON()) });
    },
    { permission: "identity.user:read" },
  );

  router.post(
    "/identity/users",
    ({ principal, body }) =>
      created(
        module.users
          .invite(principal.tenantId, {
            email: requireString(body, "email"),
            displayName: requireString(body, "displayName"),
            invitedBy: principal.subject.id,
            attributes: objectField(body, "attributes") as Record<string, string> | undefined,
          })
          .toPublicJSON(),
      ),
    { permission: "identity.user:invite" },
  );

  router.get(
    "/identity/users/:userId",
    ({ principal, params }) =>
      ok(module.users.get(principal.tenantId, params.userId as Ulid).toPublicJSON()),
    { permission: "identity.user:read" },
  );

  router.patch(
    "/identity/users/:userId",
    ({ principal, params, body }) => {
      const userId = params.userId as Ulid;
      const displayName = optionalString(body, "displayName");
      if (displayName) module.users.rename(principal.tenantId, userId, displayName);
      const email = optionalString(body, "email");
      if (email) module.users.changeEmail(principal.tenantId, userId, email);
      const attributes = objectField(body, "attributes");
      for (const [key, value] of Object.entries(attributes ?? {})) {
        module.users.setAttribute(
          principal.tenantId,
          userId,
          key,
          value === null ? undefined : String(value),
        );
      }
      return ok(module.users.get(principal.tenantId, userId).toPublicJSON());
    },
    { permission: "identity.user:update" },
  );

  router.post(
    "/identity/users/:userId/activate",
    ({ principal, params, body }) =>
      ok(
        module.users
          .activate(principal.tenantId, {
            userId: params.userId as Ulid,
            password: requireString(body, "password"),
            actorId: principal.subject.id,
          })
          .toPublicJSON(),
      ),
    { permission: "identity.user:reset_password" },
  );

  router.post(
    "/identity/users/:userId/password",
    ({ principal, params, body }) =>
      ok(
        module.users
          .setPassword(principal.tenantId, {
            userId: params.userId as Ulid,
            password: requireString(body, "password"),
            actorId: principal.subject.id,
            mustChangeNext: optionalBoolean(body, "mustChangeNext") ?? true,
          })
          .toPublicJSON(),
      ),
    { permission: "identity.user:reset_password" },
  );

  router.post("/identity/me/password", ({ principal, body }) =>
    ok(
      module.users
        .changePassword(principal.tenantId, {
          userId: principal.subject.id,
          currentPassword: requireString(body, "currentPassword"),
          newPassword: requireString(body, "newPassword"),
        })
        .toPublicJSON(),
    ),
  );

  router.post(
    "/identity/users/:userId/suspend",
    ({ principal, params, body }) =>
      ok(
        module.users
          .suspend(
            principal.tenantId,
            params.userId as Ulid,
            requireString(body, "reason"),
            principal.subject.id,
          )
          .toPublicJSON(),
      ),
    { permission: "identity.user:suspend" },
  );

  router.post(
    "/identity/users/:userId/reactivate",
    ({ principal, params }) =>
      ok(
        module.users
          .reactivate(principal.tenantId, params.userId as Ulid, principal.subject.id)
          .toPublicJSON(),
      ),
    { permission: "identity.user:suspend" },
  );

  router.post(
    "/identity/users/:userId/unlock",
    ({ principal, params }) =>
      ok(
        module.users
          .unlock(principal.tenantId, params.userId as Ulid, principal.subject.id)
          .toPublicJSON(),
      ),
    { permission: "identity.user:unlock" },
  );

  router.delete(
    "/identity/users/:userId",
    ({ principal, params, query }) => {
      module.users.deactivate(
        principal.tenantId,
        params.userId as Ulid,
        query.get("reason") ?? "deactivated via API",
        principal.subject.id,
      );
      return noContent();
    },
    { permission: "identity.user:deactivate" },
  );

  router.post(
    "/identity/users/:userId/mfa",
    ({ principal, params, body }) =>
      created(
        module.users
          .enrollMfa(principal.tenantId, {
            userId: params.userId as Ulid,
            method: requireString(body, "method") as "totp" | "webauthn" | "sms",
            label: requireString(body, "label"),
            secret: requireString(body, "secret"),
          })
          .toPublicJSON(),
      ),
    { permission: "identity.user:manage_mfa" },
  );

  router.get(
    "/identity/users/:userId/permissions",
    ({ principal, params, query }) => {
      const subject = { type: "user" as const, id: params.userId as Ulid };
      const scope = toScope(query.get("scope") ?? undefined);
      return ok({
        subject,
        scope,
        effective: module.authorization.effectivePermissions(principal.tenantId, subject, scope),
        granted: module.authorization.grantedPermissionKeys(principal.tenantId, subject, scope),
      });
    },
    { permission: "identity.role_binding:read" },
  );
}
