import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HcmEvents } from "../src/domain/events.js";
import { assertDomainError, buildSeededModule, d } from "./helpers.js";

describe("skills", () => {
  it("assessments upsert with history", () => {
    const { module, tenant, seed } = buildSeededModule();
    const svc = module.skillsService;

    const first = svc.assessSkill(tenant, {
      employeeId: seed.staffEngineer.id,
      skillCode: "typescript",
      level: 3,
      assessedBy: seed.cto.id,
    });
    assert.equal(first.currentLevel, 3);
    assert.equal(first.history.length, 1);

    const second = svc.assessSkill(tenant, {
      employeeId: seed.staffEngineer.id,
      skillCode: "typescript",
      level: 5,
      assessedBy: seed.cto.id,
      notes: "led the platform rewrite",
    });
    assert.equal(second.id, first.id); // same aggregate, reassessed
    assert.equal(second.currentLevel, 5);
    assert.equal(second.history.length, 2);
    assert.equal(svc.listEmployeeSkills(tenant, seed.staffEngineer.id).length, 1);

    assertDomainError(
      () =>
        svc.assessSkill(tenant, {
          employeeId: seed.staffEngineer.id,
          skillCode: "no-such-skill",
          level: 2,
          assessedBy: seed.cto.id,
        }),
      "NOT_FOUND",
    );
  });

  it("finds qualified employees at or above a level", () => {
    const { module, tenant, seed } = buildSeededModule();
    const svc = module.skillsService;
    svc.assessSkill(tenant, { employeeId: seed.staffEngineer.id, skillCode: "postgres", level: 5, assessedBy: seed.cto.id });
    svc.assessSkill(tenant, { employeeId: seed.hrLead.id, skillCode: "postgres", level: 2, assessedBy: seed.cto.id });

    const qualified = svc.findQualified(tenant, "postgres", 4);
    assert.equal(qualified.length, 1);
    assert.equal(qualified[0].employeeId, seed.staffEngineer.id);
    assert.equal(svc.findQualified(tenant, "postgres", 2).length, 2);
  });
});

describe("certifications", () => {
  it("grants compute expiry from validity months (clamped month arithmetic)", () => {
    const { module, tenant, seed } = buildSeededModule();
    const svc = module.skillsService;
    // aws-sa-pro is seeded with validityMonths=36
    const grant = svc.grantCertification(tenant, {
      employeeId: seed.staffEngineer.id,
      certificationCode: "aws-sa-pro",
      issuedAt: d("2026-01-31"),
      credentialRef: "AWS-123",
    });
    assert.equal(grant.expiresAt, d("2029-01-31"));
    assert.equal(grant.status, "active");

    // a second active grant of the same certification is a conflict
    assertDomainError(
      () =>
        svc.grantCertification(tenant, {
          employeeId: seed.staffEngineer.id,
          certificationCode: "aws-sa-pro",
          issuedAt: d("2026-02-01"),
        }),
      "CONFLICT",
    );

    // perpetual certifications never expire
    svc.defineCertification(tenant, { code: "first-aid-basic", name: "First Aid", issuingBody: "Red Cross" });
    const perpetual = svc.grantCertification(tenant, {
      employeeId: seed.staffEngineer.id,
      certificationCode: "first-aid-basic",
      issuedAt: d("2026-01-01"),
    });
    assert.equal(perpetual.expiresAt, undefined);
  });

  it("lists expiring grants within a horizon and sweeps expirations", () => {
    const { module, tenant, seed, clock } = buildSeededModule("2026-01-15");
    const svc = module.skillsService;
    svc.defineCertification(tenant, { code: "forklift", name: "Forklift License", issuingBody: "TÜV", validityMonths: 1 });
    const grant = svc.grantCertification(tenant, {
      employeeId: seed.hrLead.id,
      certificationCode: "forklift",
      issuedAt: d("2026-01-01"), // expires 2026-02-01
    });

    assert.equal(svc.listExpiring(tenant, 30).length, 1);
    assert.equal(svc.listExpiring(tenant, 5).length, 0);

    module.outbox.drain();
    clock.set(d("2026-02-02"));
    assert.equal(svc.refreshExpirations(tenant), 1);
    assert.equal(grant.status, "expired");
    assert.equal(svc.refreshExpirations(tenant), 0); // idempotent
    const emitted = module.outbox.drain().map((e) => e.eventType);
    assert.ok(emitted.includes(HcmEvents.CertificationExpired));

    // once expired, the certification can be granted again
    const regrant = svc.grantCertification(tenant, {
      employeeId: seed.hrLead.id,
      certificationCode: "forklift",
      issuedAt: d("2026-02-02"),
    });
    assert.equal(regrant.status, "active");
  });

  it("revocation requires a note and a live grant", () => {
    const { module, tenant, seed } = buildSeededModule();
    const svc = module.skillsService;
    const grant = svc.grantCertification(tenant, {
      employeeId: seed.staffEngineer.id,
      certificationCode: "aws-sa-pro",
      issuedAt: d("2026-01-01"),
    });
    assertDomainError(() => svc.revokeCertification(tenant, grant.id, "  "), "REVOCATION_NOTE_REQUIRED");
    svc.revokeCertification(tenant, grant.id, "credential could not be verified");
    assert.equal(grant.status, "revoked");
    assertDomainError(() => svc.revokeCertification(tenant, grant.id, "again"), "INVALID_STATUS_TRANSITION");
  });
});
