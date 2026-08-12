import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SrmEventTypes } from "../src/domain/events.js";
import { activate, activeSupplier, expectRejects, tradingSupplier, world } from "./helpers.js";

describe("supplier registration", () => {
  it("normalises the code and starts as a prospect with a risk profile", async () => {
    const w = world();
    const supplier = await w.container.services.supplier.register(w.ctx, {
      code: " acme-parts ",
      legalName: "Acme Parts GmbH",
      countryCode: "de",
    });
    assert.equal(supplier.code, "ACME-PARTS");
    assert.equal(supplier.countryCode, "DE");
    assert.equal(supplier.status, "prospect");
    assert.equal(supplier.defaultCurrency, "USD", "defaults when the caller does not say");
    assert.equal(supplier.paymentTerms.netDays, 30);

    // The register-time risk profile is what later holds attach to.
    const profile = await w.container.repos.riskProfiles.bySupplier(w.ctx.tenantId, supplier.id);
    assert.ok(profile, "a risk profile exists from day one");
    assert.equal(profile.tier, "low");
  });

  it("refuses a duplicate code within the tenant but not across tenants", async () => {
    const w = world();
    await w.container.services.supplier.register(w.ctx, {
      code: "DUP",
      legalName: "First",
      countryCode: "US",
    });
    await expectRejects(
      w.container.services.supplier.register(w.ctx, {
        code: "dup",
        legalName: "Second",
        countryCode: "US",
      }),
      "CONFLICT",
      "already registered",
    );

    const other = world("other-tenant");
    const elsewhere = await other.container.services.supplier.register(other.ctx, {
      code: "DUP",
      legalName: "Same code, different tenant",
      countryCode: "US",
    });
    assert.equal(elsewhere.code, "DUP");
  });

  it("validates the code shape and the country", async () => {
    const w = world();
    await expectRejects(
      w.container.services.supplier.register(w.ctx, { code: "x", legalName: "Too short", countryCode: "US" }),
      "VALIDATION",
      "code",
    );
    await expectRejects(
      w.container.services.supplier.register(w.ctx, { code: "OK-CODE", legalName: "Bad country", countryCode: "USA" }),
      "VALIDATION",
      "countryCode",
    );
  });
});

describe("supplier lifecycle", () => {
  it("blocks activation until the master data finance and logistics need is there", async () => {
    const w = world();
    const { services } = w.container;
    const supplier = await services.supplier.register(w.ctx, {
      code: "BARE",
      legalName: "Bare Bones Ltd",
      countryCode: "GB",
    });
    await services.onboarding.start(w.ctx, { supplierId: supplier.id, templateCode: "indirect-low-risk" });
    await expectRejects(services.supplier.activate(w.ctx, supplier.id), "INVALID_STATE", "a primary site");

    await services.supplier.addSite(w.ctx, supplier.id, {
      code: "BARE-HQ",
      name: "Head office",
      type: "headquarters",
      address: { line1: "1 High Street", city: "London", countryCode: "GB" },
    });
    await expectRejects(services.supplier.activate(w.ctx, supplier.id), "INVALID_STATE", "a primary contact");

    await services.supplier.addContact(w.ctx, supplier.id, {
      name: "Jo Smith",
      email: "jo@bare.example",
      role: "primary",
    });
    await expectRejects(services.supplier.activate(w.ctx, supplier.id), "INVALID_STATE", "a tax id");

    await services.supplier.updateProfile(w.ctx, supplier.id, { taxId: "GB123456789" });
    const active = await services.supplier.activate(w.ctx, supplier.id);
    assert.equal(active.status, "active");
    assert.equal(active.toJSON().activatedOn, w.today);
  });

  it("enforces the status machine rather than allowing any jump", async () => {
    const w = world();
    const { services } = w.container;
    const supplier = await activeSupplier(w);

    // active -> reinstate is meaningless; only a suspended supplier reinstates.
    await expectRejects(services.supplier.reinstate(w.ctx, supplier.id), "INVALID_STATE", "only suspended");

    await services.supplier.suspend(w.ctx, supplier.id, "Quality escape under investigation");
    await expectRejects(services.supplier.suspend(w.ctx, supplier.id, "again"), "INVALID_STATE", "already suspended");
    const reinstated = await services.supplier.reinstate(w.ctx, supplier.id, "Root cause closed");
    assert.equal(reinstated.status, "active");
  });

  it("blocking places a sourcing hold that unblocking lifts, landing in suspended", async () => {
    const w = world();
    const { services } = w.container;
    const supplier = await activeSupplier(w);

    await services.supplier.block(w.ctx, supplier.id, "Sanctions list match on the parent group");
    const held = await services.risk.clearance(w.ctx, supplier.id, "sourcing");
    assert.equal(held.cleared, false);
    assert.equal(held.holds[0]?.reasonCode, "sanctions_match");
    assert.deepEqual(held.holds[0]?.releaseRoles, ["srm.compliance"]);

    // Blocked suppliers cannot be activated back into trading directly.
    await expectRejects(services.supplier.activate(w.ctx, supplier.id), "INVALID_STATE", "cannot move from blocked");

    const unblocked = await services.supplier.unblock(w.ctx, supplier.id, "False positive, screening re-run");
    assert.equal(unblocked.status, "suspended", "unblocking never restores trading rights directly");
    const cleared = await services.risk.clearance(w.ctx, supplier.id, "sourcing");
    assert.equal(cleared.cleared, true);
  });

  it("will not reinstate a supplier that still has a sourcing hold", async () => {
    const w = world();
    const { services } = w.container;
    const supplier = await activeSupplier(w);
    await services.supplier.suspend(w.ctx, supplier.id, "Awaiting ESG evidence");
    await services.risk.placeHold(w.ctx, supplier.id, {
      type: "sourcing",
      reasonCode: "esg_violation",
      note: "Forced-labour allegation in the supply chain",
    });
    await expectRejects(
      services.supplier.reinstate(w.ctx, supplier.id),
      "COMPLIANCE_BLOCKED",
      "sourcing hold is active",
    );
  });

  it("reserves the strategic classification for active suppliers", async () => {
    const w = world();
    const { services } = w.container;
    const supplier = await tradingSupplier(w);
    await expectRejects(
      services.supplier.classify(w.ctx, supplier.id, "strategic"),
      "INVALID_STATE",
      "only active suppliers can be strategic",
    );
    await activate(w, supplier.id);
    const classified = await services.supplier.classify(w.ctx, supplier.id, "strategic", "Sole source of the housing");
    assert.equal(classified.classification, "strategic");
  });
});

describe("sites and contacts", () => {
  it("keeps exactly one primary site and moves it on demand", async () => {
    const w = world();
    const { services } = w.container;
    const supplier = await tradingSupplier(w);
    const second = await services.supplier.addSite(w.ctx, supplier.id, {
      code: "ACME-W1",
      name: "Regional warehouse",
      type: "warehouse",
      address: { line1: "9 Logistikweg", city: "Hamburg", countryCode: "DE" },
    });
    assert.equal(second.isPrimary, false, "the first site keeps primary until told otherwise");

    const moved = await services.supplier.setPrimarySite(w.ctx, supplier.id, second.id);
    assert.equal(moved.sites.filter((site) => site.isPrimary).length, 1);
    assert.equal(moved.primarySite()?.code, "ACME-W1");
  });

  it("will not deactivate the last operational site out from under a live supplier", async () => {
    const w = world();
    const { services } = w.container;
    const supplier = await activeSupplier(w);
    const plant = supplier.sites[0]!;
    await expectRejects(
      services.supplier.deactivateSite(w.ctx, supplier.id, plant.id, "Plant closure"),
      "INVALID_STATE",
      "last active site",
    );

    // Suspending the supplier makes the closure legitimate again.
    await services.supplier.suspend(w.ctx, supplier.id, "Plant closure announced");
    const closed = await services.supplier.deactivateSite(w.ctx, supplier.id, plant.id, "Plant closure");
    assert.equal(closed.activeSites().length, 0);
  });

  it("treats only shipping-capable site types as operational", async () => {
    const w = world();
    const { services } = w.container;
    const supplier = await services.supplier.register(w.ctx, {
      code: "OFFICE-ONLY",
      legalName: "Office Only SARL",
      countryCode: "FR",
      taxId: "FR123",
    });
    await services.supplier.addSite(w.ctx, supplier.id, {
      code: "OO-HQ",
      name: "Paris office",
      type: "headquarters",
      address: { line1: "1 Rue de Rivoli", city: "Paris", countryCode: "FR" },
    });
    const loaded = await services.supplier.get(w.ctx, supplier.id);
    assert.equal(loaded.activeSites().length, 1);
    assert.equal(loaded.operationalSites().length, 0, "a headquarters cannot ship goods");
  });

  it("keeps one active holder per contact role and rejects duplicate emails", async () => {
    const w = world();
    const { services } = w.container;
    const supplier = await tradingSupplier(w);
    const outgoing = supplier.contactFor("primary")!;

    // A second primary contact replaces the first rather than doubling up.
    await services.supplier.addContact(w.ctx, supplier.id, {
      name: "Second Primary",
      email: "second@acme-parts.example",
      role: "primary",
    });
    const reloaded = await services.supplier.get(w.ctx, supplier.id);
    assert.equal(reloaded.contacts.filter((c) => c.isActive && c.role === "primary").length, 1);
    assert.equal(reloaded.contactById(outgoing.id)?.isActive, false);
    assert.equal(reloaded.contactFor("primary")?.name, "Second Primary");

    await expectRejects(
      services.supplier.addContact(w.ctx, supplier.id, {
        name: "Duplicate address",
        email: "second@acme-parts.example",
        role: "finance",
      }),
      "INVALID_STATE",
      "already exists",
    );

    const quality = await services.supplier.addContact(w.ctx, supplier.id, {
      name: "Q. Inspector",
      email: "QUALITY@Acme-Parts.example",
      role: "quality",
    });
    assert.equal(quality.email, "quality@acme-parts.example", "emails are normalised");
  });

  it("falls back to the primary contact when a role is not staffed", async () => {
    const w = world();
    const supplier = await tradingSupplier(w);
    assert.equal(supplier.contactFor("logistics")?.role, "primary");
  });
});

describe("banking and diversity", () => {
  it("masks the account number and gates payability on verification", async () => {
    const w = world();
    const { services } = w.container;
    const supplier = await activeSupplier(w);
    await services.supplier.addBankAccount(w.ctx, supplier.id, {
      label: "Operating account",
      bankName: "Deutsche Bank",
      countryCode: "DE",
      currency: "EUR",
      accountNumber: "DE89370400440532013000",
    });
    const withAccount = await services.supplier.get(w.ctx, supplier.id);
    const account = withAccount.bankAccounts[0]!;
    assert.equal(account.maskedNumber, "****3000");
    assert.equal(account.status, "unverified");
    assert.equal(withAccount.isPayable(), false, "money never moves to an unverified account");

    await services.supplier.verifyBankAccount(w.ctx, supplier.id, account.id);
    const verified = await services.supplier.get(w.ctx, supplier.id);
    assert.equal(verified.isPayable(), true);
    assert.equal(verified.primaryBankAccount()?.id, account.id);
  });

  it("keeps a diversity declaration unverified until the certificate backs it", async () => {
    const w = world();
    const { services } = w.container;
    const supplier = await tradingSupplier(w);
    await services.supplier.declareDiversity(w.ctx, supplier.id, "women_owned");
    const declared = await services.supplier.get(w.ctx, supplier.id);
    assert.equal(declared.diversity[0]?.verified, false);
    assert.deepEqual(declared.verifiedDiversityFlags(), []);

    const certification = await services.qualification.recordCertification(w.ctx, {
      supplierId: supplier.id,
      type: "women_owned_cert",
      issuer: "WBENC",
      certificateNumber: "WBENC-2026-4411",
      issuedOn: w.today,
      expiresOn: "2027-01-01" as never,
    });
    await services.qualification.verifyCertification(w.ctx, certification.id);

    const verified = await services.supplier.get(w.ctx, supplier.id);
    assert.deepEqual(verified.verifiedDiversityFlags(), ["women_owned"]);
    assert.equal(verified.diversity[0]?.certificationId, certification.id);
  });
});

describe("supplier events", () => {
  it("emits a change trail the rest of the suite can subscribe to", async () => {
    const w = world();
    const { services } = w.container;
    const supplier = await activeSupplier(w);
    await services.supplier.suspend(w.ctx, supplier.id, "Audit finding");

    const types = w.container.outbox.entries(w.ctx.tenantId).map((event) => event.eventType);
    assert.ok(types.includes(SrmEventTypes.SupplierRegistered));
    assert.ok(types.includes(SrmEventTypes.SupplierSiteAdded));

    const statusEvents = w.container.outbox
      .entries(w.ctx.tenantId)
      .filter((event) => event.eventType === SrmEventTypes.SupplierStatusChanged);
    assert.deepEqual(
      statusEvents.map((event) => (event.payload as { to: string }).to),
      ["onboarding", "active", "suspended"],
      "every hop of the lifecycle is on the wire, including the onboarding gate",
    );
  });

  it("scopes the outbox to the tenant that produced the event", async () => {
    const w = world("tenant-a");
    const other = world("tenant-b");
    await tradingSupplier(w, "A-SUPPLIER");
    await tradingSupplier(other, "B-SUPPLIER");
    assert.equal(other.container.outbox.entries(w.ctx.tenantId).length, 0);
  });
});
