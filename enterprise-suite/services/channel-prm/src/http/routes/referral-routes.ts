import type { Email, Ulid } from "@enterprise-suite/shared-kernel";
import { pageView, referralView, registrationView } from "../../application/dto.js";
import {
  REFERRAL_REJECTION_REASONS,
  REFERRAL_STATUSES,
  type ReferralRejectionReason,
  type ReferralStatus,
} from "../../domain/referral.js";
import type { ChannelContainer } from "../../infrastructure/container.js";
import { jsonResponse, type Router } from "../router.js";
import {
  asRecord,
  enumFromQuery,
  optionalId,
  optionalMoney,
  optionalNumber,
  optionalString,
  optionalStringArray,
  pageFromQuery,
  requiredEnum,
  requiredId,
  requiredIso,
  requiredMoney,
  requiredObject,
  requiredString,
  requiredStringArray,
} from "../validate.js";

export function registerReferralRoutes(router: Router, container: ChannelContainer): void {
  const { services, clock } = container;

  router.post("/referrals", async (req) => {
    const body = asRecord(req.body);
    const contact = requiredObject(body, "contact");
    const company = requiredObject(body, "company");
    const referral = await services.referral.submit(req.ctx, {
      partnerId: requiredId(body, "partnerId"),
      contact: {
        name: requiredString(contact, "name"),
        email: requiredString(contact, "email") as Email,
        phone: optionalString(contact, "phone"),
        title: optionalString(contact, "title"),
      },
      company: {
        name: requiredString(company, "name"),
        domain: optionalString(company, "domain"),
        country: requiredString(company, "country"),
        region: optionalString(company, "region"),
      },
      productLines: requiredStringArray(body, "productLines"),
      estimatedValue: optionalMoney(body, "estimatedValue"),
      notes: optionalString(body, "notes"),
    });
    return jsonResponse(201, referralView(referral, clock.now()));
  });

  router.get("/referrals", async (req) => {
    const page = await services.referral.list(
      req.ctx,
      {
        status: enumFromQuery<ReferralStatus>(req.query, "status", REFERRAL_STATUSES),
        partnerId: (req.query.get("partnerId") as Ulid | null) ?? undefined,
        customerKey: req.query.get("customerKey") ?? undefined,
        commissionStatus: req.query.get("commissionStatus") ?? undefined,
      },
      pageFromQuery(req.query),
    );
    return jsonResponse(200, pageView(page, (referral) => referralView(referral, clock.now())));
  });

  router.get("/referrals/:id", async (req) => {
    const referral = await services.referral.get(req.ctx, req.params["id"] as Ulid);
    return jsonResponse(200, referralView(referral, clock.now()));
  });

  router.post("/referrals/:id/accept", async (req) => {
    const body = asRecord(req.body ?? {});
    const referral = await services.referral.accept(req.ctx, req.params["id"] as Ulid, {
      attributionDays: optionalNumber(body, "attributionDays"),
      commissionBps: optionalNumber(body, "commissionBps"),
    });
    return jsonResponse(200, referralView(referral, clock.now()));
  });

  router.post("/referrals/:id/reject", async (req) => {
    const body = asRecord(req.body);
    const referral = await services.referral.reject(req.ctx, req.params["id"] as Ulid, {
      reason: requiredEnum<ReferralRejectionReason>(body, "reason", REFERRAL_REJECTION_REASONS),
      notes: optionalString(body, "notes"),
    });
    return jsonResponse(200, referralView(referral, clock.now()));
  });

  /** Converts to a deal registration the referring (or nominated) partner runs. */
  router.post("/referrals/:id/convert", async (req) => {
    const body = asRecord(req.body);
    const result = await services.referral.convertToRegistration(req.ctx, req.params["id"] as Ulid, {
      estimatedValue: requiredMoney(body, "estimatedValue"),
      expectedCloseDate: requiredIso(body, "expectedCloseDate"),
      description: requiredString(body, "description"),
      productLines: optionalStringArray(body, "productLines"),
      transactingPartnerId: optionalId(body, "transactingPartnerId"),
    });
    return jsonResponse(201, {
      referral: referralView(result.referral, clock.now()),
      registration: registrationView(result.registration, clock.now()),
    });
  });

  /** Converts to a vendor-run opportunity; the partner keeps attribution. */
  router.post("/referrals/:id/hand-off", async (req) => {
    const body = asRecord(req.body);
    const referral = await services.referral.convertToOpportunity(
      req.ctx,
      req.params["id"] as Ulid,
      requiredString(body, "opportunityRef"),
    );
    return jsonResponse(200, referralView(referral, clock.now()));
  });

  router.post("/referrals/:id/win", async (req) => {
    const body = asRecord(req.body);
    const result = await services.referral.markWon(req.ctx, req.params["id"] as Ulid, requiredMoney(body, "value"));
    return jsonResponse(200, {
      referral: referralView(result.referral, clock.now()),
      commission: result.commission,
    });
  });

  router.post("/referrals/:id/lose", async (req) => {
    const body = asRecord(req.body);
    const referral = await services.referral.markLost(
      req.ctx,
      req.params["id"] as Ulid,
      requiredString(body, "reason"),
    );
    return jsonResponse(200, referralView(referral, clock.now()));
  });

  router.post("/referrals/:id/commission/approve", async (req) => {
    const referral = await services.referral.approveCommission(req.ctx, req.params["id"] as Ulid);
    return jsonResponse(200, referralView(referral, clock.now()));
  });

  router.post("/referrals/:id/commission/pay", async (req) => {
    const body = asRecord(req.body);
    const referral = await services.referral.payCommission(
      req.ctx,
      req.params["id"] as Ulid,
      requiredString(body, "paymentRef"),
    );
    return jsonResponse(200, referralView(referral, clock.now()));
  });

  router.get("/commission-ledger", async (req) => {
    const partnerId = (req.query.get("partnerId") as Ulid | null) ?? undefined;
    return jsonResponse(200, await services.referral.commissionLedger(req.ctx, partnerId));
  });
}
