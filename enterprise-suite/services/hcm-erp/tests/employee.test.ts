import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HcmEvents } from "../src/domain/events.js";
import { assertDomainError, buildSeededModule, d } from "./helpers.js";

describe("employee lifecycle", () => {
  it("hires with validation and uniqueness", () => {
    const { module, tenant } = buildSeededModule();
    const svc = module.employeeService;

    const hired = svc.hire(tenant, {
      employeeNumber: "acme-0100",
      firstName: "Dana",
      lastName: "Kim",
      email: "Dana.Kim@acme.test",
      hireDate: d("2026-01-05"),
    });
    assert.equal(hired.employeeNumber, "ACME-0100");
    assert.equal(hired.email, "dana.kim@acme.test");
    assert.equal(hired.status, "active");

    assertDomainError(
      () =>
        svc.hire(tenant, {
          employeeNumber: "ACME-0100",
          firstName: "Dupe",
          lastName: "Dupe",
          email: "dupe@acme.test",
          hireDate: d("2026-01-05"),
        }),
      "CONFLICT",
    );
    assertDomainError(
      () =>
        svc.hire(tenant, {
          employeeNumber: "X1", // too short: employee numbers are 3-16 chars
          firstName: "Bad",
          lastName: "Number",
          email: "ok@acme.test",
          hireDate: d("2026-01-05"),
        }),
      "INVALID_EMPLOYEE_NUMBER",
    );
    assertDomainError(
      () =>
        svc.hire(tenant, {
          employeeNumber: "X-100",
          firstName: "Bad",
          lastName: "Email",
          email: "not-an-email",
          hireDate: d("2026-01-05"),
        }),
      "INVALID_EMAIL",
    );
  });

  it("walks status transitions with guards", () => {
    const { module, tenant, seed } = buildSeededModule();
    const svc = module.employeeService;
    const id = seed.staffEngineer.id;

    svc.placeOnLeave(tenant, id);
    assert.equal(svc.getEmployee(tenant, id).status, "on_leave");
    assertDomainError(() => svc.placeOnLeave(tenant, id), "INVALID_STATUS_TRANSITION");
    svc.returnFromLeave(tenant, id);
    svc.suspend(tenant, id, "policy investigation");
    assert.equal(svc.getEmployee(tenant, id).status, "suspended");
    assertDomainError(() => svc.placeOnLeave(tenant, id), "INVALID_STATUS_TRANSITION");
    svc.reinstate(tenant, id);
    assert.equal(svc.getEmployee(tenant, id).status, "active");
  });

  it("prevents management cycles and self-management", () => {
    const { module, tenant, seed } = buildSeededModule();
    const svc = module.employeeService;
    // staffEngineer already reports to cto; making cto report to staffEngineer is a cycle
    assertDomainError(() => svc.changeManager(tenant, seed.cto.id, seed.staffEngineer.id), "MANAGEMENT_CYCLE");
    assertDomainError(() => svc.changeManager(tenant, seed.cto.id, seed.cto.id), "SELF_MANAGER");
    // legitimate reassignment works
    svc.changeManager(tenant, seed.staffEngineer.id, seed.hrLead.id);
    assert.equal(svc.getEmployee(tenant, seed.staffEngineer.id).managerEmployeeId, seed.hrLead.id);
  });

  it("termination orchestrates position, contract, and direct reports", () => {
    const { module, tenant, seed } = buildSeededModule();
    const svc = module.employeeService;

    // give the CTO a manager-less report chain: staffEngineer → cto → (none)
    assert.equal(seed.staffEngineer.managerEmployeeId, seed.cto.id);
    const positionId = seed.cto.primaryPositionId;
    assert.ok(positionId);

    svc.terminate(tenant, seed.cto.id, {
      terminationDate: d("2026-02-28"),
      reason: "resignation",
      rehireEligible: true,
    });

    const cto = svc.getEmployee(tenant, seed.cto.id);
    assert.equal(cto.status, "terminated");
    assert.equal(cto.terminationDate, d("2026-02-28"));
    assert.equal(cto.primaryPositionId, undefined);

    // position vacated and re-openable
    const position = module.orgService.getPosition(tenant, positionId);
    assert.equal(position.status, "open");

    // active contract terminated
    const contracts = module.contractService.listByEmployee(tenant, seed.cto.id);
    assert.equal(contracts.length, 1);
    assert.equal(contracts[0].status, "terminated");

    // direct report re-parented to the leaver's manager (none here)
    assert.equal(svc.getEmployee(tenant, seed.staffEngineer.id).managerEmployeeId, undefined);

    const emitted = module.outbox.drain().map((e) => e.eventType);
    assert.ok(emitted.includes(HcmEvents.EmployeeTerminated));
    assert.ok(emitted.includes(HcmEvents.PositionVacated));
    assert.ok(emitted.includes(HcmEvents.ContractTerminated));
    assert.ok(emitted.includes(HcmEvents.EmployeeManagerChanged));

    // terminated employees cannot transition further
    assertDomainError(() => svc.placeOnLeave(tenant, seed.cto.id), "INVALID_STATUS_TRANSITION");
    assertDomainError(
      () => svc.terminate(tenant, seed.cto.id, { terminationDate: d("2026-03-01"), reason: "other" }),
      "ALREADY_TERMINATED",
    );
  });

  it("rejects termination before the hire date", () => {
    const { module, tenant, seed } = buildSeededModule();
    assertDomainError(
      () =>
        module.employeeService.terminate(tenant, seed.staffEngineer.id, {
          terminationDate: d("2022-01-01"), // hired 2023-03-01
          reason: "dismissal",
        }),
      "INVALID_TERMINATION_DATE",
    );
  });

  it("enforces tenant isolation in repositories", () => {
    const { module, tenant, seed } = buildSeededModule();
    const otherTenant = "intruder" as never;
    assert.equal(module.repos.employees.findById(otherTenant, seed.cto.id), undefined);
    assertDomainError(() => module.employeeService.getEmployee(otherTenant, seed.cto.id), "NOT_FOUND");
    assert.ok(module.employeeService.getEmployee(tenant, seed.cto.id));
  });
});
