import type { Ulid } from "@enterprise-suite/shared-kernel";
import {
  ENTITLEMENT_CATEGORIES,
  type EntitlementCategory,
  type EntitlementPolicy,
  type GrantEffect,
  type GrantSubject,
} from "../../domain/entitlement.js";
import { CONTRACT_TYPES, type ContractType } from "../../domain/contract.js";
import { PARTNER_STATUSES, type PartnerStatus } from "../../domain/partner.js";
import {
  PORTAL_ROLES,
  PORTAL_USER_STATUSES,
  type PortalRole,
  type PortalUserStatus,
} from "../../domain/portal-user.js";
import type { PrmContainer } from "../../infrastructure/container.js";
import { jsonResponse, type Router } from "../router.js";
import {
  asRecord,
  enumFromQuery,
  idFromQuery,
  optionalDate,
  optionalNumber,
  optionalRecord,
  optionalString,
  optionalStringArray,
  pageFromQuery,
  requiredEnum,
  requiredEnumArray,
  requiredId,
  requiredString,
} from "../validate.js";

/** Reads the optional policy block of an entitlement definition. */
function readPolicy(body: Record<string, unknown>): EntitlementPolicy | undefined {
  if (body["policy"] === undefined || body["policy"] === null) return undefined;
  const policy = asRecord(body["policy"]);
  return {
    minTierRank: optionalNumber(policy, "minTierRank"),
    anyOfRoles: policy["anyOfRoles"] === undefined
      ? undefined
      : requiredEnumArray<PortalRole>(policy, "anyOfRoles", PORTAL_ROLES),
    requiredUserCertifications: optionalStringArray(policy, "requiredUserCertifications"),
    requiredPartnerCertifications: optionalStringArray(policy, "requiredPartnerCertifications"),
    requiresAnyContractType: policy["requiresAnyContractType"] === undefined
      ? undefined
      : requiredEnumArray<ContractType>(policy, "requiresAnyContractType", CONTRACT_TYPES),
    allowedPartnerStatuses: policy["allowedPartnerStatuses"] === undefined
      ? undefined
      : requiredEnumArray<PartnerStatus>(policy, "allowedPartnerStatuses", PARTNER_STATUSES),
  };
}

export function registerPortalRoutes(router: Router, container: PrmContainer): void {
  const { portal, entitlement } = container.services;

  // --- portal users ----------------------------------------------------------

  router.post("/portal-users", async (req) => {
    const body = asRecord(req.body);
    const user = await portal.invite(req.ctx, {
      partnerId: requiredId(body, "partnerId"),
      email: requiredString(body, "email"),
      firstName: requiredString(body, "firstName"),
      lastName: requiredString(body, "lastName"),
      jobTitle: optionalString(body, "jobTitle"),
      phone: optionalString(body, "phone"),
      roles: requiredEnumArray<PortalRole>(body, "roles", PORTAL_ROLES),
      locale: optionalString(body, "locale"),
      inviteValidDays: optionalNumber(body, "inviteValidDays"),
    });
    return jsonResponse(201, user.toJSON());
  });

  router.get("/portal-users", async (req) => {
    const page = await portal.list(
      req.ctx,
      {
        partnerId: idFromQuery(req.query, "partnerId"),
        status: enumFromQuery<PortalUserStatus>(req.query, "status", PORTAL_USER_STATUSES),
        role: enumFromQuery<PortalRole>(req.query, "role", PORTAL_ROLES),
        search: req.query.get("search") ?? undefined,
      },
      pageFromQuery(req.query),
    );
    return jsonResponse(200, { ...page, items: page.items.map((u) => u.toJSON()) });
  });

  router.get("/portal-users/:id", async (req) =>
    jsonResponse(200, (await portal.get(req.ctx, req.params["id"] as Ulid)).toJSON()),
  );

  router.patch("/portal-users/:id", async (req) => {
    const body = asRecord(req.body);
    const user = await portal.updateProfile(req.ctx, req.params["id"] as Ulid, {
      firstName: optionalString(body, "firstName"),
      lastName: optionalString(body, "lastName"),
      jobTitle: optionalString(body, "jobTitle"),
      phone: optionalString(body, "phone"),
      locale: optionalString(body, "locale"),
    });
    return jsonResponse(200, user.toJSON());
  });

  router.post("/portal-users/:id/invite-resend", async (req) => {
    const body = optionalRecord(req.body);
    const user = await portal.resendInvite(
      req.ctx,
      req.params["id"] as Ulid,
      optionalNumber(body, "validDays"),
    );
    return jsonResponse(200, user.toJSON());
  });

  router.post("/portal-users/:id/accept-invite", async (req) =>
    jsonResponse(200, (await portal.acceptInvite(req.ctx, req.params["id"] as Ulid)).toJSON()),
  );

  router.put("/portal-users/:id/roles", async (req) => {
    const body = asRecord(req.body);
    const user = await portal.setRoles(
      req.ctx,
      req.params["id"] as Ulid,
      requiredEnumArray<PortalRole>(body, "roles", PORTAL_ROLES),
    );
    return jsonResponse(200, user.toJSON());
  });

  router.post("/portal-users/:id/logins", async (req) =>
    jsonResponse(200, (await portal.recordLogin(req.ctx, req.params["id"] as Ulid)).toJSON()),
  );

  router.post("/portal-users/:id/disable", async (req) => {
    const body = asRecord(req.body);
    const user = await portal.disable(
      req.ctx,
      req.params["id"] as Ulid,
      requiredString(body, "reason"),
    );
    return jsonResponse(200, user.toJSON());
  });

  router.post("/portal-users/:id/enable", async (req) =>
    jsonResponse(200, (await portal.enable(req.ctx, req.params["id"] as Ulid)).toJSON()),
  );

  router.get("/partners/:id/portal-users", async (req) => {
    const users = await portal.forPartner(req.ctx, req.params["id"] as Ulid);
    return jsonResponse(200, users.map((u) => u.toJSON()));
  });

  /** Offboarding hook: kill every login of a suspended or terminated partner. */
  router.post("/partners/:id/portal-users/disable-all", async (req) => {
    const body = asRecord(req.body);
    const disabled = await portal.disableAllForPartner(
      req.ctx,
      req.params["id"] as Ulid,
      requiredString(body, "reason"),
    );
    return jsonResponse(200, { disabled });
  });

  // --- entitlement catalog ---------------------------------------------------

  router.post("/entitlements", async (req) => {
    const body = asRecord(req.body);
    const definition = await entitlement.createDefinition(req.ctx, {
      code: requiredString(body, "code"),
      name: requiredString(body, "name"),
      description: optionalString(body, "description"),
      category: requiredEnum<EntitlementCategory>(body, "category", ENTITLEMENT_CATEGORIES),
      policy: readPolicy(body),
    });
    return jsonResponse(201, definition);
  });

  router.get("/entitlements", async (req) =>
    jsonResponse(200, await entitlement.listDefinitions(req.ctx)),
  );

  router.post("/entitlements/standard-catalog", async (req) =>
    jsonResponse(201, await entitlement.installStandardCatalog(req.ctx)),
  );

  // --- overrides -------------------------------------------------------------

  router.post("/entitlement-grants", async (req) => {
    const body = asRecord(req.body);
    const grant = await entitlement.grant(req.ctx, {
      entitlementCode: requiredString(body, "entitlementCode"),
      subject: requiredEnum<GrantSubject>(body, "subject", ["partner", "user"]),
      subjectId: requiredId(body, "subjectId"),
      effect: requiredEnum<GrantEffect>(body, "effect", ["allow", "deny"]),
      reason: requiredString(body, "reason"),
      expiresAt: optionalDate(body, "expiresAt"),
    });
    return jsonResponse(201, grant);
  });

  router.delete("/entitlement-grants/:id", async (req) =>
    jsonResponse(200, await entitlement.revokeGrant(req.ctx, req.params["id"] as Ulid)),
  );

  router.get("/entitlement-grants", async (req) => {
    const partnerId = idFromQuery(req.query, "partnerId");
    if (partnerId) return jsonResponse(200, await entitlement.grantsForPartner(req.ctx, partnerId));
    const portalUserId = idFromQuery(req.query, "portalUserId");
    if (portalUserId) return jsonResponse(200, await entitlement.grantsForUser(req.ctx, portalUserId));
    return jsonResponse(200, []);
  });

  // --- resolution ------------------------------------------------------------

  router.get("/portal-users/:id/entitlements", async (req) => {
    const id = req.params["id"] as Ulid;
    const code = req.query.get("code");
    if (code) return jsonResponse(200, await entitlement.check(req.ctx, id, code));
    return jsonResponse(200, await entitlement.resolveForUser(req.ctx, id));
  });

  router.get("/portal-users/:id/entitlement-facts", async (req) =>
    jsonResponse(200, await entitlement.factsForUser(req.ctx, req.params["id"] as Ulid)),
  );

  router.get("/portal-users/:id/menu", async (req) =>
    jsonResponse(200, await entitlement.portalMenu(req.ctx, req.params["id"] as Ulid)),
  );

  router.get("/partners/:id/entitlements", async (req) =>
    jsonResponse(200, await entitlement.resolveForPartner(req.ctx, req.params["id"] as Ulid)),
  );

  router.get("/partners/:id/entitlement-facts", async (req) =>
    jsonResponse(200, await entitlement.factsForPartner(req.ctx, req.params["id"] as Ulid)),
  );
}
