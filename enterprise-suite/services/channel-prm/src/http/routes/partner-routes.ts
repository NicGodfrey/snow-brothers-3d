import type { Email, Ulid, UserId } from "@enterprise-suite/shared-kernel";
import { partnerView, pageView } from "../../application/dto.js";
import {
  PARTNER_STATUSES,
  PARTNER_TIERS,
  PARTNER_TYPES,
  type PartnerStatus,
  type PartnerTier,
  type PartnerType,
  type TierPolicy,
} from "../../domain/partner.js";
import type { ChannelContainer } from "../../infrastructure/container.js";
import { jsonResponse, type Router } from "../router.js";
import {
  asRecord,
  enumFromQuery,
  optionalString,
  optionalStringArray,
  pageFromQuery,
  requiredEnum,
  requiredNumber,
  requiredObject,
  requiredString,
  requiredStringArray,
} from "../validate.js";

export function registerPartnerRoutes(router: Router, container: ChannelContainer): void {
  const { services } = container;

  router.post("/partners", async (req) => {
    const body = asRecord(req.body);
    const contact = requiredObject(body, "contact");
    const partner = await services.partner.create(req.ctx, {
      code: requiredString(body, "code"),
      name: requiredString(body, "name"),
      type: requiredEnum<PartnerType>(body, "type", PARTNER_TYPES),
      tier: body["tier"] !== undefined ? requiredEnum<PartnerTier>(body, "tier", PARTNER_TIERS) : undefined,
      territories: requiredStringArray(body, "territories"),
      productLines: requiredStringArray(body, "productLines"),
      currency: optionalString(body, "currency"),
      channelManagerId: optionalString(body, "channelManagerId") as UserId | undefined,
      contact: {
        name: requiredString(contact, "name"),
        email: requiredString(contact, "email") as Email,
        phone: optionalString(contact, "phone"),
      },
    });
    return jsonResponse(201, partnerView(partner));
  });

  router.get("/partners", async (req) => {
    const page = await services.partner.list(
      req.ctx,
      {
        status: enumFromQuery<PartnerStatus>(req.query, "status", PARTNER_STATUSES),
        tier: enumFromQuery<PartnerTier>(req.query, "tier", PARTNER_TIERS),
        territory: req.query.get("territory") ?? undefined,
        productLine: req.query.get("productLine") ?? undefined,
        search: req.query.get("q") ?? undefined,
      },
      pageFromQuery(req.query),
    );
    return jsonResponse(200, pageView(page, (partner) => partnerView(partner)));
  });

  router.get("/partners/:id", async (req) => {
    const partner = await services.partner.resolve(req.ctx, req.params["id"]!);
    const policy = await services.partner.policyFor(req.ctx, partner.tier);
    return jsonResponse(200, partnerView(partner, policy));
  });

  router.post("/partners/:id/activate", async (req) =>
    jsonResponse(200, partnerView(await services.partner.activate(req.ctx, req.params["id"] as Ulid))),
  );

  router.post("/partners/:id/suspend", async (req) => {
    const body = asRecord(req.body);
    const partner = await services.partner.suspend(req.ctx, req.params["id"] as Ulid, requiredString(body, "reason"));
    return jsonResponse(200, partnerView(partner));
  });

  router.post("/partners/:id/terminate", async (req) => {
    const body = asRecord(req.body);
    const partner = await services.partner.terminate(req.ctx, req.params["id"] as Ulid, requiredString(body, "reason"));
    return jsonResponse(200, partnerView(partner));
  });

  router.post("/partners/:id/tier", async (req) => {
    const body = asRecord(req.body);
    const partner = await services.partner.changeTier(
      req.ctx,
      req.params["id"] as Ulid,
      requiredEnum<PartnerTier>(body, "tier", PARTNER_TIERS),
      optionalString(body, "reason"),
    );
    return jsonResponse(200, partnerView(partner));
  });

  router.put("/partners/:id/authorizations", async (req) => {
    const body = asRecord(req.body);
    const partner = await services.partner.setAuthorizations(req.ctx, req.params["id"] as Ulid, {
      territories: optionalStringArray(body, "territories"),
      productLines: optionalStringArray(body, "productLines"),
    });
    return jsonResponse(200, partnerView(partner));
  });

  router.get("/tier-policies", async (req) => jsonResponse(200, await services.partner.listPolicies(req.ctx)));

  router.put("/tier-policies/:tier", async (req) => {
    const body = asRecord(req.body);
    const tier = req.params["tier"] as PartnerTier;
    if (!PARTNER_TIERS.includes(tier)) {
      return jsonResponse(400, { code: "VALIDATION", message: `unknown tier "${tier}"` });
    }
    const policy: TierPolicy = {
      tier,
      protectionDays: requiredNumber(body, "protectionDays"),
      maxExtensionDays: requiredNumber(body, "maxExtensionDays"),
      maxExtensions: requiredNumber(body, "maxExtensions"),
      approvalSlaHours: requiredNumber(body, "approvalSlaHours"),
      baseDiscountBps: requiredNumber(body, "baseDiscountBps"),
      registeredDiscountBps: requiredNumber(body, "registeredDiscountBps"),
      maxDiscountBps: requiredNumber(body, "maxDiscountBps"),
      referralCommissionBps: requiredNumber(body, "referralCommissionBps"),
      autoApproveBelowMinor: requiredNumber(body, "autoApproveBelowMinor"),
      renewalGraceDays: requiredNumber(body, "renewalGraceDays"),
      conflictSlaHours: requiredNumber(body, "conflictSlaHours"),
    };
    return jsonResponse(200, await services.partner.setPolicy(req.ctx, policy));
  });
}
