import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { money, type IsoDateTime } from "@enterprise-suite/shared-kernel";
import { DAY_MS, activeContract, approvedPartner, expectRejects, usd, world } from "./helpers.js";

function plusDays(from: string, days: number): IsoDateTime {
  return new Date(Date.parse(from) + days * DAY_MS).toISOString() as IsoDateTime;
}

describe("contract drafting and signature", () => {
  it("numbers contracts and refuses to send an empty commercial deal for signature", async () => {
    const w = world();
    const partner = await approvedPartner(w);
    const drafted = await w.container.services.contract.draft(w.ctx, {
      partnerId: partner.id,
      type: "reseller",
      currency: "USD",
      effectiveFrom: w.clock.now(),
      effectiveTo: plusDays(w.clock.now(), 365),
    });
    assert.equal(drafted.number, "PCT-00001");
    assert.equal(drafted.status, "draft");
    await expectRejects(
      w.container.services.contract.sendForSignature(w.ctx, drafted.id),
      "VALIDATION",
      "need a discount or a schedule",
    );
    await w.container.services.contract.addDiscountLine(w.ctx, drafted.id, {
      scope: "*",
      discountBps: 1500,
    });
    const sent = await w.container.services.contract.sendForSignature(w.ctx, drafted.id);
    assert.equal(sent.status, "pending_signature");
  });

  it("keeps the two signatures apart and only then activates", async () => {
    const w = world();
    const partner = await approvedPartner(w);
    const drafted = await w.container.services.contract.draft(w.ctx, {
      partnerId: partner.id,
      type: "reseller",
      currency: "USD",
      effectiveFrom: w.clock.now(),
      effectiveTo: plusDays(w.clock.now(), 365),
      baseDiscountBps: 1500,
    });
    await w.container.services.contract.sendForSignature(w.ctx, drafted.id);
    await w.container.services.contract.sign(w.ctx, drafted.id, {
      party: "partner",
      signatoryName: "Ada Nkemelu",
      signatoryEmail: "Ada@Contoso.example",
    });
    // One signature is not enough to go live.
    await expectRejects(
      w.container.services.contract.activate(w.ctx, drafted.id),
      "INVALID_STATE",
      "needs both signatures",
    );
    await expectRejects(
      w.container.services.contract.sign(w.ctx, drafted.id, {
        party: "partner",
        signatoryName: "Ada Again",
        signatoryEmail: "ada2@contoso.example",
      }),
      "INVALID_STATE",
      "already signed",
    );
    // The same mailbox cannot represent both sides.
    await expectRejects(
      w.container.services.contract.sign(w.ctx, drafted.id, {
        party: "vendor",
        signatoryName: "Ada Nkemelu",
        signatoryEmail: "ada@contoso.example",
      }),
      "SEGREGATION_OF_DUTIES",
    );
    await w.container.services.contract.sign(w.ctx, drafted.id, {
      party: "vendor",
      signatoryName: "Vendor Chief",
      signatoryEmail: "chief@vendor.example",
    });
    const active = await w.container.services.contract.activate(w.ctx, drafted.id);
    assert.equal(active.status, "active");
    assert.ok(active.isEffectiveAt(w.clock.now()));
  });

  it("allows only one effective trading contract per partner", async () => {
    const w = world();
    const partner = await approvedPartner(w);
    await activeContract(w, partner.id);
    const second = await w.container.services.contract.draft(w.ctx, {
      partnerId: partner.id,
      type: "distribution",
      currency: "USD",
      effectiveFrom: w.clock.now(),
      effectiveTo: plusDays(w.clock.now(), 365),
      baseDiscountBps: 2000,
    });
    await w.container.services.contract.sendForSignature(w.ctx, second.id);
    await w.container.services.contract.sign(w.ctx, second.id, {
      party: "partner",
      signatoryName: "Ada Nkemelu",
      signatoryEmail: "ada@contoso.example",
    });
    await w.container.services.contract.sign(w.ctx, second.id, {
      party: "vendor",
      signatoryName: "Vendor Chief",
      signatoryEmail: "chief@vendor.example",
    });
    await expectRejects(w.container.services.contract.activate(w.ctx, second.id), "CONFLICT");

    // An NDA is not a trading contract, so it can run alongside.
    const nda = await w.container.services.contract.draft(w.ctx, {
      partnerId: partner.id,
      type: "nda",
      currency: "USD",
      effectiveFrom: w.clock.now(),
      effectiveTo: plusDays(w.clock.now(), 365),
    });
    await w.container.services.contract.sendForSignature(w.ctx, nda.id);
    await w.container.services.contract.sign(w.ctx, nda.id, {
      party: "partner",
      signatoryName: "Ada Nkemelu",
      signatoryEmail: "ada@contoso.example",
    });
    await w.container.services.contract.sign(w.ctx, nda.id, {
      party: "vendor",
      signatoryName: "Vendor Counsel",
      signatoryEmail: "legal@vendor.example",
    });
    assert.equal((await w.container.services.contract.activate(w.ctx, nda.id)).status, "active");
    const types = await w.container.services.contract.activeTypesForPartner(w.ctx, partner.id);
    assert.deepEqual([...types].sort(), ["nda", "reseller"]);
  });
});

describe("contract discounts and obligations", () => {
  it("resolves the most specific discount line", async () => {
    const w = world();
    const partner = await approvedPartner(w);
    const drafted = await w.container.services.contract.draft(w.ctx, {
      partnerId: partner.id,
      type: "reseller",
      currency: "USD",
      effectiveFrom: w.clock.now(),
      effectiveTo: plusDays(w.clock.now(), 365),
      baseDiscountBps: 1000,
    });
    await w.container.services.contract.addDiscountLine(w.ctx, drafted.id, {
      scope: "*",
      discountBps: 1500,
    });
    const analytics = await w.container.services.contract.addDiscountLine(w.ctx, drafted.id, {
      scope: "Analytics-Suite",
      discountBps: 2200,
      minAnnualVolume: usd(50_000),
    });
    const contract = await w.container.services.contract.get(w.ctx, drafted.id);
    assert.equal(contract.effectiveDiscountBps("analytics-suite"), 2200);
    assert.equal(contract.effectiveDiscountBps("hardware"), 1500);

    await expectRejects(
      w.container.services.contract.addDiscountLine(w.ctx, drafted.id, {
        scope: "analytics-suite",
        discountBps: 1000,
      }),
      "INVALID_STATE",
      "already on contract",
    );
    await expectRejects(
      w.container.services.contract.addDiscountLine(w.ctx, drafted.id, {
        scope: "eur-only",
        discountBps: 1000,
        minAnnualVolume: money(100, "EUR"),
      }),
      "VALIDATION",
      "must match the contract currency",
    );

    const removed = await w.container.services.contract.removeDiscountLine(w.ctx, drafted.id, analytics.id);
    assert.equal(removed.effectiveDiscountBps("analytics-suite"), 1500);
  });

  it("blocks renewal while obligations are open and flags breaches", async () => {
    const w = world();
    const partner = await approvedPartner(w);
    const contractId = await activeContract(w, partner.id, { autoRenew: true, renewalTermMonths: 12 });
    await w.container.services.contract.addObligation(w.ctx, contractId, {
      code: "quarterly-forecast",
      description: "Submit a rolling 90-day forecast",
      dueAt: plusDays(w.clock.now(), 90),
    });
    await expectRejects(
      w.container.services.contract.renew(w.ctx, contractId),
      "INVALID_STATE",
      "unmet obligations",
    );
    await expectRejects(
      w.container.services.contract.recordObligation(w.ctx, contractId, {
        code: "quarterly-forecast",
        status: "met",
      }),
      "VALIDATION",
      "evidence is required",
    );
    await w.container.services.contract.recordObligation(w.ctx, contractId, {
      code: "quarterly-forecast",
      status: "met",
      evidence: "forecast-2026-q1.xlsx",
    });
    const renewed = await w.container.services.contract.renew(w.ctx, contractId);
    assert.equal(renewed.renewalCount, 1);

    await w.container.services.contract.addObligation(w.ctx, contractId, {
      code: "certified-engineers",
      description: "Keep two certified engineers on staff",
    });
    await w.container.services.contract.recordObligation(w.ctx, contractId, {
      code: "certified-engineers",
      status: "breached",
      evidence: "0 certified engineers at audit",
    });
    const events = w.container.outbox.entries(w.ctx.tenantId).map((e) => e.eventType);
    assert.ok(events.includes("prm.contract.breach-flagged"));
  });
});

describe("contract term management", () => {
  it("amends an active contract with a numbered audit trail", async () => {
    const w = world();
    const partner = await approvedPartner(w);
    const contractId = await activeContract(w, partner.id);
    const amendment = await w.container.services.contract.amend(w.ctx, contractId, {
      summary: "Uplift for the analytics practice",
      effectiveFrom: plusDays(w.clock.now(), 30),
      baseDiscountBps: 1800,
    });
    assert.equal(amendment.sequence, 1);
    assert.equal(amendment.previousBaseDiscountBps, 1500);
    const contract = await w.container.services.contract.get(w.ctx, contractId);
    assert.equal(contract.baseDiscountBps, 1800);
    // A no-op amendment is refused: paperwork has to change something.
    await expectRejects(
      w.container.services.contract.amend(w.ctx, contractId, {
        summary: "No change",
        effectiveFrom: plusDays(w.clock.now(), 60),
        baseDiscountBps: 1800,
      }),
      "VALIDATION",
      "must change the discount or the term",
    );
    // Draft-only edits are refused on an active contract.
    await expectRejects(
      w.container.services.contract.updateTerms(w.ctx, contractId, { baseDiscountBps: 2000 }),
      "INVALID_STATE",
      "use an amendment",
    );
  });

  it("sweeps the term end: auto-renew rolls forward, the rest expires", async () => {
    const w = world();
    const rolling = await approvedPartner(w, { legalName: "Rolling Reseller Ltd" });
    const lapsing = await approvedPartner(w, { legalName: "Lapsing Reseller Ltd" });
    const rollingId = await activeContract(w, rolling.id, {
      autoRenew: true,
      renewalTermMonths: 12,
      effectiveTo: plusDays(w.clock.now(), 30),
    });
    const lapsingId = await activeContract(w, lapsing.id, {
      autoRenew: false,
      effectiveTo: plusDays(w.clock.now(), 30),
    });

    const early = await w.container.services.contract.sweepExpiries(w.ctx);
    assert.deepEqual(early, { renewed: [], expired: [] });

    w.clock.advanceDays(31);
    const swept = await w.container.services.contract.sweepExpiries(w.ctx);
    assert.deepEqual(swept.renewed, ["PCT-00001"]);
    assert.deepEqual(swept.expired, ["PCT-00002"]);
    assert.equal((await w.container.services.contract.get(w.ctx, rollingId)).status, "active");
    assert.equal((await w.container.services.contract.get(w.ctx, lapsingId)).status, "expired");
  });

  it("cancels drafts and terminates live contracts", async () => {
    const w = world();
    const partner = await approvedPartner(w);
    const draft = await w.container.services.contract.draft(w.ctx, {
      partnerId: partner.id,
      type: "mdf_terms",
      currency: "USD",
      effectiveFrom: w.clock.now(),
      effectiveTo: plusDays(w.clock.now(), 365),
    });
    const cancelled = await w.container.services.contract.cancel(w.ctx, draft.id, "Superseded");
    assert.equal(cancelled.status, "cancelled");
    await expectRejects(
      w.container.services.contract.terminate(w.ctx, draft.id, "Too late"),
      "INVALID_STATE",
      "cannot be terminated",
    );

    const liveId = await activeContract(w, partner.id);
    const terminated = await w.container.services.contract.terminate(w.ctx, liveId, "Breach of terms");
    assert.equal(terminated.status, "terminated");
    assert.equal(terminated.terminationReason, "Breach of terms");
    assert.equal((await w.container.services.contract.effectiveForPartner(w.ctx, partner.id)).length, 0);
  });
});
