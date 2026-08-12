import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Ulid } from "@enterprise-suite/shared-kernel";
import { activePartner, approvedPartner, expectRejects, portalUser, usd, world, type TestWorld } from "./helpers.js";

/** Standard tier program plus the reference entitlement catalog. */
async function program(w: TestWorld): Promise<void> {
  await w.container.services.tier.installStandardProgram(w.ctx);
  await w.container.services.entitlement.installStandardCatalog(w.ctx);
}

async function goldPartner(w: TestWorld): Promise<Ulid> {
  const partner = await activePartner(w);
  await w.container.services.tier.assign(w.ctx, partner.id, {
    tierCode: "gold",
    reason: "Migrated from the legacy program at launch",
    override: true,
  });
  return partner.id;
}

describe("portal users", () => {
  it("invites, activates and refuses a second account for the same mailbox", async () => {
    const w = world();
    const partner = await activePartner(w);
    const user = await w.container.services.portal.invite(w.ctx, {
      partnerId: partner.id,
      email: "Ada@Contoso.example",
      firstName: "Ada",
      lastName: "Nkemelu",
      roles: ["portal_admin"],
    });
    assert.equal(user.email, "ada@contoso.example");
    assert.equal(user.status, "invited");
    await expectRejects(
      w.container.services.portal.invite(w.ctx, {
        partnerId: partner.id,
        email: "ada@contoso.example",
        firstName: "Ada",
        lastName: "Duplicate",
        roles: ["sales_rep"],
      }),
      "CONFLICT",
    );
    const active = await w.container.services.portal.acceptInvite(w.ctx, user.id);
    assert.equal(active.status, "active");
    const loggedIn = await w.container.services.portal.recordLogin(w.ctx, user.id);
    assert.equal(loggedIn.loginCount, 1);
  });

  it("expires an unaccepted invite until it is resent", async () => {
    const w = world();
    const partner = await activePartner(w);
    const user = await w.container.services.portal.invite(w.ctx, {
      partnerId: partner.id,
      email: "noor@contoso.example",
      firstName: "Noor",
      lastName: "Haddad",
      roles: ["sales_rep"],
      inviteValidDays: 7,
    });
    w.clock.advanceDays(8);
    await expectRejects(
      w.container.services.portal.acceptInvite(w.ctx, user.id),
      "INVALID_STATE",
      "expired",
    );
    await w.container.services.portal.resendInvite(w.ctx, user.id, 14);
    const accepted = await w.container.services.portal.acceptInvite(w.ctx, user.id);
    assert.equal(accepted.status, "active");
  });

  it("keeps at least one usable portal administrator", async () => {
    const w = world();
    const partner = await activePartner(w);
    const adminId = await portalUser(w, partner.id, "ada@contoso.example", ["portal_admin"]);
    await portalUser(w, partner.id, "sam@contoso.example", ["sales_rep"]);

    await expectRejects(
      w.container.services.portal.setRoles(w.ctx, adminId, ["sales_rep"]),
      "INVALID_STATE",
      "at least one portal administrator",
    );
    await expectRejects(
      w.container.services.portal.disable(w.ctx, adminId, "Left the company"),
      "INVALID_STATE",
      "at least one portal administrator",
    );

    const secondAdmin = await portalUser(w, partner.id, "kai@contoso.example", ["portal_admin"]);
    const disabled = await w.container.services.portal.disable(w.ctx, adminId, "Left the company");
    assert.equal(disabled.status, "disabled");
    // With the first one gone, the remaining admin is protected again.
    await expectRejects(
      w.container.services.portal.disable(w.ctx, secondAdmin, "Also leaving"),
      "INVALID_STATE",
    );
    const reenabled = await w.container.services.portal.enable(w.ctx, adminId);
    assert.equal(reenabled.status, "active");
  });

  it("closes every login when a partner is offboarded", async () => {
    const w = world();
    const partner = await activePartner(w);
    await portalUser(w, partner.id, "ada@contoso.example", ["portal_admin"]);
    await portalUser(w, partner.id, "sam@contoso.example", ["sales_rep"]);
    const disabled = await w.container.services.portal.disableAllForPartner(
      w.ctx,
      partner.id,
      "Partner suspended for payment arrears",
    );
    assert.equal(disabled, 2);
    const users = await w.container.services.portal.forPartner(w.ctx, partner.id);
    assert.deepEqual(users.map((u) => u.status), ["disabled", "disabled"]);
  });

  it("refuses portal accounts for a terminated partner", async () => {
    const w = world();
    const partner = await approvedPartner(w);
    await w.container.services.partner.reject(w.ctx, partner.id, "Failed compliance screening");
    await expectRejects(
      w.container.services.portal.invite(w.ctx, {
        partnerId: partner.id,
        email: "ada@contoso.example",
        firstName: "Ada",
        lastName: "Nkemelu",
        roles: ["portal_admin"],
      }),
      "INVALID_STATE",
      "portal access is closed",
    );
  });
});

describe("entitlement resolution", () => {
  it("explains what is missing instead of silently hiding a capability", async () => {
    const w = world();
    await program(w);
    const partner = await activePartner(w);
    const userId = await portalUser(w, partner.id, "sam@contoso.example", ["sales_rep"]);

    const decisions = await w.container.services.entitlement.resolveForUser(w.ctx, userId);
    const training = decisions.find((d) => d.code === "training_library");
    assert.equal(training?.granted, true);
    assert.equal(training?.source, "policy");

    // No tier yet, so anything above "registered" is out of reach with reasons.
    const dealReg = decisions.find((d) => d.code === "deal_registration");
    assert.equal(dealReg?.granted, false);
    assert.deepEqual([...dealReg!.reasons], ["tier rank 0 is below the required 10"]);

    const mdf = decisions.find((d) => d.code === "mdf_requests");
    assert.deepEqual(
      [...mdf!.reasons],
      [
        "tier rank 0 is below the required 20",
        "requires one of the roles [portal_admin, marketing_manager]",
      ],
    );
  });

  it("grants on tier, role, contract and certification facts together", async () => {
    const w = world();
    await program(w);
    const partnerId = await goldPartner(w);
    const salesRep = await portalUser(w, partnerId, "sam@contoso.example", ["sales_rep"]);

    const beforeCerts = await w.container.services.entitlement.check(w.ctx, salesRep, "deal_registration");
    assert.equal(beforeCerts.granted, true);
    // Lead sharing additionally needs the partner to hold sales-pro somewhere.
    await expectRejects(
      w.container.services.entitlement.check(w.ctx, salesRep, "lead_distribution"),
      "ENTITLEMENT_DENIED",
      'partner is missing certification "sales-pro"',
    );

    await w.container.services.training.createCourse(w.ctx, {
      code: "sales-foundations",
      title: "Selling the platform",
      track: "sales",
      deliveryMode: "self_paced",
      durationMinutes: 120,
    });
    await w.container.services.training.createCertificationDefinition(w.ctx, {
      code: "sales-pro",
      name: "Certified Sales Professional",
      track: "sales",
      level: "professional",
      requiredCourseCodes: ["sales-foundations"],
    });
    const enrollment = await w.container.services.training.enroll(w.ctx, {
      portalUserId: salesRep,
      courseCode: "sales-foundations",
    });
    await w.container.services.training.startEnrollment(w.ctx, enrollment.id);
    await w.container.services.training.recordAttempt(w.ctx, enrollment.id, { score: 91 });
    await w.container.services.training.award(w.ctx, {
      portalUserId: salesRep,
      certificationCode: "sales-pro",
    });

    const decision = await w.container.services.entitlement.check(w.ctx, salesRep, "lead_distribution");
    assert.equal(decision.granted, true);

    // A personal certification requirement is not satisfied by a colleague's.
    const support = await portalUser(w, partnerId, "kai@contoso.example", ["support_agent"]);
    await expectRejects(
      w.container.services.entitlement.check(w.ctx, support, "support_l2_escalation"),
      "ENTITLEMENT_DENIED",
      'user is missing certification "tech-pro"',
    );
  });

  it("lets an explicit deny beat an allow and both beat the policy", async () => {
    const w = world();
    await program(w);
    const partnerId = await goldPartner(w);
    const marketer = await portalUser(w, partnerId, "ada@contoso.example", [
      "portal_admin",
      "marketing_manager",
    ]);

    const before = await w.container.services.entitlement.check(w.ctx, marketer, "co_brandable_assets");
    assert.equal(before.granted, true);

    const deny = await w.container.services.entitlement.grant(w.ctx, {
      entitlementCode: "co_brandable_assets",
      subject: "user",
      subjectId: marketer,
      effect: "deny",
      reason: "Brand guideline violation under review",
    });
    await expectRejects(
      w.container.services.entitlement.check(w.ctx, marketer, "co_brandable_assets"),
      "ENTITLEMENT_DENIED",
      "Brand guideline violation",
    );
    // An allow on top does not override the deny.
    await w.container.services.entitlement.grant(w.ctx, {
      entitlementCode: "co_brandable_assets",
      subject: "partner",
      subjectId: partnerId,
      effect: "allow",
      reason: "Agency exception for the launch campaign",
    });
    const stillDenied = await w.container.services.entitlement.resolveForUser(w.ctx, marketer);
    assert.equal(stillDenied.find((d) => d.code === "co_brandable_assets")?.source, "explicit_deny");

    await w.container.services.entitlement.revokeGrant(w.ctx, deny.id);
    const allowed = await w.container.services.entitlement.check(w.ctx, marketer, "co_brandable_assets");
    assert.equal(allowed.source, "explicit_allow");
  });

  it("honours an expiring allow for a partner that does not qualify yet", async () => {
    const w = world();
    await program(w);
    const applicant = await approvedPartner(w);
    const decisionsBefore = await w.container.services.entitlement.resolveForPartner(w.ctx, applicant.id);
    assert.equal(decisionsBefore.find((d) => d.code === "price_list_download")?.granted, false);

    await w.container.services.entitlement.grant(w.ctx, {
      entitlementCode: "price_list_download",
      subject: "partner",
      subjectId: applicant.id,
      effect: "allow",
      reason: "Pre-onboarding pricing review",
      expiresAt: new Date(Date.parse(w.clock.now()) + 30 * 24 * 3600 * 1000).toISOString() as never,
    });
    const granted = await w.container.services.entitlement.resolveForPartner(w.ctx, applicant.id);
    assert.equal(granted.find((d) => d.code === "price_list_download")?.granted, true);

    w.clock.advanceDays(31);
    const lapsed = await w.container.services.entitlement.resolveForPartner(w.ctx, applicant.id);
    const decision = lapsed.find((d) => d.code === "price_list_download");
    assert.equal(decision?.granted, false);
    assert.equal(decision?.source, "policy");
  });

  it("refuses a duplicate live override and unknown entitlements", async () => {
    const w = world();
    await program(w);
    const partnerId = await goldPartner(w);
    await w.container.services.entitlement.grant(w.ctx, {
      entitlementCode: "nfr_licenses",
      subject: "partner",
      subjectId: partnerId,
      effect: "allow",
      reason: "Lab environment for the migration project",
    });
    await expectRejects(
      w.container.services.entitlement.grant(w.ctx, {
        entitlementCode: "nfr_licenses",
        subject: "partner",
        subjectId: partnerId,
        effect: "allow",
        reason: "Duplicate",
      }),
      "CONFLICT",
    );
    await expectRejects(
      w.container.services.entitlement.grant(w.ctx, {
        entitlementCode: "teleportation",
        subject: "partner",
        subjectId: partnerId,
        effect: "allow",
        reason: "Not a real capability",
      }),
      "NOT_FOUND",
    );
  });

  it("drives the portal menu from resolution", async () => {
    const w = world();
    await program(w);
    const partnerId = await goldPartner(w);
    const admin = await portalUser(w, partnerId, "ada@contoso.example", [
      "portal_admin",
      "marketing_manager",
      "finance",
    ]);
    const menu = await w.container.services.entitlement.portalMenu(w.ctx, admin);
    assert.deepEqual(
      [...menu.granted].sort(),
      [
        "co_brandable_assets",
        "deal_registration",
        "mdf_requests",
        "price_list_download",
        "rebate_statements",
        "training_library",
      ],
    );
    assert.deepEqual(
      menu.blocked.map((b) => b.code).sort(),
      ["lead_distribution", "nfr_licenses", "solution_listing", "support_l2_escalation"],
    );
    assert.ok(menu.blocked.every((b) => b.reasons.length > 0));
  });

  it("cuts a suspended partner off from everything the policy gates", async () => {
    const w = world();
    await program(w);
    const partnerId = await goldPartner(w);
    const admin = await portalUser(w, partnerId, "ada@contoso.example", ["portal_admin"]);
    await w.container.services.partner.suspend(w.ctx, partnerId, "Payment arrears");

    const decisions = await w.container.services.entitlement.resolveForUser(w.ctx, admin);
    assert.equal(decisions.every((d) => !d.granted), true);
    const facts = await w.container.services.entitlement.factsForUser(w.ctx, admin);
    assert.equal(facts.partnerStatus, "suspended");
    assert.deepEqual([...facts.activeContractTypes], ["reseller"]);
  });
});

describe("MDF eligibility reads the tier program", () => {
  it("caps a single request at the tier's share of the allocation", async () => {
    const w = world();
    await program(w);
    const partnerId = await goldPartner(w);
    const budget = await w.container.services.mdfBudget.create(w.ctx, {
      code: "MDF-FY26-Q1",
      name: "Q1 fund",
      period: "FY26-Q1",
      total: usd(100_000),
    });
    await w.container.services.mdfBudget.open(w.ctx, budget.id);
    await w.container.services.mdfBudget.allocate(w.ctx, budget.id, {
      partnerId,
      amount: usd(100_000),
    });

    const eligibility = await w.container.services.mdf.eligibility(w.ctx, partnerId);
    assert.equal(eligibility.eligible, true);
    // Gold caps a single request at 40% of the allocation.
    assert.equal(eligibility.requestCapBps, 4000);
    await expectRejects(
      w.container.services.mdf.createRequest(w.ctx, {
        partnerId,
        budgetId: budget.id,
        activityType: "event",
        title: "Flagship customer event",
        description: "A single event consuming most of the annual allocation.",
        activityStart: "2026-02-01T00:00:00.000Z" as never,
        activityEnd: "2026-02-02T00:00:00.000Z" as never,
        requestedAmount: usd(50_000),
      }),
      "INVALID_STATE",
      "may not exceed",
    );
  });
});
