import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { countWorkingDays } from "../src/domain/common.js";
import { HcmEvents } from "../src/domain/events.js";
import { assertDomainError, buildSeededModule, d } from "./helpers.js";

describe("working-day calculation", () => {
  it("counts weekdays inclusively and skips holidays", () => {
    // 2026-07-06 is a Monday
    assert.equal(countWorkingDays(d("2026-07-06"), d("2026-07-10")), 5);
    assert.equal(countWorkingDays(d("2026-07-06"), d("2026-07-06")), 1);
    // full week including weekend still yields 5
    assert.equal(countWorkingDays(d("2026-07-06"), d("2026-07-12")), 5);
    // weekend only
    assert.equal(countWorkingDays(d("2026-07-11"), d("2026-07-12")), 0);
    // holiday on Friday 2026-05-01 removes a day
    assert.equal(countWorkingDays(d("2026-04-27"), d("2026-05-01"), new Set(["2026-05-01"])), 4);
    // reversed range is empty
    assert.equal(countWorkingDays(d("2026-07-10"), d("2026-07-06")), 0);
  });
});

describe("leave balances", () => {
  it("grants full entitlement, pro-rated in the hire year", () => {
    const { module, tenant, seed } = buildSeededModule();
    // hired 2023 → full 24 days in 2026
    const balance = module.leaveService.grantAnnualEntitlement(tenant, seed.staffEngineer.id, "annual", 2026);
    assert.equal(balance.entitledDays, 24);

    // hired July 2026 → 6 remaining months → 12 days
    const midYear = module.employeeService.hire(tenant, {
      employeeNumber: "ACME-0300",
      firstName: "Iva",
      lastName: "Nova",
      email: "iva@acme.test",
      hireDate: d("2026-07-15"),
    });
    const proRated = module.leaveService.grantAnnualEntitlement(tenant, midYear.id, "annual", 2026);
    assert.equal(proRated.entitledDays, 12);
  });

  it("accrues monthly for employees employed in the month", () => {
    const { module, tenant, seed } = buildSeededModule();
    const count = module.leaveService.runMonthlyAccrual(tenant, "annual", 2026, 1);
    assert.equal(count, 3); // three seeded employees
    const balance = module.repos.leaveBalances.find(tenant, seed.cto.id, "annual", 2026);
    assert.equal(balance?.accruedDays, 2); // 24 / 12
  });

  it("caps carryover at the policy maximum and debits the source year", () => {
    const { module, tenant, seed } = buildSeededModule();
    const svc = module.leaveService;
    const balance = svc.grantAnnualEntitlement(tenant, seed.cto.id, "annual", 2025);
    balance.adjust(-16); // simulate 16 days consumed → 8 remaining, cap is 5
    module.repos.leaveBalances.save(balance);

    const carried = svc.carryOver(tenant, seed.cto.id, "annual", 2025);
    assert.equal(carried, 5);
    const source = module.repos.leaveBalances.find(tenant, seed.cto.id, "annual", 2025);
    const target = module.repos.leaveBalances.find(tenant, seed.cto.id, "annual", 2026);
    assert.equal(source?.remainingDays, 3);
    assert.equal(target?.carriedOverDays, 5);
  });
});

describe("leave requests", () => {
  it("submit reserves working days against the balance, holiday-aware", () => {
    const { module, tenant, seed } = buildSeededModule();
    const svc = module.leaveService;
    svc.grantAnnualEntitlement(tenant, seed.staffEngineer.id, "annual", 2026);

    // Mon 2026-04-27 .. Fri 2026-05-01 with May 1 a seeded public holiday
    const request = svc.submitRequest(tenant, {
      employeeId: seed.staffEngineer.id,
      leaveType: "annual",
      startDate: d("2026-04-27"),
      endDate: d("2026-05-01"),
      reason: "spring break",
    });
    assert.equal(request.workingDays, 4);
    assert.equal(request.status, "submitted");

    const balance = module.repos.leaveBalances.find(tenant, seed.staffEngineer.id, "annual", 2026);
    assert.equal(balance?.pendingDays, 4);
    assert.equal(balance?.availableDays, 20);
  });

  it("rejects weekend-only, overlapping, and over-balance requests", () => {
    const { module, tenant, seed } = buildSeededModule();
    const svc = module.leaveService;
    svc.grantAnnualEntitlement(tenant, seed.staffEngineer.id, "annual", 2026);

    assertDomainError(
      () =>
        svc.submitRequest(tenant, {
          employeeId: seed.staffEngineer.id,
          leaveType: "annual",
          startDate: d("2026-07-11"), // Sat
          endDate: d("2026-07-12"), // Sun
        }),
      "NO_WORKING_DAYS",
    );

    svc.submitRequest(tenant, {
      employeeId: seed.staffEngineer.id,
      leaveType: "annual",
      startDate: d("2026-07-06"),
      endDate: d("2026-07-10"),
    });
    assertDomainError(
      () =>
        svc.submitRequest(tenant, {
          employeeId: seed.staffEngineer.id,
          leaveType: "annual",
          startDate: d("2026-07-08"),
          endDate: d("2026-07-15"),
        }),
      "CONFLICT",
    );

    // 24 entitled − 5 pending = 19 available; a 20-working-day request must fail
    assertDomainError(
      () =>
        svc.submitRequest(tenant, {
          employeeId: seed.staffEngineer.id,
          leaveType: "annual",
          startDate: d("2026-08-03"),
          endDate: d("2026-08-28"),
        }),
      "INSUFFICIENT_LEAVE_BALANCE",
    );
  });

  it("approve commits the reservation; reject releases it", () => {
    const { module, tenant, seed } = buildSeededModule();
    const svc = module.leaveService;
    svc.grantAnnualEntitlement(tenant, seed.staffEngineer.id, "annual", 2026);

    const first = svc.submitRequest(tenant, {
      employeeId: seed.staffEngineer.id,
      leaveType: "annual",
      startDate: d("2026-07-06"),
      endDate: d("2026-07-08"),
    });
    // self-approval is forbidden
    assertDomainError(() => svc.approve(tenant, first.id, seed.staffEngineer.id), "SELF_APPROVAL");
    svc.approve(tenant, first.id, seed.cto.id);
    let balance = module.repos.leaveBalances.find(tenant, seed.staffEngineer.id, "annual", 2026);
    assert.equal(balance?.takenDays, 3);
    assert.equal(balance?.pendingDays, 0);

    const second = svc.submitRequest(tenant, {
      employeeId: seed.staffEngineer.id,
      leaveType: "annual",
      startDate: d("2026-09-07"),
      endDate: d("2026-09-11"),
    });
    assertDomainError(() => svc.reject(tenant, second.id, seed.cto.id, " "), "REJECTION_NOTE_REQUIRED");
    svc.reject(tenant, second.id, seed.cto.id, "release freeze week");
    balance = module.repos.leaveBalances.find(tenant, seed.staffEngineer.id, "annual", 2026);
    assert.equal(balance?.takenDays, 3);
    assert.equal(balance?.pendingDays, 0);
    assert.equal(balance?.availableDays, 21);
  });

  it("cancelling approved leave refunds days only before it starts", () => {
    const { module, tenant, seed, clock } = buildSeededModule("2026-01-15");
    const svc = module.leaveService;
    svc.grantAnnualEntitlement(tenant, seed.staffEngineer.id, "annual", 2026);

    const request = svc.submitRequest(tenant, {
      employeeId: seed.staffEngineer.id,
      leaveType: "annual",
      startDate: d("2026-02-02"),
      endDate: d("2026-02-06"),
    });
    svc.approve(tenant, request.id, seed.cto.id);

    // once the leave has started it cannot be cancelled
    clock.set(d("2026-02-03"));
    assertDomainError(() => svc.cancel(tenant, request.id), "LEAVE_ALREADY_STARTED");

    // a future approved request can be cancelled with a refund
    const future = svc.submitRequest(tenant, {
      employeeId: seed.staffEngineer.id,
      leaveType: "annual",
      startDate: d("2026-03-02"),
      endDate: d("2026-03-06"),
    });
    svc.approve(tenant, future.id, seed.cto.id);
    svc.cancel(tenant, future.id);
    const balance = module.repos.leaveBalances.find(tenant, seed.staffEngineer.id, "annual", 2026);
    assert.equal(balance?.takenDays, 5); // only the started request remains
  });

  it("auto-approves policies that do not require approval", () => {
    const { module, tenant, seed } = buildSeededModule();
    const request = module.leaveService.submitRequest(tenant, {
      employeeId: seed.staffEngineer.id,
      leaveType: "sick", // seeded: requiresApproval=false, allowNegativeBalance=true
      startDate: d("2026-07-06"),
      endDate: d("2026-07-07"),
    });
    assert.equal(request.status, "approved");
    const emitted = module.outbox.drain().map((e) => e.eventType);
    assert.ok(emitted.includes(HcmEvents.LeaveRequested));
    assert.ok(emitted.includes(HcmEvents.LeaveApproved));
    const balance = module.repos.leaveBalances.find(tenant, seed.staffEngineer.id, "sick", 2026);
    assert.equal(balance?.takenDays, 2);
    assert.equal(balance?.availableDays, -2); // negative allowed for sick leave
  });

  it("terminated employees cannot request leave", () => {
    const { module, tenant, seed } = buildSeededModule();
    module.employeeService.terminate(tenant, seed.staffEngineer.id, {
      terminationDate: d("2026-01-31"),
      reason: "resignation",
    });
    assertDomainError(
      () =>
        module.leaveService.submitRequest(tenant, {
          employeeId: seed.staffEngineer.id,
          leaveType: "annual",
          startDate: d("2026-02-02"),
          endDate: d("2026-02-03"),
        }),
      "CONFLICT",
    );
  });
});
