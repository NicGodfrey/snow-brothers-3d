import { json, type Router } from "@enterprise-suite/api-gateway";
import { tenantId as toTenantId } from "@enterprise-suite/shared-kernel";
import type { AdminContainer } from "../../infrastructure/container.js";
import { commandContext } from "../context.js";
import {
  asRecord,
  optionalBoolean,
  optionalNumber,
  optionalString,
  optionalStringMap,
  pageFromQuery,
  requiredString,
  requiredStringArray,
} from "../validate.js";

/**
 * User membership and role administration.
 *
 * Invitation tokens are returned exactly once, in the response to the command
 * that mints them; every later read reports only whether one is outstanding.
 */
export function registerUserRoutes(router: Router, container: AdminContainer): void {
  const { user: users, role: roles } = container.services;
  const tenantOf = (value: string) => toTenantId(value);

  router.get(
    "/users",
    (req) => {
      const page = users.page(
        tenantOf(String(req.ctx.tenantId)),
        {
          status: req.query.get("status") ?? undefined,
          role: req.query.get("role") ?? undefined,
          search: req.query.get("q") ?? undefined,
        },
        pageFromQuery(req.query),
      );
      return json(200, { ...page, items: page.items.map((item) => item.toPublicJSON()) });
    },
    "users.list",
  );

  router.post(
    "/users",
    async (req) => {
      const body = asRecord(req.body);
      const result = await users.invite(commandContext(req), {
        email: requiredString(body, "email"),
        displayName: requiredString(body, "displayName"),
        roles: requiredStringArray(body, "roles"),
        attributes: optionalStringMap(body, "attributes"),
        inviteTtlMs: optionalNumber(body, "inviteTtlMs"),
      });
      return json(201, { user: result.user.toPublicJSON(), inviteToken: result.inviteToken });
    },
    "users.create",
  );

  router.get(
    "/users/:userKey",
    (req) => {
      const tenant = tenantOf(String(req.ctx.tenantId));
      const user = users.require(tenant, req.params["userKey"]!);
      return json(200, {
        ...user.toPublicJSON(),
        effectivePermissions: users.effectivePermissions(tenant, req.params["userKey"]!),
      });
    },
    "users.get",
  );

  router.patch(
    "/users/:userKey",
    async (req) => {
      const body = asRecord(req.body);
      const updated = await users.updateProfile(commandContext(req), req.params["userKey"]!, {
        displayName: optionalString(body, "displayName"),
        mfaEnabled: optionalBoolean(body, "mfaEnabled"),
        attributes: optionalStringMap(body, "attributes"),
      });
      return json(200, updated.toPublicJSON());
    },
    "users.update",
  );

  router.delete(
    "/users/:userKey",
    async (req) =>
      json(200, (await users.deactivate(commandContext(req), req.params["userKey"]!)).toPublicJSON()),
    "users.delete",
  );

  router.post(
    "/users/:userKey/roles",
    async (req) => {
      const body = asRecord(req.body);
      const updated = await users.assignRoles(
        commandContext(req),
        req.params["userKey"]!,
        requiredStringArray(body, "roles"),
      );
      return json(200, updated.toPublicJSON());
    },
    "users.assign-roles",
  );

  router.post(
    "/users/:userKey/accept-invite",
    async (req) => {
      const body = asRecord(req.body);
      const updated = await users.acceptInvite(
        commandContext(req),
        req.params["userKey"]!,
        requiredString(body, "token"),
      );
      return json(200, updated.toPublicJSON());
    },
    "users.accept-invite",
  );

  router.post(
    "/users/:userKey/reissue-invite",
    async (req) => {
      const result = await users.reissueInvite(commandContext(req), req.params["userKey"]!);
      return json(200, { user: result.user.toPublicJSON(), inviteToken: result.inviteToken });
    },
    "users.reissue-invite",
  );

  router.post(
    "/users/:userKey/suspend",
    async (req) => {
      const body = asRecord(req.body);
      const updated = await users.suspend(
        commandContext(req),
        req.params["userKey"]!,
        requiredString(body, "reason"),
      );
      return json(200, updated.toPublicJSON());
    },
    "users.suspend",
  );

  router.post(
    "/users/:userKey/reinstate",
    async (req) =>
      json(200, (await users.reinstate(commandContext(req), req.params["userKey"]!)).toPublicJSON()),
    "users.reinstate",
  );

  router.get(
    "/roles",
    (req) => {
      const tenant = tenantOf(String(req.ctx.tenantId));
      return json(200, { items: roles.matrix(tenant) });
    },
    "roles.list",
  );

  router.post(
    "/roles",
    async (req) => {
      const body = asRecord(req.body);
      const created = await roles.create(commandContext(req), {
        code: requiredString(body, "code"),
        name: requiredString(body, "name"),
        description: optionalString(body, "description"),
        permissions: requiredStringArray(body, "permissions"),
        inheritsFrom: optionalString(body, "inheritsFrom"),
      });
      return json(201, created.toJSON());
    },
    "roles.create",
  );

  router.get(
    "/roles/:roleCode",
    (req) => {
      const tenant = tenantOf(String(req.ctx.tenantId));
      const role = roles.require(tenant, req.params["roleCode"]!);
      return json(200, {
        ...role.toJSON(),
        effectivePermissions: roles.effectivePermissions(tenant, role.code),
      });
    },
    "roles.get",
  );

  router.patch(
    "/roles/:roleCode",
    async (req) => {
      const body = asRecord(req.body);
      const updated = await roles.update(commandContext(req), req.params["roleCode"]!, {
        name: optionalString(body, "name"),
        description: optionalString(body, "description"),
        permissions: body["permissions"] === undefined
          ? undefined
          : requiredStringArray(body, "permissions"),
        inheritsFrom: body["inheritsFrom"] === null ? null : optionalString(body, "inheritsFrom"),
      });
      return json(200, updated.toJSON());
    },
    "roles.update",
  );

  router.delete(
    "/roles/:roleCode",
    async (req) => {
      await roles.remove(commandContext(req), req.params["roleCode"]!);
      return json(204);
    },
    "roles.delete",
  );

  router.post(
    "/roles/:roleCode/clone",
    async (req) => {
      const body = asRecord(req.body);
      const clone = await roles.clone(
        commandContext(req),
        req.params["roleCode"]!,
        requiredString(body, "code"),
        requiredString(body, "name"),
      );
      return json(201, clone.toJSON());
    },
    "roles.clone",
  );
}
