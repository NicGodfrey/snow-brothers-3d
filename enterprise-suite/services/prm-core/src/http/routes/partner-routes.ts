import type { Ulid } from "@enterprise-suite/shared-kernel";
import {
  ADDRESS_KINDS,
  CONTACT_ROLES,
  PARTNER_STATUSES,
  PARTNER_TYPES,
  type AddressKind,
  type ContactRole,
  type PartnerStatus,
  type PartnerType,
} from "../../domain/partner.js";
import { PERFORMANCE_SOURCES, type PerformanceSource } from "../../domain/performance.js";
import type { PrmContainer } from "../../infrastructure/container.js";
import { jsonResponse, type Router } from "../router.js";
import {
  asRecord,
  enumFromQuery,
  idFromQuery,
  optionalEnum,
  optionalId,
  optionalNumber,
  optionalRecord,
  optionalString,
  optionalStringArray,
  pageFromQuery,
  requiredEnum,
  requiredMoney,
  requiredString,
} from "../validate.js";

export function registerPartnerRoutes(router: Router, container: PrmContainer): void {
  const { partner: partners, tier, contract, portal } = container.services;

  router.post("/partners", async (req) => {
    const body = asRecord(req.body);
    const created = await partners.register(req.ctx, {
      legalName: requiredString(body, "legalName"),
      displayName: optionalString(body, "displayName"),
      type: requiredEnum<PartnerType>(body, "type", PARTNER_TYPES),
      countryCode: requiredString(body, "countryCode"),
      currency: optionalString(body, "currency"),
      parentPartnerId: optionalId(body, "parentPartnerId"),
      websiteUrl: optionalString(body, "websiteUrl"),
      taxId: optionalString(body, "taxId"),
      territories: optionalStringArray(body, "territories"),
      specializations: optionalStringArray(body, "specializations"),
    });
    return jsonResponse(201, created.toJSON());
  });

  router.get("/partners", async (req) => {
    const page = await partners.list(
      req.ctx,
      {
        status: enumFromQuery<PartnerStatus>(req.query, "status", PARTNER_STATUSES),
        type: enumFromQuery<PartnerType>(req.query, "type", PARTNER_TYPES),
        tierCode: req.query.get("tier") ?? undefined,
        territory: req.query.get("territory") ?? undefined,
        parentPartnerId: idFromQuery(req.query, "parentPartnerId"),
        search: req.query.get("q") ?? undefined,
      },
      pageFromQuery(req.query),
    );
    return jsonResponse(200, { ...page, items: page.items.map((p) => p.toJSON()) });
  });

  router.get("/partners/:id", async (req) =>
    jsonResponse(200, (await partners.get(req.ctx, req.params["id"] as Ulid)).toJSON()),
  );

  router.patch("/partners/:id", async (req) => {
    const body = asRecord(req.body);
    const updated = await partners.updateProfile(req.ctx, req.params["id"] as Ulid, {
      legalName: optionalString(body, "legalName"),
      displayName: optionalString(body, "displayName"),
      websiteUrl: optionalString(body, "websiteUrl"),
      taxId: optionalString(body, "taxId"),
      specializations: optionalStringArray(body, "specializations"),
    });
    return jsonResponse(200, updated.toJSON());
  });

  /** Distributor tree: the partner, its parent and its tier-2 partners. */
  router.get("/partners/:id/hierarchy", async (req) => {
    const hierarchy = await partners.hierarchy(req.ctx, req.params["id"] as Ulid);
    return jsonResponse(200, {
      partner: hierarchy.partner.toJSON(),
      parent: hierarchy.parent?.toJSON(),
      children: hierarchy.children.map((c) => c.toJSON()),
    });
  });

  /** Everything a partner-facing dashboard needs in one round trip. */
  router.get("/partners/:id/overview", async (req) => {
    const id = req.params["id"] as Ulid;
    const found = await partners.get(req.ctx, id);
    const [trailing, contracts, certifications, users, evaluation] = await Promise.all([
      partners.trailingPerformance(req.ctx, id),
      contract.effectiveForPartner(req.ctx, id),
      container.services.training.partnerSummary(req.ctx, id),
      portal.forPartner(req.ctx, id),
      tier
        .evaluate(req.ctx, id)
        .catch(() => undefined),
    ]);
    return jsonResponse(200, {
      partner: found.toJSON(),
      trailingPerformance: trailing,
      effectiveContracts: contracts.map((c) => ({
        id: c.id,
        number: c.number,
        type: c.type,
        effectiveTo: c.effectiveTo,
        baseDiscountBps: c.baseDiscountBps,
        mdfEligible: c.mdfEligible,
      })),
      certifications,
      portalUsers: users.map((u) => ({ id: u.id, email: u.email, status: u.status, roles: u.roles })),
      tierEvaluation: evaluation,
    });
  });

  // --- contacts & addresses --------------------------------------------------

  router.post("/partners/:id/contacts", async (req) => {
    const body = asRecord(req.body);
    const contact = await partners.addContact(req.ctx, req.params["id"] as Ulid, {
      firstName: requiredString(body, "firstName"),
      lastName: requiredString(body, "lastName"),
      email: requiredString(body, "email"),
      phone: optionalString(body, "phone"),
      role: requiredEnum<ContactRole>(body, "role", CONTACT_ROLES),
      jobTitle: optionalString(body, "jobTitle"),
    });
    return jsonResponse(201, contact);
  });

  router.post("/partners/:id/contacts/:contactId/primary", async (req) =>
    jsonResponse(
      200,
      (
        await partners.promoteContact(req.ctx, req.params["id"] as Ulid, req.params["contactId"] as Ulid)
      ).toJSON(),
    ),
  );

  router.delete("/partners/:id/contacts/:contactId", async (req) => {
    await partners.removeContact(req.ctx, req.params["id"] as Ulid, req.params["contactId"] as Ulid);
    return jsonResponse(204);
  });

  router.post("/partners/:id/addresses", async (req) => {
    const body = asRecord(req.body);
    const address = await partners.addAddress(req.ctx, req.params["id"] as Ulid, {
      kind: requiredEnum<AddressKind>(body, "kind", ADDRESS_KINDS),
      line1: requiredString(body, "line1"),
      line2: optionalString(body, "line2"),
      city: requiredString(body, "city"),
      region: optionalString(body, "region"),
      postalCode: requiredString(body, "postalCode"),
      countryCode: requiredString(body, "countryCode"),
    });
    return jsonResponse(201, address);
  });

  router.delete("/partners/:id/addresses/:addressId", async (req) => {
    await partners.removeAddress(req.ctx, req.params["id"] as Ulid, req.params["addressId"] as Ulid);
    return jsonResponse(204);
  });

  router.post("/partners/:id/territories", async (req) => {
    const body = asRecord(req.body);
    const updated = await partners.addTerritory(req.ctx, req.params["id"] as Ulid, requiredString(body, "code"));
    return jsonResponse(200, updated.toJSON());
  });

  router.delete("/partners/:id/territories/:code", async (req) =>
    jsonResponse(
      200,
      (await partners.removeTerritory(req.ctx, req.params["id"] as Ulid, req.params["code"]!)).toJSON(),
    ),
  );

  // --- onboarding ------------------------------------------------------------

  router.post("/partners/:id/application", async (req) =>
    jsonResponse(200, (await partners.submitApplication(req.ctx, req.params["id"] as Ulid)).toJSON()),
  );

  router.post("/partners/:id/review", async (req) =>
    jsonResponse(200, (await partners.startReview(req.ctx, req.params["id"] as Ulid)).toJSON()),
  );

  router.post("/partners/:id/approve", async (req) => {
    const body = optionalRecord(req.body);
    const approved = await partners.approve(req.ctx, req.params["id"] as Ulid, optionalString(body, "notes"));
    return jsonResponse(200, approved.toJSON());
  });

  router.post("/partners/:id/reject", async (req) => {
    const body = asRecord(req.body);
    const rejected = await partners.reject(req.ctx, req.params["id"] as Ulid, requiredString(body, "reason"));
    return jsonResponse(200, rejected.toJSON());
  });

  router.post("/partners/:id/activate", async (req) =>
    jsonResponse(200, (await partners.activate(req.ctx, req.params["id"] as Ulid)).toJSON()),
  );

  router.post("/partners/:id/suspend", async (req) => {
    const body = asRecord(req.body);
    const suspended = await partners.suspend(req.ctx, req.params["id"] as Ulid, requiredString(body, "reason"));
    return jsonResponse(200, suspended.toJSON());
  });

  router.post("/partners/:id/reinstate", async (req) => {
    const body = optionalRecord(req.body);
    const reinstated = await partners.reinstate(req.ctx, req.params["id"] as Ulid, optionalString(body, "note"));
    return jsonResponse(200, reinstated.toJSON());
  });

  router.post("/partners/:id/terminate", async (req) => {
    const body = asRecord(req.body);
    const terminated = await partners.terminate(req.ctx, req.params["id"] as Ulid, {
      reason: requiredString(body, "reason"),
      terminateContracts: body["terminateContracts"] === true,
    });
    return jsonResponse(200, terminated.toJSON());
  });

  // --- performance -----------------------------------------------------------

  router.post("/partners/:id/performance", async (req) => {
    const body = asRecord(req.body);
    const snapshot = await partners.recordPerformance(req.ctx, req.params["id"] as Ulid, {
      period: requiredString(body, "period"),
      bookedRevenue: requiredMoney(body, "bookedRevenue"),
      dealsRegistered: optionalNumber(body, "dealsRegistered"),
      dealsWon: optionalNumber(body, "dealsWon"),
      newLogos: optionalNumber(body, "newLogos"),
      source: optionalEnum<PerformanceSource>(body, "source", PERFORMANCE_SOURCES),
    });
    return jsonResponse(201, snapshot);
  });

  router.get("/partners/:id/performance", async (req) => {
    const months = req.query.get("months");
    const trailing = await partners.trailingPerformance(
      req.ctx,
      req.params["id"] as Ulid,
      months === null ? 12 : Number(months),
    );
    return jsonResponse(200, trailing);
  });
}
