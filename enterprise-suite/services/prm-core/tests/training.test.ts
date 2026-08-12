import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Ulid } from "@enterprise-suite/shared-kernel";
import { activePartner, expectRejects, portalUser, world, type TestWorld } from "./helpers.js";

async function catalog(w: TestWorld): Promise<void> {
  const { training } = w.container.services;
  await training.createCourse(w.ctx, {
    code: "tech-foundations",
    title: "Platform architecture essentials",
    track: "technical",
    deliveryMode: "self_paced",
    durationMinutes: 240,
    passingScore: 70,
  });
  await training.createCourse(w.ctx, {
    code: "tech-advanced",
    title: "Deployment and integration lab",
    track: "technical",
    deliveryMode: "lab",
    durationMinutes: 960,
    passingScore: 80,
    maxAttempts: 2,
    prerequisiteCourseCodes: ["tech-foundations"],
  });
  await training.createCertificationDefinition(w.ctx, {
    code: "tech-pro",
    name: "Certified Technical Professional",
    track: "technical",
    level: "professional",
    requiredCourseCodes: ["tech-foundations", "tech-advanced"],
    renewalCourseCodes: ["tech-advanced"],
    validityMonths: 24,
    renewalWindowDays: 90,
  });
}

async function pass(w: TestWorld, userId: Ulid, courseCode: string, score = 90): Promise<Ulid> {
  const { training } = w.container.services;
  const enrollment = await training.enroll(w.ctx, { portalUserId: userId, courseCode });
  await training.startEnrollment(w.ctx, enrollment.id);
  await training.recordAttempt(w.ctx, enrollment.id, { score, proctored: true });
  return enrollment.id;
}

describe("training catalog and enrollment", () => {
  it("normalises codes and refuses duplicates", async () => {
    const w = world();
    await catalog(w);
    await expectRejects(
      w.container.services.training.createCourse(w.ctx, {
        code: "TECH-Foundations",
        title: "Duplicate",
        track: "technical",
        deliveryMode: "self_paced",
        durationMinutes: 60,
      }),
      "CONFLICT",
    );
    await expectRejects(
      w.container.services.training.createCourse(w.ctx, {
        code: "self-referential",
        title: "Loops",
        track: "sales",
        deliveryMode: "self_paced",
        durationMinutes: 60,
        prerequisiteCourseCodes: ["self-referential"],
      }),
      "VALIDATION",
      "cannot require itself",
    );
  });

  it("enforces prerequisites and one live enrollment per course", async () => {
    const w = world();
    await catalog(w);
    const partner = await activePartner(w);
    const userId = await portalUser(w, partner.id, "tara@contoso.example", ["technical_lead"]);

    await expectRejects(
      w.container.services.training.enroll(w.ctx, { portalUserId: userId, courseCode: "tech-advanced" }),
      "VALIDATION",
      "complete tech-foundations first",
    );
    const first = await w.container.services.training.enroll(w.ctx, {
      portalUserId: userId,
      courseCode: "tech-foundations",
    });
    await expectRejects(
      w.container.services.training.enroll(w.ctx, {
        portalUserId: userId,
        courseCode: "tech-foundations",
      }),
      "CONFLICT",
      "already enrolled",
    );
    // Withdrawing frees the slot for a fresh attempt at the course.
    await w.container.services.training.withdraw(w.ctx, first.id, "Changed role");
    const second = await w.container.services.training.enroll(w.ctx, {
      portalUserId: userId,
      courseCode: "tech-foundations",
    });
    assert.notEqual(second.id, first.id);
  });

  it("tracks attempts, fails after the last one and reopens on reset", async () => {
    const w = world();
    await catalog(w);
    const partner = await activePartner(w);
    const userId = await portalUser(w, partner.id, "tara@contoso.example", ["technical_lead"]);
    await pass(w, userId, "tech-foundations");

    const enrollment = await w.container.services.training.enroll(w.ctx, {
      portalUserId: userId,
      courseCode: "tech-advanced",
    });
    await w.container.services.training.startEnrollment(w.ctx, enrollment.id);
    const first = await w.container.services.training.recordAttempt(w.ctx, enrollment.id, { score: 54 });
    assert.equal(first.passed, false);
    await w.container.services.training.recordAttempt(w.ctx, enrollment.id, { score: 61 });
    const failed = await w.container.services.training.getEnrollment(w.ctx, enrollment.id);
    assert.equal(failed.status, "failed");
    assert.equal(failed.bestScore, 61);
    assert.equal(failed.attemptsRemaining, 0);
    await expectRejects(
      w.container.services.training.recordAttempt(w.ctx, enrollment.id, { score: 95 }),
      "INVALID_STATE",
    );

    const reset = await w.container.services.training.resetAttempts(w.ctx, enrollment.id, "Exam platform outage");
    assert.equal(reset.status, "in_progress");
    assert.equal(reset.attemptsRemaining, 2);
    await w.container.services.training.recordAttempt(w.ctx, enrollment.id, { score: 88 });
    const completed = await w.container.services.training.getEnrollment(w.ctx, enrollment.id);
    assert.equal(completed.status, "completed");
    assert.equal(completed.completedAt, w.clock.now());
  });
});

describe("certifications", () => {
  it("awards only once every required course is passed", async () => {
    const w = world();
    await catalog(w);
    const partner = await activePartner(w);
    const userId = await portalUser(w, partner.id, "tara@contoso.example", ["technical_lead"]);
    await pass(w, userId, "tech-foundations");

    await expectRejects(
      w.container.services.training.award(w.ctx, { portalUserId: userId, certificationCode: "tech-pro" }),
      "CERTIFICATION_REQUIREMENTS_NOT_MET",
      "tech-advanced",
    );
    await pass(w, userId, "tech-advanced", 92);
    const certification = await w.container.services.training.award(w.ctx, {
      portalUserId: userId,
      certificationCode: "tech-pro",
    });
    assert.equal(certification.status, "active");
    assert.equal(certification.level, "professional");
    assert.equal((certification.toJSON() as { evidenceEnrollmentIds: string[] }).evidenceEnrollmentIds.length, 2);
    await expectRejects(
      w.container.services.training.award(w.ctx, { portalUserId: userId, certificationCode: "tech-pro" }),
      "CONFLICT",
      "already holds",
    );
  });

  it("renews inside the window against fresh coursework and keeps the anniversary", async () => {
    const w = world();
    await catalog(w);
    const partner = await activePartner(w);
    const userId = await portalUser(w, partner.id, "tara@contoso.example", ["technical_lead"]);
    await pass(w, userId, "tech-foundations");
    await pass(w, userId, "tech-advanced", 92);
    const certification = await w.container.services.training.award(w.ctx, {
      portalUserId: userId,
      certificationCode: "tech-pro",
    });
    const originalExpiry = certification.expiresAt;

    // The coursework behind the original award cannot be recycled into a new term.
    await expectRejects(
      w.container.services.training.renew(w.ctx, certification.id),
      "CERTIFICATION_REQUIREMENTS_NOT_MET",
      "tech-advanced",
    );

    // Retaking a completed course is how recertification works.
    w.clock.advanceDays(400);
    await pass(w, userId, "tech-advanced", 95);

    // Recertified, but still more than 90 days out from expiry.
    await expectRejects(
      w.container.services.training.renew(w.ctx, certification.id),
      "INVALID_STATE",
      "can only be renewed within",
    );
    w.clock.advanceDays(300);
    const renewed = await w.container.services.training.renew(w.ctx, certification.id);
    assert.equal(renewed.renewals.length, 1);
    // Early renewal is measured from the old expiry, not from today.
    assert.equal(renewed.renewals[0]?.previousExpiresAt, originalExpiry);
    assert.ok(Date.parse(renewed.expiresAt) > Date.parse(originalExpiry));
  });

  it("expires by sweep and revokes with a reason", async () => {
    const w = world();
    await catalog(w);
    const partner = await activePartner(w);
    const holder = await portalUser(w, partner.id, "tara@contoso.example", ["technical_lead"]);
    const other = await portalUser(w, partner.id, "kai@contoso.example", ["technical_lead"]);
    for (const userId of [holder, other]) {
      await pass(w, userId, "tech-foundations");
      await pass(w, userId, "tech-advanced", 92);
      await w.container.services.training.award(w.ctx, {
        portalUserId: userId,
        certificationCode: "tech-pro",
      });
    }

    const summary = await w.container.services.training.partnerSummary(w.ctx, partner.id);
    assert.equal(summary.certifiedIndividuals, 2);
    assert.deepEqual(summary.countsByCode, { "tech-pro": 2 });

    const revoked = await w.container.services.training.listCertifications(w.ctx, { portalUserId: other });
    await expectRejects(
      w.container.services.training.revoke(w.ctx, revoked.items[0]!.id, "  "),
      "VALIDATION",
    );
    await w.container.services.training.revoke(w.ctx, revoked.items[0]!.id, "Exam integrity investigation");

    const afterRevoke = await w.container.services.training.partnerSummary(w.ctx, partner.id);
    assert.equal(afterRevoke.certifiedIndividuals, 1);

    w.clock.advanceDays(800);
    const expired = await w.container.services.training.expireDue(w.ctx);
    assert.equal(expired.length, 1);
    const empty = await w.container.services.training.partnerSummary(w.ctx, partner.id);
    assert.equal(empty.certifiedIndividuals, 0);
    assert.deepEqual([...empty.activeCertificationCodes], []);
    // A second sweep is a no-op.
    assert.deepEqual([...(await w.container.services.training.expireDue(w.ctx))], []);
  });

  it("builds a transcript of completed courses and live credentials", async () => {
    const w = world();
    await catalog(w);
    const partner = await activePartner(w);
    const userId = await portalUser(w, partner.id, "tara@contoso.example", ["technical_lead"]);
    await pass(w, userId, "tech-foundations");
    const inFlight = await w.container.services.training.enroll(w.ctx, {
      portalUserId: userId,
      courseCode: "tech-advanced",
    });
    await w.container.services.training.startEnrollment(w.ctx, inFlight.id);

    const transcript = await w.container.services.training.transcript(w.ctx, userId);
    assert.deepEqual([...transcript.completedCourseCodes], ["tech-foundations"]);
    assert.deepEqual([...transcript.inProgressCourseCodes], ["tech-advanced"]);
    assert.equal(transcript.certifications.length, 0);
  });

  it("keeps a retired course out of new enrollments", async () => {
    const w = world();
    await catalog(w);
    const partner = await activePartner(w);
    const userId = await portalUser(w, partner.id, "tara@contoso.example", ["technical_lead"]);
    // A course a certification still depends on cannot be pulled from the catalog.
    await expectRejects(
      w.container.services.training.retireCourse(w.ctx, "tech-foundations"),
      "INVALID_STATE",
      "required by tech-pro",
    );

    await w.container.services.training.createCourse(w.ctx, {
      code: "marketing-basics",
      title: "Co-marketing essentials",
      track: "marketing",
      deliveryMode: "self_paced",
      durationMinutes: 90,
    });
    await w.container.services.training.retireCourse(w.ctx, "marketing-basics");
    await expectRejects(
      w.container.services.training.enroll(w.ctx, { portalUserId: userId, courseCode: "marketing-basics" }),
      "INVALID_STATE",
      "retired",
    );
  });
});
