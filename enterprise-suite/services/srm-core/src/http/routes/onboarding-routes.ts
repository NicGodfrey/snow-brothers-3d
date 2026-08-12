import type { Ulid } from "@enterprise-suite/shared-kernel";
import { CERTIFICATION_TYPES, type CertificationType } from "../../domain/certification.js";
import {
  APPROVER_ROLES,
  ONBOARDING_STATUSES,
  ONBOARDING_STEP_TYPES,
  ONBOARDING_TEMPLATE_CODES,
  ONBOARDING_TEMPLATES,
  type ApproverRole,
  type OnboardingStatus,
  type OnboardingStepType,
} from "../../domain/onboarding.js";
import type { SrmContainer } from "../../infrastructure/container.js";
import { jsonResponse, type Router } from "../router.js";
import {
  asRecord,
  optionalBoolean,
  optionalDate,
  optionalEnum,
  optionalString,
  optionalStringArray,
  pageFromQuery,
  queryEnum,
  queryId,
  requiredEnum,
  requiredId,
  requiredNumber,
  requiredString,
} from "../validate.js";

export function registerOnboardingRoutes(router: Router, container: SrmContainer): void {
  const { services } = container;

  /** The checklist templates a case can be started from. */
  router.get("/onboarding/templates", () => jsonResponse(200, Object.values(ONBOARDING_TEMPLATES)));

  router.post("/onboarding", async (req) => {
    const body = asRecord(req.body);
    const onboarding = await services.onboarding.start(req.ctx, {
      supplierId: requiredId(body, "supplierId"),
      templateCode: requiredEnum(body, "templateCode", ONBOARDING_TEMPLATE_CODES),
      targetGoLiveOn: optionalDate(body, "targetGoLiveOn"),
    });
    return jsonResponse(201, onboarding.toJSON());
  });

  router.get("/onboarding", async (req) => {
    const page = await services.onboarding.list(
      req.ctx,
      {
        status: queryEnum<OnboardingStatus>(req.query, "status", ONBOARDING_STATUSES),
        supplierId: queryId(req.query, "supplierId"),
        templateCode: req.query.get("templateCode") ?? undefined,
      },
      pageFromQuery(req.query),
    );
    return jsonResponse(200, { ...page, items: page.items.map((entry) => entry.toJSON()) });
  });

  router.get("/onboarding/:id", async (req) =>
    jsonResponse(200, (await services.onboarding.get(req.ctx, req.params["id"] as Ulid)).toJSON()),
  );

  /** Completion, risk tier and what is still outstanding. */
  router.get("/onboarding/:id/progress", async (req) => {
    const onboarding = await services.onboarding.get(req.ctx, req.params["id"] as Ulid);
    return jsonResponse(200, services.onboarding.progress(onboarding));
  });

  // --- checklist -----------------------------------------------------------

  router.post("/onboarding/:id/steps", async (req) => {
    const body = asRecord(req.body);
    const step = await services.onboarding.addStep(req.ctx, req.params["id"] as Ulid, {
      code: requiredString(body, "code"),
      name: requiredString(body, "name"),
      type: requiredEnum<OnboardingStepType>(body, "type", ONBOARDING_STEP_TYPES),
      ownerRole: requiredEnum<ApproverRole>(body, "ownerRole", APPROVER_ROLES),
      required: optionalBoolean(body, "required"),
      prerequisites: optionalStringArray(body, "prerequisites"),
      dueOn: optionalDate(body, "dueOn"),
    });
    return jsonResponse(201, step);
  });

  router.post("/onboarding/:id/steps/:code/start", async (req) =>
    jsonResponse(200, await services.onboarding.startStep(req.ctx, req.params["id"] as Ulid, req.params["code"]!)),
  );

  router.post("/onboarding/:id/steps/:code/complete", async (req) => {
    const body = asRecord(req.body ?? {});
    const step = await services.onboarding.completeStep(
      req.ctx,
      req.params["id"] as Ulid,
      req.params["code"]!,
      optionalString(body, "evidenceRef"),
    );
    return jsonResponse(200, step);
  });

  router.post("/onboarding/:id/steps/:code/waive", async (req) => {
    const body = asRecord(req.body);
    const step = await services.onboarding.waiveStep(
      req.ctx,
      req.params["id"] as Ulid,
      req.params["code"]!,
      requiredString(body, "reason"),
    );
    return jsonResponse(200, step);
  });

  // --- documents -----------------------------------------------------------

  router.post("/onboarding/:id/documents", async (req) => {
    const body = asRecord(req.body);
    const document = await services.onboarding.requestDocument(req.ctx, req.params["id"] as Ulid, {
      code: requiredString(body, "code"),
      name: requiredString(body, "name"),
      required: optionalBoolean(body, "required"),
      certificationType: optionalEnum<CertificationType>(body, "certificationType", CERTIFICATION_TYPES),
    });
    return jsonResponse(201, document);
  });

  router.post("/onboarding/:id/documents/:code/receive", async (req) => {
    const body = asRecord(req.body);
    const document = await services.onboarding.receiveDocument(
      req.ctx,
      req.params["id"] as Ulid,
      req.params["code"]!,
      requiredString(body, "fileRef"),
      optionalDate(body, "expiresOn"),
    );
    return jsonResponse(200, document);
  });

  router.post("/onboarding/:id/documents/:code/verify", async (req) =>
    jsonResponse(200, await services.onboarding.verifyDocument(req.ctx, req.params["id"] as Ulid, req.params["code"]!)),
  );

  router.post("/onboarding/:id/documents/:code/reject", async (req) => {
    const body = asRecord(req.body);
    const document = await services.onboarding.rejectDocument(
      req.ctx,
      req.params["id"] as Ulid,
      req.params["code"]!,
      requiredString(body, "reason"),
    );
    return jsonResponse(200, document);
  });

  // --- questionnaire & decision -------------------------------------------

  router.post("/onboarding/:id/answers", async (req) => {
    const body = asRecord(req.body);
    const onboarding = await services.onboarding.answerQuestion(req.ctx, req.params["id"] as Ulid, {
      code: requiredString(body, "code"),
      value: requiredString(body, "value"),
      riskFactor: requiredNumber(body, "riskFactor"),
      note: optionalString(body, "note"),
    });
    return jsonResponse(200, onboarding.toJSON());
  });

  router.post("/onboarding/:id/submit", async (req) =>
    jsonResponse(200, (await services.onboarding.submit(req.ctx, req.params["id"] as Ulid)).toJSON()),
  );

  /**
   * Records one role's decision. The last required approval triggers go-live:
   * supplier activation, certification materialisation and risk capture.
   */
  router.post("/onboarding/:id/decisions", async (req) => {
    const body = asRecord(req.body);
    const onboarding = await services.onboarding.decide(
      req.ctx,
      req.params["id"] as Ulid,
      requiredEnum<ApproverRole>(body, "role", APPROVER_ROLES),
      requiredEnum(body, "decision", ["approved", "rejected"] as const),
      optionalString(body, "comment"),
    );
    return jsonResponse(200, onboarding.toJSON());
  });

  router.post("/onboarding/:id/withdraw", async (req) => {
    const body = asRecord(req.body);
    const onboarding = await services.onboarding.withdraw(
      req.ctx,
      req.params["id"] as Ulid,
      requiredString(body, "reason"),
    );
    return jsonResponse(200, onboarding.toJSON());
  });
}
