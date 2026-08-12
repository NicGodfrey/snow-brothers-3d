import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { money } from "@enterprise-suite/shared-kernel";
import { HcmEvents } from "../src/domain/events.js";
import { assertDomainError, buildSeededModule, d } from "./helpers.js";

describe("employment contracts", () => {
  it("validates terms at draft time", () => {
    const { module, tenant, seed } = buildSeededModule();
    const svc = module.contractService;
    const employee = module.employeeService.hire(tenant, {
      employeeNumber: "ACME-0200",
      firstName: "Femi",
      lastName: "Ade",
      email: "femi@acme.test",
      hireDate: d("2026-02-01"),
    });
    const position = module.orgService.openPosition(tenant, {
      orgUnitId: seed.platformTeam.id,
      title: "Engineer II",
      grade: "IC3",
    });

    // fixed-term requires an end date
    assertDomainError(
      () =>
        svc.draftContract(tenant, {
          employeeId: employee.id,
          positionId: position.id,
          contractType: "fixed_term",
          startDate: d("2026-02-01"),
          baseSalary: money(9_000_000, "USD"),
        }),
      "CONTRACT_END_DATE_REQUIRED",
    );
    // permanent must not carry one
    assertDomainError(
      () =>
        svc.draftContract(tenant, {
          employeeId: employee.id,
          positionId: position.id,
          contractType: "permanent",
          startDate: d("2026-02-01"),
          endDate: d("2027-02-01"),
          baseSalary: money(9_000_000, "USD"),
        }),
      "CONTRACT_END_DATE_FORBIDDEN",
    );
    assertDomainError(
      () =>
        svc.draftContract(tenant, {
          employeeId: employee.id,
          positionId: position.id,
          contractType: "permanent",
          startDate: d("2026-02-01"),
          weeklyHours: 80,
          baseSalary: money(9_000_000, "USD"),
        }),
      "INVALID_WEEKLY_HOURS",
    );
    assertDomainError(
      () =>
        svc.draftContract(tenant, {
          employeeId: employee.id,
          positionId: position.id,
          contractType: "permanent",
          startDate: d("2026-02-01"),
          baseSalary: money(0, "USD"),
        }),
      "INVALID_SALARY",
    );
  });

  it("activation fills the position, sets primary position, and bootstraps compensation", () => {
    const { module, tenant, seed } = buildSeededModule();
    const employee = module.employeeService.hire(tenant, {
      employeeNumber: "ACME-0201",
      firstName: "Gita",
      lastName: "Rao",
      email: "gita@acme.test",
      hireDate: d("2026-02-01"),
    });
    const position = module.orgService.openPosition(tenant, {
      orgUnitId: seed.platformTeam.id,
      title: "Engineer II",
      grade: "IC3",
    });
    const contract = module.contractService.draftContract(tenant, {
      employeeId: employee.id,
      positionId: position.id,
      contractType: "permanent",
      startDate: d("2026-02-01"),
      baseSalary: money(9_600_000, "USD"),
      payFrequency: "monthly",
    });
    module.outbox.drain();
    module.contractService.activateContract(tenant, contract.id, seed.hrUserId);

    assert.equal(contract.status, "active");
    assert.equal(module.orgService.getPosition(tenant, position.id).status, "filled");
    assert.equal(module.employeeService.getEmployee(tenant, employee.id).primaryPositionId, position.id);

    const compensation = module.compensationService.getByEmployee(tenant, employee.id);
    assert.equal(compensation.baseSalary.amountMinor, 9_600_000);
    assert.equal(compensation.revisions[0].reason, "initial");

    const emitted = module.outbox.drain().map((e) => e.eventType);
    assert.ok(emitted.includes(HcmEvents.ContractActivated));
    assert.ok(emitted.includes(HcmEvents.PositionFilled));
    assert.ok(emitted.includes(HcmEvents.CompensationInitialized));

    // a second active contract for the same employee is rejected
    const secondPosition = module.orgService.openPosition(tenant, {
      orgUnitId: seed.platformTeam.id,
      title: "Engineer III",
      grade: "IC4",
    });
    const second = module.contractService.draftContract(tenant, {
      employeeId: employee.id,
      positionId: secondPosition.id,
      contractType: "permanent",
      startDate: d("2026-03-01"),
      baseSalary: money(10_000_000, "USD"),
    });
    assertDomainError(
      () => module.contractService.activateContract(tenant, second.id, seed.hrUserId),
      "CONFLICT",
    );
  });

  it("amendments are ordered, whitelisted, and currency-stable", () => {
    const { module, tenant, seed } = buildSeededModule();
    const contract = module.contractService.listByEmployee(tenant, seed.staffEngineer.id)[0];

    const amended = module.contractService.amendContract(tenant, contract.id, {
      effectiveDate: d("2026-04-01"),
      amendedBy: seed.hrUserId,
      changes: { fte: 0.8, weeklyHours: 32 },
      note: "parental part-time arrangement",
    });
    const amendment = amended.amendments[0];
    assert.equal(amendment.amendmentNumber, 1);
    assert.equal(contract.fte, 0.8);
    assert.equal(contract.weeklyHours, 32);

    // effective date going backwards is rejected
    assertDomainError(
      () =>
        module.contractService.amendContract(tenant, contract.id, {
          effectiveDate: d("2026-03-01"),
          amendedBy: seed.hrUserId,
          changes: { fte: 1 },
        }),
      "AMENDMENT_OUT_OF_ORDER",
    );
    // currency changes are rejected
    assertDomainError(
      () =>
        module.contractService.amendContract(tenant, contract.id, {
          effectiveDate: d("2026-05-01"),
          amendedBy: seed.hrUserId,
          changes: { baseSalary: money(15_000_000, "EUR") },
        }),
      "CURRENCY_MISMATCH",
    );
    // empty change sets are rejected
    assertDomainError(
      () =>
        module.contractService.amendContract(tenant, contract.id, {
          effectiveDate: d("2026-05-01"),
          amendedBy: seed.hrUserId,
          changes: {},
        }),
      "EMPTY_AMENDMENT",
    );
  });

  it("expire sweep closes overdue fixed-term contracts and vacates positions", () => {
    const { module, tenant, seed, clock } = buildSeededModule("2026-01-15");
    const employee = module.employeeService.hire(tenant, {
      employeeNumber: "ACME-0202",
      firstName: "Hans",
      lastName: "Meyer",
      email: "hans@acme.test",
      hireDate: d("2026-01-15"),
    });
    const position = module.orgService.openPosition(tenant, {
      orgUnitId: seed.peopleOps.id,
      title: "HR Intern",
      grade: "IC1",
    });
    const contract = module.contractService.draftContract(tenant, {
      employeeId: employee.id,
      positionId: position.id,
      contractType: "intern",
      startDate: d("2026-01-15"),
      endDate: d("2026-06-30"),
      baseSalary: money(2_400_000, "USD"),
    });
    module.contractService.activateContract(tenant, contract.id, seed.hrUserId);

    // nothing expires while the contract is still running
    clock.set(d("2026-06-30"));
    assert.equal(module.contractService.expireContracts(tenant).length, 0);

    clock.set(d("2026-07-01"));
    const expired = module.contractService.expireContracts(tenant);
    assert.equal(expired.length, 1);
    assert.equal(expired[0].status, "expired");
    assert.equal(module.orgService.getPosition(tenant, position.id).status, "open");
    assert.equal(module.employeeService.getEmployee(tenant, employee.id).primaryPositionId, undefined);
  });
});
