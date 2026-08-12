import type { Ulid } from "@enterprise-suite/shared-kernel";
import type { IdentityModule } from "../../infrastructure/container.js";
import { optionalBoolean, optionalString, optionalStringArray, requireString } from "../json.js";
import { created, noContent, ok, type Router } from "../router.js";

export function registerGroupRoutes(router: Router, module: IdentityModule): void {
  router.get(
    "/identity/groups",
    ({ principal }) =>
      ok(
        module.groups.list(principal.tenantId).map((group) => ({
          ...group.toJSON(),
          memberCount: group.memberCount,
        })),
      ),
    { permission: "identity.group:read" },
  );

  router.post(
    "/identity/groups",
    ({ principal, body }) =>
      created(
        module.groups
          .create(principal.tenantId, {
            name: requireString(body, "name"),
            description: optionalString(body, "description"),
            parentGroupId: optionalString(body, "parentGroupId") as Ulid | undefined,
            externallyManaged: optionalBoolean(body, "externallyManaged"),
            externalRef: optionalString(body, "externalRef"),
            memberUserIds: optionalStringArray(body, "memberUserIds") as readonly Ulid[] | undefined,
          })
          .toJSON(),
      ),
    { permission: "identity.group:create" },
  );

  router.get(
    "/identity/groups/:groupId",
    ({ principal, params }) => ok(module.groups.get(principal.tenantId, params.groupId as Ulid).toJSON()),
    { permission: "identity.group:read" },
  );

  router.patch(
    "/identity/groups/:groupId",
    ({ principal, params, body }) => {
      const groupId = params.groupId as Ulid;
      const name = optionalString(body, "name");
      if (name) module.groups.rename(principal.tenantId, groupId, name, optionalString(body, "description"));
      if (Object.prototype.hasOwnProperty.call(body as object, "parentGroupId")) {
        module.groups.setParent(
          principal.tenantId,
          groupId,
          (optionalString(body, "parentGroupId") as Ulid | undefined) ?? undefined,
        );
      }
      return ok(module.groups.get(principal.tenantId, groupId).toJSON());
    },
    { permission: "identity.group:update" },
  );

  router.put(
    "/identity/groups/:groupId/members",
    ({ principal, params, body }) => {
      const result = module.groups.syncMembers(
        principal.tenantId,
        params.groupId as Ulid,
        (optionalStringArray(body, "memberUserIds") ?? []) as readonly Ulid[],
      );
      return ok({ group: result.group.toJSON(), added: result.added, removed: result.removed });
    },
    { permission: "identity.group:manage_members" },
  );

  router.post(
    "/identity/groups/:groupId/members",
    ({ principal, params, body }) =>
      created(
        module.groups
          .addMember(principal.tenantId, params.groupId as Ulid, requireString(body, "userId") as Ulid)
          .toJSON(),
      ),
    { permission: "identity.group:manage_members" },
  );

  router.delete(
    "/identity/groups/:groupId/members/:userId",
    ({ principal, params }) =>
      ok(
        module.groups
          .removeMember(principal.tenantId, params.groupId as Ulid, params.userId as Ulid)
          .toJSON(),
      ),
    { permission: "identity.group:manage_members" },
  );

  router.delete(
    "/identity/groups/:groupId",
    ({ principal, params }) => {
      module.groups.delete(principal.tenantId, params.groupId as Ulid, principal.subject.id);
      return noContent();
    },
    { permission: "identity.group:delete" },
  );
}
