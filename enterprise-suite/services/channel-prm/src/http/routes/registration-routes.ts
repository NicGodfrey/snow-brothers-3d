import type { Ulid } from "@enterprise-suite/shared-kernel";
import { conflictView, pageView, registrationView } from "../../application/dto.js";
import {
  DEAL_SOURCES,
  LOSS_REASONS,
  REGISTRATION_STATUSES,
  REJECTION_REASONS,
  type DealSource,
  type LossReason,
  type RegistrationStatus,
  type RejectionReason,
} from "../../domain/deal-registration.js";
import { CHANNEL_STAGES, type ChannelStage } from "../../domain/stages.js";
import type { EndCustomer } from "../../domain/territory.js";
import type { ChannelContainer } from "../../infrastructure/container.js";
import { jsonResponse, type Router } from "../router.js";
import {
  asRecord,
  enumFromQuery,
  numberFromQuery,
  optionalEnum,
  optionalId,
  optionalIso,
  optionalMoney,
  optionalNumber,
  optionalString,
  optionalStringArray,
  pageFromQuery,
  requiredEnum,
  requiredId,
  requiredIso,
  requiredMoney,
  requiredNumber,
  requiredObject,
  requiredString,
  requiredStringArray,
} from "../validate.js";

function parseEndCustomer(body: Record<string, unknown>): EndCustomer {
  const customer = requiredObject(body, "endCustomer");
  return {
    name: requiredString(customer, "name"),
    domain: optionalString(customer, "domain"),
    country: requiredString(customer, "country"),
    region: optionalString(customer, "region"),
    city: optionalString(customer, "city"),
    taxId: optionalString(customer, "taxId"),
    accountRef: optionalString(customer, "accountRef"),
  };
}

export function registerRegistrationRoutes(router: Router, container: ChannelContainer): void {
  const { services, clock } = container;

  /** Portal pre-check: eligibility and conflicts without creating anything. */
  router.post("/deal-registrations/precheck", async (req) => {
    const body = asRecord(req.body);
    const result = await services.registration.precheck(req.ctx, {
      partnerId: requiredId(body, "partnerId"),
      endCustomer: parseEndCustomer(body),
      productLines: requiredStringArray(body, "productLines"),
      estimatedValue: optionalMoney(body, "estimatedValue"),
    });
    return jsonResponse(200, result);
  });

  router.post("/deal-registrations", async (req) => {
    const body = asRecord(req.body);
    const registration = await services.registration.create(req.ctx, {
      partnerId: requiredId(body, "partnerId"),
      endCustomer: parseEndCustomer(body),
      productLines: requiredStringArray(body, "productLines"),
      estimatedValue: requiredMoney(body, "estimatedValue"),
      expectedCloseDate: requiredIso(body, "expectedCloseDate"),
      source: optionalEnum<DealSource>(body, "source", DEAL_SOURCES),
      stage: optionalEnum<ChannelStage>(body, "stage", CHANNEL_STAGES),
      probability: optionalNumber(body, "probability"),
      description: optionalString(body, "description"),
      competitors: optionalStringArray(body, "competitors"),
      referralId: optionalId(body, "referralId"),
    });
    return jsonResponse(201, registrationView(registration, clock.now()));
  });

  router.get("/deal-registrations", async (req) => {
    const page = await services.registration.list(
      req.ctx,
      {
        status: enumFromQuery<RegistrationStatus>(req.query, "status", REGISTRATION_STATUSES),
        partnerId: (req.query.get("partnerId") as Ulid | null) ?? undefined,
        customerKey: req.query.get("customerKey") ?? undefined,
        stage: enumFromQuery<ChannelStage>(req.query, "stage", CHANNEL_STAGES),
        source: enumFromQuery<DealSource>(req.query, "source", DEAL_SOURCES),
        productLine: req.query.get("productLine") ?? undefined,
        expiringWithinDays: numberFromQuery(req.query, "expiringWithinDays"),
        search: req.query.get("q") ?? undefined,
      },
      pageFromQuery(req.query),
    );
    return jsonResponse(200, pageView(page, (registration) => registrationView(registration, clock.now())));
  });

  router.get("/deal-registrations/:id", async (req) => {
    const registration = await services.registration.get(req.ctx, req.params["id"] as Ulid);
    return jsonResponse(200, registrationView(registration, clock.now()));
  });

  router.patch("/deal-registrations/:id", async (req) => {
    const body = asRecord(req.body);
    const registration = await services.registration.updateDetails(req.ctx, req.params["id"] as Ulid, {
      estimatedValue: optionalMoney(body, "estimatedValue"),
      expectedCloseDate: optionalIso(body, "expectedCloseDate"),
      description: optionalString(body, "description"),
      competitors: optionalStringArray(body, "competitors"),
      productLines: optionalStringArray(body, "productLines"),
    });
    return jsonResponse(200, registrationView(registration, clock.now()));
  });

  router.post("/deal-registrations/:id/submit", async (req) => {
    const result = await services.registration.submit(req.ctx, req.params["id"] as Ulid);
    return jsonResponse(200, {
      registration: registrationView(result.registration, clock.now()),
      findings: result.findings,
      conflicts: result.conflicts.map((c) => conflictView(c, clock.now())),
      autoApproved: result.autoApproved,
    });
  });

  router.post("/deal-registrations/:id/review", async (req) => {
    const registration = await services.registration.startReview(req.ctx, req.params["id"] as Ulid);
    return jsonResponse(200, registrationView(registration, clock.now()));
  });

  router.post("/deal-registrations/:id/approve", async (req) => {
    const body = asRecord(req.body ?? {});
    const registration = await services.registration.approve(req.ctx, req.params["id"] as Ulid, {
      protectionDays: optionalNumber(body, "protectionDays"),
      discountBps: optionalNumber(body, "discountBps"),
      notes: optionalString(body, "notes"),
    });
    return jsonResponse(200, registrationView(registration, clock.now()));
  });

  router.post("/deal-registrations/:id/reject", async (req) => {
    const body = asRecord(req.body);
    const registration = await services.registration.reject(req.ctx, req.params["id"] as Ulid, {
      reasonCode: requiredEnum<RejectionReason>(body, "reasonCode", REJECTION_REASONS),
      notes: optionalString(body, "notes"),
    });
    return jsonResponse(200, registrationView(registration, clock.now()));
  });

  router.post("/deal-registrations/:id/withdraw", async (req) => {
    const body = asRecord(req.body);
    const registration = await services.registration.withdraw(
      req.ctx,
      req.params["id"] as Ulid,
      requiredString(body, "reason"),
    );
    return jsonResponse(200, registrationView(registration, clock.now()));
  });

  router.post("/deal-registrations/:id/forecast", async (req) => {
    const body = asRecord(req.body);
    const registration = await services.registration.updateForecast(req.ctx, req.params["id"] as Ulid, {
      stage: optionalEnum<ChannelStage>(body, "stage", CHANNEL_STAGES),
      probability: optionalNumber(body, "probability"),
      estimatedValue: optionalMoney(body, "estimatedValue"),
      expectedCloseDate: optionalIso(body, "expectedCloseDate"),
    });
    return jsonResponse(200, registrationView(registration, clock.now()));
  });

  router.post("/deal-registrations/:id/extend-protection", async (req) => {
    const body = asRecord(req.body);
    const registration = await services.registration.extendProtection(req.ctx, req.params["id"] as Ulid, {
      days: requiredNumber(body, "days"),
      reason: requiredString(body, "reason"),
    });
    return jsonResponse(200, registrationView(registration, clock.now()));
  });

  router.post("/deal-registrations/:id/win", async (req) => {
    const body = asRecord(req.body);
    const registration = await services.registration.markWon(req.ctx, req.params["id"] as Ulid, {
      value: requiredMoney(body, "value"),
      notes: optionalString(body, "notes"),
    });
    return jsonResponse(200, registrationView(registration, clock.now()));
  });

  router.post("/deal-registrations/:id/lose", async (req) => {
    const body = asRecord(req.body);
    const registration = await services.registration.markLost(req.ctx, req.params["id"] as Ulid, {
      reason: requiredEnum<LossReason>(body, "reason", LOSS_REASONS),
      competitor: optionalString(body, "competitor"),
      notes: optionalString(body, "notes"),
    });
    return jsonResponse(200, registrationView(registration, clock.now()));
  });

  router.post("/deal-registrations/:id/expire", async (req) => {
    const registration = await services.registration.expire(req.ctx, req.params["id"] as Ulid);
    return jsonResponse(200, registrationView(registration, clock.now()));
  });

  router.get("/deal-registrations/:id/conflicts", async (req) => {
    const cases = await services.conflict.forRegistration(req.ctx, req.params["id"] as Ulid);
    return jsonResponse(200, cases.map((c) => conflictView(c, clock.now())));
  });

  router.get("/deal-registrations/:id/quotes", async (req) => {
    const quotes = await services.quote.forRegistration(req.ctx, req.params["id"] as Ulid);
    return jsonResponse(200, quotes.map((q) => q.toJSON()));
  });

  router.get("/deal-registrations/:id/orders", async (req) => {
    const orders = await services.order.forRegistration(req.ctx, req.params["id"] as Ulid);
    return jsonResponse(200, orders.map((o) => o.toJSON()));
  });
}
