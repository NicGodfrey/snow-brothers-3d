import type { Ulid } from "@enterprise-suite/shared-kernel";
import { CERTIFICATION_STATUSES, type CertificationStatus } from "../../domain/certification.js";
import {
  CERTIFICATION_LEVELS,
  DELIVERY_MODES,
  ENROLLMENT_STATUSES,
  TRAINING_TRACKS,
  type CertificationLevel,
  type DeliveryMode,
  type EnrollmentStatus,
  type TrainingTrack,
} from "../../domain/training.js";
import type { PrmContainer } from "../../infrastructure/container.js";
import { jsonResponse, type Router } from "../router.js";
import {
  asRecord,
  enumFromQuery,
  idFromQuery,
  optionalDate,
  optionalNumber,
  optionalString,
  optionalStringArray,
  pageFromQuery,
  requiredEnum,
  requiredNumber,
  requiredString,
  requiredStringArray,
} from "../validate.js";

export function registerTrainingRoutes(router: Router, container: PrmContainer): void {
  const { training } = container.services;

  // --- catalog ---------------------------------------------------------------

  router.post("/courses", async (req) => {
    const body = asRecord(req.body);
    const course = await training.createCourse(req.ctx, {
      code: requiredString(body, "code"),
      title: requiredString(body, "title"),
      description: optionalString(body, "description"),
      track: requiredEnum<TrainingTrack>(body, "track", TRAINING_TRACKS),
      deliveryMode: requiredEnum<DeliveryMode>(body, "deliveryMode", DELIVERY_MODES),
      durationMinutes: requiredNumber(body, "durationMinutes"),
      passingScore: optionalNumber(body, "passingScore"),
      maxAttempts: optionalNumber(body, "maxAttempts"),
      prerequisiteCourseCodes: optionalStringArray(body, "prerequisiteCourseCodes"),
    });
    return jsonResponse(201, course);
  });

  router.get("/courses", async (req) => jsonResponse(200, await training.listCourses(req.ctx)));

  router.get("/courses/:code", async (req) =>
    jsonResponse(200, await training.getCourse(req.ctx, req.params["code"]!)),
  );

  router.post("/courses/:code/retire", async (req) =>
    jsonResponse(200, await training.retireCourse(req.ctx, req.params["code"]!)),
  );

  router.post("/certification-definitions", async (req) => {
    const body = asRecord(req.body);
    const definition = await training.createCertificationDefinition(req.ctx, {
      code: requiredString(body, "code"),
      name: requiredString(body, "name"),
      track: requiredEnum<TrainingTrack>(body, "track", TRAINING_TRACKS),
      level: requiredEnum<CertificationLevel>(body, "level", CERTIFICATION_LEVELS),
      requiredCourseCodes: requiredStringArray(body, "requiredCourseCodes"),
      renewalCourseCodes: optionalStringArray(body, "renewalCourseCodes"),
      validityMonths: optionalNumber(body, "validityMonths"),
      renewalWindowDays: optionalNumber(body, "renewalWindowDays"),
    });
    return jsonResponse(201, definition);
  });

  router.get("/certification-definitions", async (req) =>
    jsonResponse(200, await training.listCertificationDefinitions(req.ctx)),
  );

  // --- enrollments -----------------------------------------------------------

  router.post("/enrollments", async (req) => {
    const body = asRecord(req.body);
    const enrollment = await training.enroll(req.ctx, {
      portalUserId: requiredString(body, "portalUserId") as Ulid,
      courseCode: requiredString(body, "courseCode"),
    });
    return jsonResponse(201, enrollment.toJSON());
  });

  router.get("/enrollments", async (req) => {
    const page = await training.listEnrollments(
      req.ctx,
      {
        partnerId: idFromQuery(req.query, "partnerId"),
        portalUserId: idFromQuery(req.query, "portalUserId"),
        courseCode: req.query.get("courseCode") ?? undefined,
        status: enumFromQuery<EnrollmentStatus>(req.query, "status", ENROLLMENT_STATUSES),
      },
      pageFromQuery(req.query),
    );
    return jsonResponse(200, { ...page, items: page.items.map((e) => e.toJSON()) });
  });

  router.get("/enrollments/:id", async (req) =>
    jsonResponse(200, (await training.getEnrollment(req.ctx, req.params["id"] as Ulid)).toJSON()),
  );

  router.post("/enrollments/:id/start", async (req) =>
    jsonResponse(200, (await training.startEnrollment(req.ctx, req.params["id"] as Ulid)).toJSON()),
  );

  router.post("/enrollments/:id/attempts", async (req) => {
    const body = asRecord(req.body);
    const attempt = await training.recordAttempt(req.ctx, req.params["id"] as Ulid, {
      score: requiredNumber(body, "score"),
      proctored: body["proctored"] === true,
    });
    return jsonResponse(201, attempt);
  });

  router.post("/enrollments/:id/reset", async (req) => {
    const body = asRecord(req.body);
    const enrollment = await training.resetAttempts(
      req.ctx,
      req.params["id"] as Ulid,
      requiredString(body, "reason"),
    );
    return jsonResponse(200, enrollment.toJSON());
  });

  router.post("/enrollments/:id/withdraw", async (req) => {
    const body = asRecord(req.body);
    const enrollment = await training.withdraw(
      req.ctx,
      req.params["id"] as Ulid,
      requiredString(body, "reason"),
    );
    return jsonResponse(200, enrollment.toJSON());
  });

  // --- certifications --------------------------------------------------------

  router.post("/certifications", async (req) => {
    const body = asRecord(req.body);
    const certification = await training.award(req.ctx, {
      portalUserId: requiredString(body, "portalUserId") as Ulid,
      certificationCode: requiredString(body, "certificationCode"),
    });
    return jsonResponse(201, certification.toJSON());
  });

  router.get("/certifications", async (req) => {
    const page = await training.listCertifications(
      req.ctx,
      {
        partnerId: idFromQuery(req.query, "partnerId"),
        portalUserId: idFromQuery(req.query, "portalUserId"),
        certificationCode: req.query.get("code") ?? undefined,
        status: enumFromQuery<CertificationStatus>(req.query, "status", CERTIFICATION_STATUSES),
      },
      pageFromQuery(req.query),
    );
    return jsonResponse(200, { ...page, items: page.items.map((c) => c.toJSON()) });
  });

  router.get("/certifications/:id", async (req) =>
    jsonResponse(200, (await training.getCertification(req.ctx, req.params["id"] as Ulid)).toJSON()),
  );

  router.post("/certifications/:id/renew", async (req) =>
    jsonResponse(200, (await training.renew(req.ctx, req.params["id"] as Ulid)).toJSON()),
  );

  router.post("/certifications/:id/revoke", async (req) => {
    const body = asRecord(req.body);
    const certification = await training.revoke(
      req.ctx,
      req.params["id"] as Ulid,
      requiredString(body, "reason"),
    );
    return jsonResponse(200, certification.toJSON());
  });

  /** Batch job endpoint: expire everything past its validity date. */
  router.post("/certification-sweeps", async (req) => {
    const body = req.body === undefined ? {} : asRecord(req.body);
    const expired = await training.expireDue(req.ctx, optionalDate(body, "at"));
    return jsonResponse(200, { expired: expired.length, certificationIds: expired });
  });

  router.get("/partners/:id/certifications", async (req) =>
    jsonResponse(200, await training.partnerSummary(req.ctx, req.params["id"] as Ulid)),
  );

  router.get("/portal-users/:id/transcript", async (req) =>
    jsonResponse(200, await training.transcript(req.ctx, req.params["id"] as Ulid)),
  );
}
