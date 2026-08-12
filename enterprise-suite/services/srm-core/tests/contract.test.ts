import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { money, type Ulid } from "@enterprise-suite/shared-kernel";
import type { DateOnly } from "../src/domain/dates.js";
import { SrmEventTypes } from "../src/domain/events.js";
import { deviationFromTarget, escalationFor, evaluateSla, severityFor } from "../src/domain/sla.js";
import { activeSupplier, expectRejects, world, type TestWorld } from "./helpers.js";

const OTD_COMMITMENT = {
  direction: "higher_better",
  target: 98,
  tolerance: 1,
  graceBreaches: 0,
  creditCapPercent: 10,
  penalty: { kind: "service_credit_percent", percent: 2 },
} as const;

async function draftFor(
  w: TestWorld,
  supplierId: Ulid,
  overrides: Partial<Parameters<TestWorld["container"]["services"]["contract"]["draft"]>[1]> = {},
) {
  return w.container.services.contract.draft(w.ctx, {
    supplierId,
    type: "framework",
    title: "Framework agreement",
    currency: "EUR",
    effectiveFrom: "2026-01-01" as DateOnly,
    effectiveTo: "2026-12-31" as DateOnly,
    noticeDays: 60,
    ...overrides,
  });
}

/** Draft, sign both sides and activate. */
async function activeContract(
  w: TestWorld,
  supplierId: Ulid,
  overrides: Parameters<typeof draftFor>[2] = {},
) {
  const { contract } = w.container.services;
  const drafted = await draftFor(w, supplierId, overrides);
  const supplierSide = await contract.addSignatory(w.ctx, drafted.id, { party: "supplier", name: "MD" });
  const buyerSide = await contract.addSignatory(w.ctx, drafted.id, { party: "buyer", name: "CPO" });
  await contract.sendForSignature(w.ctx, drafted.id);
  await contract.sign(w.ctx, drafted.id, supplierSide.id);
  await contract.sign(w.ctx, drafted.id, buyerSide.id);
  return contract.activate(w.ctx, drafted.id);
}

describe("SLA arithmetic", () => {
  it("only counts a miss in the direction that hurts", () => {
    assert.equal(deviationFromTarget("higher_better", 98, 94), 4);
    assert.equal(deviationFromTarget("higher_better", 98, 99), 0, "beating the target is not a deviation");
    assert.equal(deviationFromTarget("lower_better", 500, 900), 400);
    assert.equal(deviationFromTarget("lower_better", 500, 400), 0);
  });

  it("grades severity by how many tolerance bands were missed", () => {
    assert.equal(severityFor(2, 1), "minor");
    assert.equal(severityFor(3, 1), "major");
    assert.equal(severityFor(5, 1), "severe");
    assert.equal(severityFor(1.5, 0), "minor", "without a band, grade against the miss itself");
  });

  it("keeps a measurement inside the tolerance out of the breach log", () => {
    const evaluation = evaluateSla(OTD_COMMITMENT, 97.5);
    assert.equal(evaluation.breached, false);
    assert.equal(evaluation.deviation, 0.5);
    assert.equal(evaluation.credit, undefined);
  });

  it("scales the credit by severity and caps it at the negotiated liability", () => {
    const spend = money(1_000_000, "EUR");
    const minor = evaluateSla(OTD_COMMITMENT, 96, { periodSpend: spend });
    assert.equal(minor.severity, "minor");
    assert.equal(minor.credit?.amountMinor, 20_000, "2% of spend at the minor multiplier");

    const major = evaluateSla(OTD_COMMITMENT, 94, { periodSpend: spend });
    assert.equal(major.severity, "major");
    assert.equal(major.credit?.amountMinor, 40_000);

    const severe = evaluateSla(OTD_COMMITMENT, 88, { periodSpend: spend });
    assert.equal(severe.severity, "severe");
    assert.equal(severe.credit?.amountMinor, 60_000, "3 x 2% is inside the 10% cap");

    const uncapped = evaluateSla({ ...OTD_COMMITMENT, creditCapPercent: 5 }, 88, { periodSpend: spend });
    assert.equal(uncapped.credit?.amountMinor, 50_000, "the cap bites before the multiplier does");
  });

  it("records a breach without a credit while the grace allowance lasts", () => {
    const commitment = { ...OTD_COMMITMENT, graceBreaches: 2 };
    const spend = money(1_000_000, "EUR");
    const first = evaluateSla(commitment, 94, { periodSpend: spend, priorBreaches: 0 });
    assert.equal(first.breached, true);
    assert.equal(first.credit, undefined);
    const third = evaluateSla(commitment, 94, { periodSpend: spend, priorBreaches: 2 });
    assert.equal(third.credit?.amountMinor, 40_000, "the allowance is used up on the third miss");
  });

  it("picks the highest escalation level the breach count has reached", () => {
    const levels = [
      { afterBreaches: 2, action: "Escalate to the supply-chain director" },
      { afterBreaches: 4, action: "Formal cure notice" },
    ];
    assert.equal(escalationFor(levels, 1), undefined);
    assert.equal(escalationFor(levels, 3)?.action, "Escalate to the supply-chain director");
    assert.equal(escalationFor(levels, 5)?.action, "Formal cure notice");
  });
});

describe("contract lifecycle", () => {
  it("numbers contracts and defaults the commercial terms from the supplier", async () => {
    const w = world();
    const supplier = await activeSupplier(w);
    const drafted = await w.container.services.contract.draft(w.ctx, {
      supplierId: supplier.id,
      type: "msa",
      title: "Master agreement",
    });
    assert.equal(drafted.number, "CTR-00001");
    assert.equal(drafted.currency, "EUR", "the supplier's default currency carries over");
    assert.equal(drafted.status, "draft");
  });

  it("needs a start date and both parties before it goes out for signature", async () => {
    const w = world();
    const supplier = await activeSupplier(w);
    const { contract } = w.container.services;
    const open = await contract.draft(w.ctx, { supplierId: supplier.id, type: "nda", title: "NDA" });
    await expectRejects(contract.sendForSignature(w.ctx, open.id), "INVALID_STATE", "effective start date");

    const drafted = await draftFor(w, supplier.id, { type: "nda", title: "NDA" });
    await contract.addSignatory(w.ctx, drafted.id, { party: "supplier", name: "MD" });
    await expectRejects(contract.sendForSignature(w.ctx, drafted.id), "INVALID_STATE", "signatory on both sides");
  });

  it("refuses to execute a contract with a supplier that cannot trade", async () => {
    const w = world();
    const supplier = await activeSupplier(w);
    const { contract } = w.container.services;
    const drafted = await draftFor(w, supplier.id);
    await contract.addSignatory(w.ctx, drafted.id, { party: "supplier", name: "MD" });
    await contract.addSignatory(w.ctx, drafted.id, { party: "buyer", name: "CPO" });
    await w.container.services.supplier.block(w.ctx, supplier.id, "Sanctions screening hit");
    await expectRejects(contract.sendForSignature(w.ctx, drafted.id), "INVALID_STATE", "contracts cannot be executed");
  });

  it("activates only once every signatory has signed", async () => {
    const w = world();
    const supplier = await activeSupplier(w);
    const { contract } = w.container.services;
    const drafted = await draftFor(w, supplier.id);
    const supplierSide = await contract.addSignatory(w.ctx, drafted.id, { party: "supplier", name: "MD" });
    const buyerSide = await contract.addSignatory(w.ctx, drafted.id, { party: "buyer", name: "CPO" });
    await contract.sendForSignature(w.ctx, drafted.id);
    await contract.sign(w.ctx, drafted.id, supplierSide.id);
    await expectRejects(contract.activate(w.ctx, drafted.id), "INVALID_STATE", "every party must sign");
    await expectRejects(contract.sign(w.ctx, drafted.id, supplierSide.id), "INVALID_STATE", "already signed");
    await contract.sign(w.ctx, drafted.id, buyerSide.id);
    assert.equal((await contract.activate(w.ctx, drafted.id)).status, "active");
  });

  it("enforces the notice period unless it is explicitly waived", async () => {
    const w = world();
    const supplier = await activeSupplier(w);
    const { contract } = w.container.services;
    const active = await activeContract(w, supplier.id);
    await expectRejects(
      contract.terminate(w.ctx, active.id, { reason: "Repeated quality escapes", terminationDate: "2026-02-01" as DateOnly }),
      "INVALID_STATE",
      "60 days' notice",
    );
    const terminated = await contract.terminate(w.ctx, active.id, {
      reason: "Repeated quality escapes",
      terminationDate: "2026-02-01" as DateOnly,
      waiveNotice: true,
    });
    assert.equal(terminated.status, "terminated");
    assert.equal(terminated.termination?.noticeWaived, true);
    assert.equal(terminated.effectiveTo, "2026-02-01", "the term ends on the termination date, not later");
  });

  it("records a revision trail rather than silently mutating a live contract", async () => {
    const w = world();
    const supplier = await activeSupplier(w);
    const { contract } = w.container.services;
    const active = await activeContract(w, supplier.id);
    const amendment = await contract.amend(w.ctx, active.id, "Term extended for the 2027 programme", {
      effectiveTo: "2027-12-31" as DateOnly,
      autoRenew: true,
    });
    assert.equal(amendment.revision, 2, "the executed contract is revision 1");
    const amended = await contract.get(w.ctx, active.id);
    assert.equal(amended.effectiveTo, "2027-12-31");
    assert.equal(amended.autoRenew, true);
    await expectRejects(
      contract.amend(w.ctx, active.id, "Backwards window", { effectiveTo: "2025-01-01" as DateOnly }),
      "VALIDATION",
    );
  });

  it("links a superseded contract to its replacement", async () => {
    const w = world();
    const supplier = await activeSupplier(w);
    const { contract } = w.container.services;
    const old = await activeContract(w, supplier.id);
    const replacement = await activeContract(w, supplier.id, { title: "Framework agreement 2027" });
    const superseded = await contract.supersede(w.ctx, old.id, replacement.id);
    assert.equal(superseded.status, "superseded");

    const otherSupplier = await activeSupplier(w, "OTHER-CO");
    const foreign = await activeContract(w, otherSupplier.id);
    await expectRejects(
      contract.supersede(w.ctx, replacement.id, foreign.id),
      "INVALID_STATE",
      "different supplier",
    );
  });
});

describe("contract pricing", () => {
  it("resolves the tightest quantity break valid on the day", async () => {
    const w = world();
    const supplier = await activeSupplier(w);
    const { contract } = w.container.services;
    const active = await activeContract(w, supplier.id);
    for (const [minQuantity, unitPriceMinor] of [
      [1, 1250],
      [100, 1100],
      [1000, 950],
    ] as const) {
      await contract.addPriceLine(w.ctx, active.id, {
        itemCode: "brk-100",
        description: "Bracket, 100mm",
        uom: "ea",
        unitPriceMinor,
        minQuantity,
        validFrom: "2026-01-01" as DateOnly,
      });
    }
    const small = await contract.quote(w.ctx, supplier.id, { itemCode: "BRK-100", quantity: 50 });
    assert.equal(small?.unitPrice.amountMinor, 1250);
    const medium = await contract.quote(w.ctx, supplier.id, { itemCode: "BRK-100", quantity: 500 });
    assert.equal(medium?.unitPrice.amountMinor, 1100);
    const bulk = await contract.quote(w.ctx, supplier.id, { itemCode: "BRK-100", quantity: 2000 });
    assert.equal(bulk?.unitPrice.amountMinor, 950);
    assert.equal(bulk?.extendedPrice.amountMinor, 1_900_000);
  });

  it("rejects an overlapping tier so resolution is never ambiguous", async () => {
    const w = world();
    const supplier = await activeSupplier(w);
    const { contract } = w.container.services;
    const active = await activeContract(w, supplier.id);
    await contract.addPriceLine(w.ctx, active.id, {
      itemCode: "brk-100",
      description: "Bracket",
      uom: "ea",
      unitPriceMinor: 1250,
      minQuantity: 100,
      validFrom: "2026-01-01" as DateOnly,
      validTo: "2026-06-30" as DateOnly,
    });
    await expectRejects(
      contract.addPriceLine(w.ctx, active.id, {
        itemCode: "brk-100",
        description: "Bracket, renegotiated",
        uom: "ea",
        unitPriceMinor: 1150,
        minQuantity: 100,
        validFrom: "2026-06-01" as DateOnly,
      }),
      "INVALID_STATE",
      "already covers",
    );
    // Starting after the current window closes is fine.
    await contract.addPriceLine(w.ctx, active.id, {
      itemCode: "brk-100",
      description: "Bracket, renegotiated",
      uom: "ea",
      unitPriceMinor: 1150,
      minQuantity: 100,
      validFrom: "2026-07-01" as DateOnly,
    });
    const before = await contract.quote(w.ctx, supplier.id, {
      itemCode: "BRK-100",
      quantity: 200,
      asOf: "2026-03-01" as DateOnly,
    });
    const after = await contract.quote(w.ctx, supplier.id, {
      itemCode: "BRK-100",
      quantity: 200,
      asOf: "2026-08-01" as DateOnly,
    });
    assert.equal(before?.unitPrice.amountMinor, 1250);
    assert.equal(after?.unitPrice.amountMinor, 1150);
  });

  it("quotes the cheapest contract when several cover the same item", async () => {
    const w = world();
    const supplier = await activeSupplier(w);
    const { contract } = w.container.services;
    const framework = await activeContract(w, supplier.id);
    const spot = await activeContract(w, supplier.id, { title: "Spot buy agreement" });
    await contract.addPriceLine(w.ctx, framework.id, {
      itemCode: "brk-100",
      description: "Bracket",
      uom: "ea",
      unitPriceMinor: 1250,
      validFrom: "2026-01-01" as DateOnly,
    });
    await contract.addPriceLine(w.ctx, spot.id, {
      itemCode: "brk-100",
      description: "Bracket, promotional",
      uom: "ea",
      unitPriceMinor: 1180,
      validFrom: "2026-01-01" as DateOnly,
    });
    const quote = await contract.quote(w.ctx, supplier.id, { itemCode: "BRK-100", quantity: 10 });
    assert.equal(quote?.contractId, spot.id);
    assert.equal(quote?.unitPrice.amountMinor, 1180);
  });

  it("ignores price lines outside the contract's own effective window", async () => {
    const w = world();
    const supplier = await activeSupplier(w);
    const { contract } = w.container.services;
    const active = await activeContract(w, supplier.id);
    await contract.addPriceLine(w.ctx, active.id, {
      itemCode: "brk-100",
      description: "Bracket",
      uom: "ea",
      unitPriceMinor: 1250,
      validFrom: "2026-01-01" as DateOnly,
    });
    const outside = await contract.quote(w.ctx, supplier.id, {
      itemCode: "BRK-100",
      quantity: 10,
      asOf: "2027-06-01" as DateOnly,
    });
    assert.equal(outside, undefined, "the contract term has ended, so it quotes nothing");
  });
});

describe("service levels on a contract", () => {
  async function withCommitment(w: TestWorld) {
    const supplier = await activeSupplier(w);
    const active = await activeContract(w, supplier.id);
    const commitment = await w.container.services.contract.addCommitment(w.ctx, active.id, {
      metric: "on_time_delivery",
      target: 98,
      tolerance: 1,
      penalty: { kind: "service_credit_percent", percent: 2 },
      creditCapPercent: 10,
      escalations: [
        { afterBreaches: 2, action: "Escalate to the supply-chain director" },
        { afterBreaches: 3, action: "Formal cure notice" },
      ],
    });
    return { supplier, contractId: active.id, commitmentId: commitment.id };
  }

  it("commits to one active target per metric", async () => {
    const w = world();
    const { contractId } = await withCommitment(w);
    await expectRejects(
      w.container.services.contract.addCommitment(w.ctx, contractId, { metric: "on_time_delivery", target: 95 }),
      "INVALID_STATE",
      "already commits to on_time_delivery",
    );
  });

  it("counts consecutive breaches and escalates as agreed", async () => {
    const w = world();
    const { contractId, commitmentId } = await withCommitment(w);
    const { contract } = w.container.services;

    const q1 = await contract.recordSlaResult(w.ctx, contractId, {
      commitmentId,
      periodCode: "2026-Q1",
      measured: 94,
      periodSpendMinor: 1_000_000,
    });
    assert.equal(q1?.consecutive, 1);
    assert.equal(q1?.escalation, undefined);

    const q2 = await contract.recordSlaResult(w.ctx, contractId, {
      commitmentId,
      periodCode: "2026-Q2",
      measured: 93,
      periodSpendMinor: 1_000_000,
    });
    assert.equal(q2?.consecutive, 2);
    assert.equal(q2?.escalation, "Escalate to the supply-chain director");

    const q3 = await contract.recordSlaResult(w.ctx, contractId, {
      commitmentId,
      periodCode: "2026-Q3",
      measured: 99,
    });
    assert.equal(q3, undefined, "a met period is not a breach");

    const q4 = await contract.recordSlaResult(w.ctx, contractId, {
      commitmentId,
      periodCode: "2026-Q4",
      measured: 90,
      periodSpendMinor: 1_000_000,
    });
    assert.equal(q4?.consecutive, 1, "the streak restarts after a met period");
    assert.equal(q4?.escalation, "Formal cure notice", "the rolling breach count keeps climbing");
  });

  it("records a period once and only on a live contract", async () => {
    const w = world();
    const { contractId, commitmentId } = await withCommitment(w);
    const { contract } = w.container.services;
    await contract.recordSlaResult(w.ctx, contractId, { commitmentId, periodCode: "2026-Q1", measured: 94 });
    await expectRejects(
      contract.recordSlaResult(w.ctx, contractId, { commitmentId, periodCode: "2026-Q1", measured: 91 }),
      "INVALID_STATE",
      "has already been recorded",
    );

    const supplier = await activeSupplier(w, "DRAFT-CO");
    const drafted = await draftFor(w, supplier.id);
    await expectRejects(
      contract.recordSlaResult(w.ctx, drafted.id, { commitmentId, periodCode: "2026-Q1", measured: 90 }),
      "INVALID_STATE",
      "service levels only apply to an active contract",
    );
  });

  it("credits or waives a breach, never both", async () => {
    const w = world();
    const { contractId, commitmentId } = await withCommitment(w);
    const { contract } = w.container.services;
    const breach = await contract.recordSlaResult(w.ctx, contractId, {
      commitmentId,
      periodCode: "2026-Q1",
      measured: 94,
      periodSpendMinor: 1_000_000,
    });
    assert.equal(breach?.credit?.amountMinor, 40_000);

    await contract.acknowledgeBreach(w.ctx, contractId, breach!.id, "Root cause is the tier-2 foundry");
    const credited = await contract.creditBreach(w.ctx, contractId, breach!.id);
    assert.equal(credited.status, "credited");
    await expectRejects(
      contract.waiveBreach(w.ctx, contractId, breach!.id, "Goodwill"),
      "INVALID_STATE",
      "already been credited",
    );
    const reloaded = await contract.get(w.ctx, contractId);
    assert.equal(reloaded.totalCredits().amountMinor, 40_000);

    const events = w.container.outbox.entries(w.ctx.tenantId).map((event) => event.eventType);
    assert.ok(events.includes(SrmEventTypes.SlaCreditIssued));
  });

  it("keeps a waived breach out of the credit total", async () => {
    const w = world();
    const { contractId, commitmentId } = await withCommitment(w);
    const { contract } = w.container.services;
    const breach = await contract.recordSlaResult(w.ctx, contractId, {
      commitmentId,
      periodCode: "2026-Q1",
      measured: 94,
      periodSpendMinor: 1_000_000,
    });
    await contract.waiveBreach(w.ctx, contractId, breach!.id, "Force majeure: port strike");
    const reloaded = await contract.get(w.ctx, contractId);
    assert.equal(reloaded.totalCredits().amountMinor, 0);
    assert.equal(reloaded.openBreaches().length, 0);
  });
});

describe("contract term sweep", () => {
  it("warns once inside the horizon and then expires the contract", async () => {
    const w = world();
    const supplier = await activeSupplier(w);
    const { contract } = w.container.services;
    const active = await activeContract(w, supplier.id, { effectiveTo: "2026-02-20" as DateOnly });

    const quiet = await contract.runTermSweep(w.ctx, 30);
    assert.deepEqual(quiet.expiringWarned, [], "50 days out is beyond a 30-day horizon");
    const warned = await contract.runTermSweep(w.ctx, 60);
    assert.deepEqual(warned.expiringWarned, [active.number]);
    assert.deepEqual((await contract.runTermSweep(w.ctx, 60)).expiringWarned, [], "the warning fires once");

    w.clock.set("2026-02-21T00:00:00.000Z");
    const swept = await contract.runTermSweep(w.ctx, 10);
    assert.deepEqual(swept.expired, [active.number]);
    assert.equal((await contract.get(w.ctx, active.id)).status, "expired");
  });

  it("auto-renews before the term lapses so cover is never interrupted", async () => {
    const w = world();
    const supplier = await activeSupplier(w);
    const { contract } = w.container.services;
    const active = await activeContract(w, supplier.id, {
      effectiveTo: "2026-02-20" as DateOnly,
      autoRenew: true,
      renewalTermMonths: 12,
    });
    const swept = await contract.runTermSweep(w.ctx, 60);
    assert.deepEqual(swept.autoRenewed, [active.number]);
    const renewed = await contract.get(w.ctx, active.id);
    assert.equal(renewed.status, "active");
    assert.equal(renewed.effectiveTo, "2027-02-20");
    assert.equal(renewed.renewals[0]?.automatic, true);
  });

  it("holds sourcing in the categories an expired contract used to cover", async () => {
    const w = world();
    const supplier = await activeSupplier(w);
    const { contract, category, supplier: supplierService, risk } = w.container.services;
    const machining = await category.create(w.ctx, { code: "machining", name: "Machining" });
    const other = await category.create(w.ctx, { code: "packaging", name: "Packaging" });
    for (const entry of [machining, other]) {
      await supplierService.assignCategory(w.ctx, supplier.id, entry.id);
      await supplierService.approveCategory(w.ctx, supplier.id, entry.id);
    }
    const active = await activeContract(w, supplier.id, {
      effectiveTo: "2026-02-20" as DateOnly,
      categoryIds: [machining.id],
    });

    w.clock.set("2026-02-21T00:00:00.000Z");
    const swept = await contract.runTermSweep(w.ctx, 10);
    assert.deepEqual(swept.holdsPlaced, [active.number]);

    const blocked = await risk.clearance(w.ctx, supplier.id, "sourcing", { categoryId: machining.id });
    assert.equal(blocked.cleared, false);
    assert.equal(blocked.holds[0]?.reasonCode, "contract_expired");
    const unaffected = await risk.clearance(w.ctx, supplier.id, "sourcing", { categoryId: other.id });
    assert.equal(unaffected.cleared, true, "packaging never rode on that contract");
  });

  it("lifts the cover hold when a replacement contract goes live", async () => {
    const w = world();
    const supplier = await activeSupplier(w);
    const { contract, category, supplier: supplierService, risk } = w.container.services;
    const machining = await category.create(w.ctx, { code: "machining", name: "Machining" });
    await supplierService.assignCategory(w.ctx, supplier.id, machining.id);
    await supplierService.approveCategory(w.ctx, supplier.id, machining.id);
    await activeContract(w, supplier.id, { effectiveTo: "2026-02-20" as DateOnly, categoryIds: [machining.id] });

    w.clock.set("2026-02-21T00:00:00.000Z");
    await contract.runTermSweep(w.ctx, 10);
    assert.equal((await risk.clearance(w.ctx, supplier.id, "sourcing", { categoryId: machining.id })).cleared, false);

    await activeContract(w, supplier.id, {
      title: "Framework agreement 2026-2027",
      effectiveFrom: "2026-02-21" as DateOnly,
      effectiveTo: "2027-02-20" as DateOnly,
      categoryIds: [machining.id],
    });
    assert.equal((await risk.clearance(w.ctx, supplier.id, "sourcing", { categoryId: machining.id })).cleared, true);
  });

  it("lists what is expiring inside a horizon, soonest first", async () => {
    const w = world();
    const supplier = await activeSupplier(w);
    const near = await activeContract(w, supplier.id, { effectiveTo: "2026-02-01" as DateOnly, title: "Near" });
    const far = await activeContract(w, supplier.id, { effectiveTo: "2026-03-01" as DateOnly, title: "Far" });
    await activeContract(w, supplier.id, { effectiveTo: "2027-01-01" as DateOnly, title: "Distant" });
    const expiring = await w.container.services.contract.expiringSoon(w.ctx, 90);
    assert.deepEqual(
      expiring.map((entry) => entry.number),
      [near.number, far.number],
    );
  });
});
