import type { Ulid } from "@enterprise-suite/shared-kernel";
import {
  CERTIFICATION_TYPES,
  type CertificationStatus,
  type CertificationType,
} from "../../domain/certification.js";
import {
  FINDING_SEVERITIES,
  QUALIFICATION_METHODS,
  QUALIFICATION_TYPES,
  SECTION_CODES,
  type FindingSeverity,
  type QualificationMethod,
  type QualificationOutcome,
  type QualificationStatus,
  type QualificationType,
  type SectionCode,
} from "../../domain/qualification.js";
import type { SrmContainer } from "../../infrastructure/container.js";
import { jsonResponse, type Router } from "../router.js";
import {
  asRecord,
  optionalId,
  optionalIdArray,
  optionalNumber,
  optionalNumberMap,
  optionalObject,
  optionalString,
  optionalUserId,
  pageFromQuery,
  queryDate,
  queryEnum,
  queryId,
  queryNumber,
  requiredDate,
  requiredEnum,
  requiredId,
  requiredNumber,
  requiredString,
} from "../validate.js";

const CERTIFICATION_STATUSES = [
  "pending_verification",
  "valid",
  "expired",
  "revoked",
  "rejected",
] as const satisfies readonly CertificationStatus[];

const QUALIFICATION_STATUSES = [
  "planned",
  "in_progress",
  "completed",
  "expired",
  "withdrawn",
] as const satisfies readonly QualificationStatus[];

const QUALIFICATION_OUTCOMES = [
  "pending",
  "passed",
  "conditional",
  "failed",
] as const satisfies readonly QualificationOutcome[];

export function registerQualificationRoutes(router: Router, container: SrmContainer): void {
  const { services } = container;

  // --- qualifications ------------------------------------------------------

  router.post("/qualifications", async (req) => {
    const body = asRecord(req.body);
    const qualification = await services.qualification.schedule(req.ctx, {
      supplierId: requiredId(body, "supplierId"),
      type: requiredEnum<QualificationType>(body, "type", QUALIFICATION_TYPES),
      method: requiredEnum<QualificationMethod>(body, "method", QUALIFICATION_METHODS),
      scheduledOn: requiredDate(body, "scheduledOn"),
      categoryId: optionalId(body, "categoryId"),
      siteId: optionalId(body, "siteId"),
      validityMonths: optionalNumber(body, "validityMonths"),
      sectionWeights: optionalNumberMap(body, "sectionWeights") as
        | Partial<Record<SectionCode, number>>
        | undefined,
    });
    return jsonResponse(201, qualification.toJSON());
  });

  router.get("/qualifications", async (req) => {
    const page = await services.qualification.list(
      req.ctx,
      {
        supplierId: queryId(req.query, "supplierId"),
        categoryId: queryId(req.query, "categoryId"),
        status: queryEnum<QualificationStatus>(req.query, "status", QUALIFICATION_STATUSES),
        outcome: queryEnum<QualificationOutcome>(req.query, "outcome", QUALIFICATION_OUTCOMES),
      },
      pageFromQuery(req.query),
    );
    return jsonResponse(200, { ...page, items: page.items.map((entry) => entry.toJSON()) });
  });

  /** Passes whose validity runs out inside the horizon. */
  router.get("/qualifications/due", async (req) => {
    const due = await services.qualification.dueForRequalification(req.ctx, queryNumber(req.query, "withinDays") ?? 90);
    return jsonResponse(200, due.map((entry) => entry.toJSON()));
  });

  router.get("/qualifications/:id", async (req) =>
    jsonResponse(200, (await services.qualification.get(req.ctx, req.params["id"] as Ulid)).toJSON()),
  );

  router.post("/qualifications/:id/start", async (req) =>
    jsonResponse(200, (await services.qualification.start(req.ctx, req.params["id"] as Ulid)).toJSON()),
  );

  router.post("/qualifications/:id/sections", async (req) => {
    const body = asRecord(req.body);
    const qualification = await services.qualification.scoreSection(
      req.ctx,
      req.params["id"] as Ulid,
      requiredEnum<SectionCode>(body, "section", SECTION_CODES),
      requiredNumber(body, "score"),
      optionalString(body, "notes"),
    );
    return jsonResponse(200, qualification.toJSON());
  });

  router.post("/qualifications/:id/findings", async (req) => {
    const body = asRecord(req.body);
    const capa = optionalObject(body, "capa");
    const finding = await services.qualification.raiseFinding(req.ctx, req.params["id"] as Ulid, {
      section: requiredEnum<SectionCode>(body, "section", SECTION_CODES),
      severity: requiredEnum<FindingSeverity>(body, "severity", FINDING_SEVERITIES),
      description: requiredString(body, "description"),
      capa: capa
        ? {
            action: requiredString(capa, "action"),
            ownerId: optionalUserId(capa, "ownerId"),
            dueOn: requiredDate(capa, "dueOn"),
          }
        : undefined,
    });
    return jsonResponse(201, finding);
  });

  /** Closing the last major finding can re-rate the audit and lift its hold. */
  router.post("/qualifications/:id/findings/:findingId/close", async (req) => {
    const body = asRecord(req.body);
    const qualification = await services.qualification.closeFinding(
      req.ctx,
      req.params["id"] as Ulid,
      req.params["findingId"] as Ulid,
      requiredString(body, "evidence"),
    );
    return jsonResponse(200, qualification.toJSON());
  });

  router.post("/qualifications/:id/findings/:findingId/waive", async (req) => {
    const body = asRecord(req.body);
    const qualification = await services.qualification.waiveFinding(
      req.ctx,
      req.params["id"] as Ulid,
      req.params["findingId"] as Ulid,
      requiredString(body, "reason"),
    );
    return jsonResponse(200, qualification.toJSON());
  });

  router.post("/qualifications/:id/complete", async (req) => {
    const body = asRecord(req.body ?? {});
    const result = await services.qualification.complete(
      req.ctx,
      req.params["id"] as Ulid,
      optionalString(body, "summary"),
    );
    return jsonResponse(200, { outcome: result.outcome, qualification: result.qualification.toJSON() });
  });

  router.post("/qualifications/:id/withdraw", async (req) => {
    const body = asRecord(req.body);
    const qualification = await services.qualification.withdraw(
      req.ctx,
      req.params["id"] as Ulid,
      requiredString(body, "reason"),
    );
    return jsonResponse(200, qualification.toJSON());
  });

  // --- certifications ------------------------------------------------------

  router.post("/certifications", async (req) => {
    const body = asRecord(req.body);
    const certification = await services.qualification.recordCertification(req.ctx, {
      supplierId: requiredId(body, "supplierId"),
      type: requiredEnum<CertificationType>(body, "type", CERTIFICATION_TYPES),
      issuer: requiredString(body, "issuer"),
      certificateNumber: requiredString(body, "certificateNumber"),
      issuedOn: requiredDate(body, "issuedOn"),
      expiresOn: requiredDate(body, "expiresOn"),
      scope: optionalString(body, "scope"),
      siteIds: optionalIdArray(body, "siteIds"),
      documentRef: optionalString(body, "documentRef"),
    });
    return jsonResponse(201, certification.toJSON());
  });

  router.get("/certifications", async (req) => {
    const page = await services.qualification.listCertifications(
      req.ctx,
      {
        supplierId: queryId(req.query, "supplierId"),
        type: queryEnum<CertificationType>(req.query, "type", CERTIFICATION_TYPES),
        status: queryEnum<CertificationStatus>(req.query, "status", CERTIFICATION_STATUSES),
        expiringBefore: queryDate(req.query, "expiringBefore"),
      },
      pageFromQuery(req.query),
    );
    return jsonResponse(200, { ...page, items: page.items.map((entry) => entry.toJSON()) });
  });

  router.get("/certifications/:id", async (req) =>
    jsonResponse(200, (await services.qualification.getCertification(req.ctx, req.params["id"] as Ulid)).toJSON()),
  );

  router.post("/certifications/:id/verify", async (req) =>
    jsonResponse(200, (await services.qualification.verifyCertification(req.ctx, req.params["id"] as Ulid)).toJSON()),
  );

  router.post("/certifications/:id/reject", async (req) => {
    const body = asRecord(req.body);
    const certification = await services.qualification.rejectCertification(
      req.ctx,
      req.params["id"] as Ulid,
      requiredString(body, "reason"),
    );
    return jsonResponse(200, certification.toJSON());
  });

  router.post("/certifications/:id/renew", async (req) => {
    const body = asRecord(req.body);
    const certification = await services.qualification.renewCertification(req.ctx, req.params["id"] as Ulid, {
      certificateNumber: requiredString(body, "certificateNumber"),
      issuedOn: requiredDate(body, "issuedOn"),
      expiresOn: requiredDate(body, "expiresOn"),
      documentRef: optionalString(body, "documentRef"),
    });
    return jsonResponse(200, certification.toJSON());
  });

  router.post("/certifications/:id/revoke", async (req) => {
    const body = asRecord(req.body);
    const certification = await services.qualification.revokeCertification(
      req.ctx,
      req.params["id"] as Ulid,
      requiredString(body, "reason"),
    );
    return jsonResponse(200, certification.toJSON());
  });

  /**
   * Nightly compliance job, exposed so it can be driven by a scheduler or
   * replayed by hand after a data fix.
   */
  router.post("/jobs/compliance-sweep", async (req) => {
    const body = asRecord(req.body ?? {});
    const result = await services.qualification.runComplianceSweep(req.ctx, optionalNumber(body, "warningDays"));
    return jsonResponse(200, result);
  });
}
