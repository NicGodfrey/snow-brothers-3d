import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { approvedPartner, activeContract, eventTypes, expectRejects, usd, world } from "./helpers.js";

describe("partner onboarding", () => {
  it("mints sequential numbers and starts as a prospect", async () => {
    const w = world();
    const first = await w.container.services.partner.register(w.ctx, {
      legalName: "Northwind Distribution GmbH",
      type: "distributor",
      countryCode: "DE",
      territories: ["DE", "AT"],
    });
    const second = await w.container.services.partner.register(w.ctx, {
      legalName: "Contoso Solutions Ltd",
      type: "reseller",
      countryCode: "GB",
    });
    assert.equal(first.number, "PRT-00001");
    assert.equal(second.number, "PRT-00002");
    assert.equal(first.status, "prospect");
    assert.deepEqual([...first.territories], ["DE", "AT"]);
    assert.equal(first.displayName, "Northwind Distribution GmbH");
    assert.deepEqual(eventTypes(w), ["prm.partner.registered", "prm.partner.registered"]);
  });

  it("refuses a duplicate legal name in the same tenant", async () => {
    const w = world();
    await w.container.services.partner.register(w.ctx, {
      legalName: "Contoso Solutions Ltd",
      type: "reseller",
      countryCode: "GB",
    });
    await expectRejects(
      w.container.services.partner.register(w.ctx, {
        legalName: "  contoso solutions ltd  ",
        type: "var",
        countryCode: "IE",
      }),
      "CONFLICT",
    );
  });

  it("refuses to file an incomplete application", async () => {
    const w = world();
    const partner = await w.container.services.partner.register(w.ctx, {
      legalName: "Tailspin Referrals LLC",
      type: "referral",
      countryCode: "US",
    });
    await expectRejects(
      w.container.services.partner.submitApplication(w.ctx, partner.id),
      "VALIDATION",
      "a primary contact is required",
    );
    await w.container.services.partner.addContact(w.ctx, partner.id, {
      firstName: "Tom",
      lastName: "Rivera",
      email: "tom@tailspin.example",
      role: "primary",
    });
    await expectRejects(
      w.container.services.partner.submitApplication(w.ctx, partner.id),
      "VALIDATION",
      "a headquarters address is required",
    );
  });

  it("walks the onboarding state machine and rejects illegal jumps", async () => {
    const w = world();
    const partner = await approvedPartner(w);
    assert.equal(partner.status, "approved");
    // Activation needs a signed trading contract, not just approval.
    await expectRejects(
      w.container.services.partner.activate(w.ctx, partner.id),
      "INVALID_STATE",
      "no effective trading contract",
    );
    await activeContract(w, partner.id);
    const active = await w.container.services.partner.activate(w.ctx, partner.id);
    assert.equal(active.status, "active");
    assert.equal(active.activatedAt, w.clock.now());
    await expectRejects(
      w.container.services.partner.approve(w.ctx, partner.id),
      "INVALID_STATE",
      "Cannot move",
    );
  });

  it("suspends, reinstates and terminates with a recorded reason", async () => {
    const w = world();
    const partner = await approvedPartner(w);
    await activeContract(w, partner.id);
    await w.container.services.partner.activate(w.ctx, partner.id);

    await expectRejects(w.container.services.partner.suspend(w.ctx, partner.id, "  "), "VALIDATION");
    const suspended = await w.container.services.partner.suspend(w.ctx, partner.id, "Payment arrears");
    assert.equal(suspended.status, "suspended");
    const reinstated = await w.container.services.partner.reinstate(w.ctx, partner.id, "Arrears cleared");
    assert.equal(reinstated.status, "active");

    // A live contract blocks termination unless it is closed in the same call.
    await expectRejects(
      w.container.services.partner.terminate(w.ctx, partner.id, { reason: "Channel exit" }),
      "INVALID_STATE",
      "live contract",
    );
    const terminated = await w.container.services.partner.terminate(w.ctx, partner.id, {
      reason: "Channel exit",
      terminateContracts: true,
    });
    assert.equal(terminated.status, "terminated");
    // Termination drops the partner out of the tier program.
    assert.equal(terminated.tierCode, undefined);
    assert.equal(terminated.tierRank, 0);
    assert.ok(eventTypes(w).includes("prm.partner.terminated"));
  });

  it("keeps contact and address invariants inside the aggregate", async () => {
    const w = world();
    const partner = await approvedPartner(w);
    await expectRejects(
      w.container.services.partner.addContact(w.ctx, partner.id, {
        firstName: "Second",
        lastName: "Primary",
        email: "second@contoso.example",
        role: "primary",
      }),
      "INVALID_STATE",
      "already has a primary contact",
    );
    await expectRejects(
      w.container.services.partner.addAddress(w.ctx, partner.id, {
        kind: "headquarters",
        line1: "2 Other Way",
        city: "Reading",
        postalCode: "RG1 2BB",
        countryCode: "GB",
      }),
      "INVALID_STATE",
      "already has a headquarters",
    );

    const billing = await w.container.services.partner.addContact(w.ctx, partner.id, {
      firstName: "Bea",
      lastName: "Ling",
      email: "billing@contoso.example",
      role: "billing",
    });
    const promoted = await w.container.services.partner.promoteContact(w.ctx, partner.id, billing.id);
    assert.equal(promoted.primaryContact()?.email, "billing@contoso.example");
    assert.equal(
      promoted.contacts.find((c) => c.email === "ada@contoso.example")?.role,
      "executive",
    );
  });

  it("will not strip the last territory from an active partner", async () => {
    const w = world();
    const partner = await approvedPartner(w, { territories: ["GB"] });
    await activeContract(w, partner.id);
    await w.container.services.partner.activate(w.ctx, partner.id);
    await expectRejects(
      w.container.services.partner.removeTerritory(w.ctx, partner.id, "GB"),
      "INVALID_STATE",
      "at least one territory",
    );
    await w.container.services.partner.addTerritory(w.ctx, partner.id, "ie");
    const trimmed = await w.container.services.partner.removeTerritory(w.ctx, partner.id, "GB");
    assert.deepEqual([...trimmed.territories], ["IE"]);
    assert.ok(trimmed.coversTerritory("IE"));
  });

  it("links tier-2 partners to their distributor", async () => {
    const w = world();
    const distributor = await w.container.services.partner.register(w.ctx, {
      legalName: "Northwind Distribution GmbH",
      type: "distributor",
      countryCode: "DE",
    });
    const reseller = await w.container.services.partner.register(w.ctx, {
      legalName: "Contoso Solutions Ltd",
      type: "reseller",
      countryCode: "GB",
      parentPartnerId: distributor.id,
    });
    const hierarchy = await w.container.services.partner.hierarchy(w.ctx, distributor.id);
    assert.deepEqual(hierarchy.children.map((c) => c.id), [reseller.id]);
    assert.equal(hierarchy.parent, undefined);
    await expectRejects(
      w.container.services.partner.register(w.ctx, {
        legalName: "Second Distributor AG",
        type: "distributor",
        countryCode: "CH",
        parentPartnerId: distributor.id,
      }),
      "VALIDATION",
      "cannot sit under another partner",
    );
  });
});

describe("partner performance", () => {
  it("re-stating a period replaces the snapshot and rolls up trailing metrics", async () => {
    const w = world();
    const partner = await approvedPartner(w);
    await activeContract(w, partner.id);
    await w.container.services.partner.activate(w.ctx, partner.id);

    for (const [index, period] of ["FY25-Q1", "FY25-Q2", "FY25-Q3", "FY25-Q4"].entries()) {
      await w.container.services.partner.recordPerformance(w.ctx, partner.id, {
        period,
        bookedRevenue: usd(10_000 * (index + 1)),
        dealsRegistered: 10,
        dealsWon: 5,
        source: "sales_erp",
      });
    }
    // Restatement of Q4: same period, new numbers.
    await w.container.services.partner.recordPerformance(w.ctx, partner.id, {
      period: "FY25-Q4",
      bookedRevenue: usd(60_000),
      dealsRegistered: 12,
      dealsWon: 9,
      source: "manual",
    });

    const trailing = await w.container.services.partner.trailingPerformance(w.ctx, partner.id, 24);
    assert.equal(trailing.periods.length, 4);
    assert.equal(trailing.bookedRevenue.amountMinor, usd(10_000 + 20_000 + 30_000 + 60_000).amountMinor);
    assert.equal(trailing.dealsWon, 24);
    assert.equal(trailing.winRate, Math.round((24 / 42) * 100) / 100);
  });

  it("rejects more wins than registrations", async () => {
    const w = world();
    const partner = await approvedPartner(w);
    await expectRejects(
      w.container.services.partner.recordPerformance(w.ctx, partner.id, {
        period: "FY25-Q1",
        bookedRevenue: usd(1_000),
        dealsRegistered: 2,
        dealsWon: 5,
      }),
      "VALIDATION",
      "cannot exceed dealsRegistered",
    );
  });
});
