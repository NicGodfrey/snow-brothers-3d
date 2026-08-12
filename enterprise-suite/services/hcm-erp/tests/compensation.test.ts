import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { money } from "@enterprise-suite/shared-kernel";
import { HcmEvents } from "../src/domain/events.js";
import { assertDomainError, buildSeededModule, d } from "./helpers.js";

describe("compensation records", () => {
  it("initializes once per employee (contract activation already did it here)", () => {
    const { module, tenant, seed } = buildSeededModule();
    assertDomainError(
      () =>
        module.compensationService.initialize(tenant, {
          employeeId: seed.staffEngineer.id,
          annualBaseSalary: money(1, "USD"),
          payFrequency: "monthly",
          effectiveDate: d("2026-01-01"),
          changedBy: seed.hrUserId,
        }),
      "CONFLICT",
    );
  });

  it("salary changes keep an ordered, reasoned revision history", () => {
    const { module, tenant, seed } = buildSeededModule();
    const svc = module.compensationService;

    const record = svc.changeSalary(tenant, seed.staffEngineer.id, {
      newAnnualSalary: money(18_000_000, "USD"),
      effectiveDate: d("2026-04-01"),
      reason: "promotion",
      changedBy: seed.hrUserId,
    });
    assert.equal(record.baseSalary.amountMinor, 18_000_000);
    assert.equal(record.revisions.length, 2);
    assert.equal(record.revisions[1].previousSalary?.amountMinor, 16_500_000);

    // merit/promotion cannot decrease; demotion cannot increase
    assertDomainError(
      () =>
        svc.changeSalary(tenant, seed.staffEngineer.id, {
          newAnnualSalary: money(17_000_000, "USD"),
          effectiveDate: d("2026-05-01"),
          reason: "merit",
          changedBy: seed.hrUserId,
        }),
      "REASON_MISMATCH",
    );
    assertDomainError(
      () =>
        svc.changeSalary(tenant, seed.staffEngineer.id, {
          newAnnualSalary: money(19_000_000, "USD"),
          effectiveDate: d("2026-05-01"),
          reason: "demotion",
          changedBy: seed.hrUserId,
        }),
      "REASON_MISMATCH",
    );
    // revisions cannot move backwards in time
    assertDomainError(
      () =>
        svc.changeSalary(tenant, seed.staffEngineer.id, {
          newAnnualSalary: money(19_000_000, "USD"),
          effectiveDate: d("2026-03-01"),
          reason: "merit",
          changedBy: seed.hrUserId,
        }),
      "REVISION_OUT_OF_ORDER",
    );
    // currency is immutable
    assertDomainError(
      () =>
        svc.changeSalary(tenant, seed.staffEngineer.id, {
          newAnnualSalary: money(19_000_000, "EUR"),
          effectiveDate: d("2026-05-01"),
          reason: "merit",
          changedBy: seed.hrUserId,
        }),
      "CURRENCY_MISMATCH",
    );

    const emitted = module.outbox.drain();
    const changed = emitted.find((e) => e.eventType === HcmEvents.SalaryChanged);
    assert.ok(changed);
  });

  it("allowances are unique by code and currency-checked", () => {
    const { module, tenant, seed } = buildSeededModule();
    const svc = module.compensationService;
    svc.addAllowance(tenant, seed.staffEngineer.id, {
      code: "commute",
      name: "Commute allowance",
      amount: money(50_000, "USD"),
      recurrence: "per_pay_period",
    });
    assertDomainError(
      () =>
        svc.addAllowance(tenant, seed.staffEngineer.id, {
          code: "COMMUTE",
          name: "Duplicate",
          amount: money(10_000, "USD"),
          recurrence: "per_pay_period",
        }),
      "DUPLICATE_ALLOWANCE",
    );
    assertDomainError(
      () =>
        svc.addAllowance(tenant, seed.staffEngineer.id, {
          code: "lunch",
          name: "Lunch",
          amount: money(10_000, "EUR"),
          recurrence: "per_pay_period",
        }),
      "CURRENCY_MISMATCH",
    );
    svc.removeAllowance(tenant, seed.staffEngineer.id, "commute");
    assertDomainError(() => svc.removeAllowance(tenant, seed.staffEngineer.id, "commute"), "ALLOWANCE_NOT_FOUND");
  });

  it("bonuses run pending → paid/cancelled", () => {
    const { module, tenant, seed } = buildSeededModule();
    const svc = module.compensationService;
    const bonus = svc.awardBonus(tenant, {
      employeeId: seed.staffEngineer.id,
      kind: "performance",
      amount: money(500_000, "USD"),
      awardedBy: seed.hrUserId,
      payoutDate: d("2026-03-25"),
    });
    assert.equal(bonus.status, "pending");
    svc.markBonusPaid(tenant, bonus.id);
    assert.equal(bonus.status, "paid");
    assertDomainError(() => svc.markBonusPaid(tenant, bonus.id), "INVALID_STATUS_TRANSITION");
    assertDomainError(() => svc.cancelBonus(tenant, bonus.id, "late"), "INVALID_STATUS_TRANSITION");
  });
});

describe("payslip stub calculator", () => {
  it("computes per-period earnings exactly and marks all deductions as stubs", () => {
    const { module, tenant, seed } = buildSeededModule();
    const svc = module.compensationService;

    // normalize to a round salary for exact math: 12,000,000 minor / year, monthly
    svc.changeSalary(tenant, seed.staffEngineer.id, {
      newAnnualSalary: money(12_000_000, "USD"),
      effectiveDate: d("2026-01-01"),
      reason: "market_adjustment",
      changedBy: seed.hrUserId,
    });
    svc.addAllowance(tenant, seed.staffEngineer.id, {
      code: "commute",
      name: "Commute allowance",
      amount: money(50_000, "USD"),
      recurrence: "per_pay_period",
    });
    svc.addAllowance(tenant, seed.staffEngineer.id, {
      code: "wellness",
      name: "Wellness budget",
      amount: money(120_000, "USD"),
      recurrence: "annual", // → 10,000 per month
    });
    svc.awardBonus(tenant, {
      employeeId: seed.staffEngineer.id,
      kind: "spot",
      amount: money(200_000, "USD"),
      awardedBy: seed.hrUserId,
      payoutDate: d("2026-03-25"),
    });

    // month without the bonus
    const february = svc.payslipPreview(tenant, seed.staffEngineer.id, 2026, 2);
    assert.equal(february.grossMinor, 1_000_000 + 50_000 + 10_000);
    // income tax 20% = 212,000; SS 6% of capped 1,000,000 = 60,000; pension 4% = 42,400
    assert.equal(february.totalDeductionsMinor, 212_000 + 60_000 + 42_400);
    assert.equal(february.netMinor, 1_060_000 - 314_400);
    assert.equal(february.stub, true);
    assert.ok(february.lines.filter((l) => l.kind === "deduction").every((l) => l.stub));
    assert.ok(february.lines.filter((l) => l.kind === "earning").every((l) => !l.stub));

    // employer contribution is informational, not deducted
    const employer = february.lines.find((l) => l.kind === "employer_contribution");
    assert.ok(employer);
    assert.equal(employer.amountMinor, Math.round(1_060_000 * 0.09));

    // the bonus lands only in its payout month
    const march = svc.payslipPreview(tenant, seed.staffEngineer.id, 2026, 3);
    assert.equal(march.grossMinor, 1_060_000 + 200_000);
    assert.ok(march.lines.some((l) => l.code === "bonus_spot"));
  });
});
