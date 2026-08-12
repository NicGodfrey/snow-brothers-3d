import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { money, type Ulid } from "@enterprise-suite/shared-kernel";
import { HcmEvents } from "../src/domain/events.js";
import type { Position } from "../src/domain/position.js";
import type { SeededContext } from "./helpers.js";
import { assertDomainError, buildSeededModule, d } from "./helpers.js";

function draftRequisition(ctx: SeededContext, position: Position, headcount = 1) {
  return ctx.module.requisitionService.createDraft(ctx.tenant, {
    positionId: position.id,
    headcount,
    hiringManagerId: ctx.seed.cto.id,
    justification: "Platform team is at capacity and roadmap slipped",
    salaryBand: { min: money(10_000_000, "USD"), max: money(14_000_000, "USD") },
    targetStartDate: d("2026-04-01"),
  });
}

describe("hiring requisitions", () => {
  it("cannot target filled or eliminated positions and needs a justification", () => {
    const { module, tenant, seed } = buildSeededModule();
    // staff engineer's position is filled
    assertDomainError(
      () =>
        module.requisitionService.createDraft(tenant, {
          positionId: seed.staffEngPosition.id,
          hiringManagerId: seed.cto.id,
          justification: "Backfill something that is not vacant",
        }),
      "CONFLICT",
    );
    const open = module.orgService.openPosition(tenant, {
      orgUnitId: seed.platformTeam.id,
      title: "SRE",
      grade: "IC4",
    });
    assertDomainError(
      () =>
        module.requisitionService.createDraft(tenant, {
          positionId: open.id,
          hiringManagerId: seed.cto.id,
          justification: "short",
        }),
      "JUSTIFICATION_REQUIRED",
    );
  });

  it("walks draft → pending_approval → open with self-approval blocked", () => {
    const ctx = buildSeededModule();
    const { module, tenant, seed } = ctx;
    const position = module.orgService.openPosition(tenant, {
      orgUnitId: ctx.seed.platformTeam.id,
      title: "SRE",
      grade: "IC4",
    });
    const requisition = draftRequisition(ctx, position);
    assert.equal(requisition.status, "draft");

    // cannot approve a draft
    assertDomainError(
      () => module.requisitionService.approve(tenant, requisition.id, seed.hrUserId),
      "INVALID_STATUS_TRANSITION",
    );
    module.requisitionService.submitForApproval(tenant, requisition.id);

    // the hiring manager cannot approve their own requisition
    assertDomainError(
      () => module.requisitionService.approve(tenant, requisition.id, seed.cto.id),
      "SELF_APPROVAL",
    );
    module.requisitionService.approve(tenant, requisition.id, seed.hrUserId, "budget confirmed");
    assert.equal(requisition.status, "open");
    assert.equal(requisition.approvals.length, 1);

    // hold and resume
    module.requisitionService.hold(tenant, requisition.id, "quarterly freeze");
    assert.equal(requisition.status, "on_hold");
    module.requisitionService.resume(tenant, requisition.id);
    assert.equal(requisition.status, "open");
  });

  it("rejection returns the requisition to draft with an audit trail", () => {
    const ctx = buildSeededModule();
    const { module, tenant, seed } = ctx;
    const position = module.orgService.openPosition(tenant, {
      orgUnitId: seed.platformTeam.id,
      title: "SRE",
      grade: "IC4",
    });
    const requisition = draftRequisition(ctx, position);
    module.requisitionService.submitForApproval(tenant, requisition.id);
    module.requisitionService.reject(tenant, requisition.id, seed.hrUserId, "no budget this quarter");
    assert.equal(requisition.status, "draft");
    assert.equal(requisition.approvals[0].decision, "rejected");
    // it can be resubmitted
    module.requisitionService.submitForApproval(tenant, requisition.id);
    assert.equal(requisition.status, "pending_approval");
  });

  it("fill orchestrates employee + contract + position + compensation end-to-end", () => {
    const ctx = buildSeededModule();
    const { module, tenant, seed } = ctx;
    const position = module.orgService.openPosition(tenant, {
      orgUnitId: seed.platformTeam.id,
      title: "SRE",
      grade: "IC4",
    });
    const requisition = draftRequisition(ctx, position);
    module.requisitionService.submitForApproval(tenant, requisition.id);
    module.requisitionService.approve(tenant, requisition.id, seed.hrUserId);
    module.outbox.drain();

    // offer outside the approved band is rejected
    assertDomainError(
      () =>
        module.requisitionService.fill(tenant, requisition.id, {
          recordedBy: seed.hrUserId,
          employee: {
            employeeNumber: "ACME-0400",
            firstName: "Jo",
            lastName: "Vega",
            email: "jo@acme.test",
            hireDate: d("2026-04-01"),
          },
          contract: {
            contractType: "permanent",
            startDate: d("2026-04-01"),
            baseSalary: money(20_000_000, "USD"),
          },
        }),
      "SALARY_OUTSIDE_BAND",
    );

    const result = module.requisitionService.fill(tenant, requisition.id, {
      recordedBy: seed.hrUserId,
      employee: {
        employeeNumber: "ACME-0400",
        firstName: "Jo",
        lastName: "Vega",
        email: "jo@acme.test",
        hireDate: d("2026-04-01"),
      },
      contract: {
        contractType: "permanent",
        startDate: d("2026-04-01"),
        probationEndDate: d("2026-10-01"),
        baseSalary: money(12_000_000, "USD"),
      },
    });

    assert.equal(result.requisition.status, "filled");
    assert.equal(result.employee.managerEmployeeId, seed.cto.id); // reports to the hiring manager
    assert.equal(result.contract.status, "active");
    assert.equal(module.orgService.getPosition(tenant, position.id).status, "filled");
    assert.equal(module.orgService.getPosition(tenant, position.id).currentEmployeeId, result.employee.id);
    assert.equal(
      module.compensationService.getByEmployee(tenant, result.employee.id).baseSalary.amountMinor,
      12_000_000,
    );

    const emitted = module.outbox.drain().map((e) => e.eventType);
    for (const expected of [
      HcmEvents.EmployeeHired,
      HcmEvents.ContractActivated,
      HcmEvents.PositionFilled,
      HcmEvents.CompensationInitialized,
      HcmEvents.RequisitionHireRecorded,
      HcmEvents.RequisitionFilled,
    ]) {
      assert.ok(emitted.includes(expected), `missing event ${expected}`);
    }

    // a filled requisition cannot take further hires or be cancelled
    assertDomainError(
      () =>
        module.requisitionService.fill(tenant, requisition.id, {
          recordedBy: seed.hrUserId,
          employee: {
            employeeNumber: "ACME-0401",
            firstName: "Ka",
            lastName: "Lee",
            email: "ka@acme.test",
            hireDate: d("2026-04-01"),
          },
          contract: {
            contractType: "permanent",
            startDate: d("2026-04-01"),
            baseSalary: money(11_000_000, "USD"),
          },
        }),
      "CONFLICT",
    );
    assertDomainError(
      () => module.requisitionService.cancel(tenant, requisition.id, "obsolete"),
      "INVALID_STATUS_TRANSITION",
    );
  });

  it("multi-headcount requisitions fill across sibling positions", () => {
    const ctx = buildSeededModule();
    const { module, tenant, seed } = ctx;
    const p1 = module.orgService.openPosition(tenant, { orgUnitId: seed.platformTeam.id, title: "SRE", grade: "IC4" });
    const p2 = module.orgService.openPosition(tenant, { orgUnitId: seed.platformTeam.id, title: "SRE", grade: "IC4" });
    const elsewhere = module.orgService.openPosition(tenant, { orgUnitId: seed.peopleOps.id, title: "HRBP", grade: "IC3" });

    const requisition = draftRequisition(ctx, p1, 2);
    module.requisitionService.submitForApproval(tenant, requisition.id);
    module.requisitionService.approve(tenant, requisition.id, seed.hrUserId);

    const hire = (employeeNumber: string, email: string, positionId?: Ulid) =>
      module.requisitionService.fill(tenant, requisition.id, {
        positionId,
        recordedBy: seed.hrUserId,
        employee: { employeeNumber, firstName: "New", lastName: "Hire", email, hireDate: d("2026-05-01") },
        contract: { contractType: "permanent", startDate: d("2026-05-01"), baseSalary: money(11_000_000, "USD") },
      });

    hire("ACME-0500", "h1@acme.test");
    assert.equal(requisition.status, "open");
    assert.equal(requisition.remainingHeadcount, 1);

    // a position from another org unit is rejected
    assertDomainError(() => hire("ACME-0501", "h2@acme.test", elsewhere.id), "CONFLICT");

    hire("ACME-0501", "h2@acme.test", p2.id);
    assert.equal(requisition.status, "filled");
    assert.equal(requisition.hiredEmployeeIds.length, 2);
  });
});
