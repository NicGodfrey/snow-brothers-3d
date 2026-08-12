import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lineInput } from "../src/application/requisition-service.js";
import { ProcurementEvents } from "../src/domain/events.js";
import {
  assertDomainError,
  assertEmitted,
  buildModule,
  d,
  id,
  usd,
  type TestContext,
} from "./helpers.js";

const REQUESTER = id("user_requester");

function policyWithSteps(ctx: TestContext) {
  return ctx.module.approvalService.createPolicy(ctx.tenant, {
    code: "PR_TWO_STEP",
    name: "Two step",
    documentType: "requisition",
    currency: "USD",
    rules: [
      {
        code: "SMALL",
        minAmountMinor: 0,
        maxAmountMinor: 100_000,
        steps: [
          { sequence: 1, name: "Manager", roleCode: "manager", slaHours: 24, escalationRoleCode: "finance" },
        ],
      },
      {
        code: "LARGE",
        minAmountMinor: 100_000,
        steps: [
          { sequence: 1, name: "Manager", roleCode: "manager", slaHours: 24, escalationRoleCode: "finance" },
          { sequence: 2, name: "Finance", roleCode: "finance", quorum: 2, slaHours: 48 },
        ],
      },
    ],
  });
}

function requisition(ctx: TestContext, unitPriceMinor: number, quantity = 1) {
  const created = ctx.module.requisitionService.create(ctx.tenant, {
    title: "Approval fixture",
    requesterId: REQUESTER,
    costCenter: "CC-100",
    currency: "USD",
    neededBy: d("2026-05-01"),
    deliverTo: "HQ",
    lines: [
      lineInput({
        description: "Widget",
        categoryCode: "IND.OFFICE",
        quantity,
        uom: "EA",
        unitPriceMinor,
        currency: "USD",
      }),
    ],
  });
  return created;
}

describe("approval policies", () => {
  it("selects the rule whose amount band covers the document", () => {
    const ctx = buildModule();
    const policy = policyWithSteps(ctx);
    assert.equal(policy.selectRule({ amount: usd(50_000) })?.code, "SMALL");
    assert.equal(policy.selectRule({ amount: usd(250_000) })?.code, "LARGE");
  });

  it("prefers a rule scoped to the document's category over the generic band", () => {
    const ctx = buildModule();
    const policy = policyWithSteps(ctx);
    ctx.module.approvalService.addRule(ctx.tenant, policy.code, {
      code: "IT_HARDWARE",
      minAmountMinor: 0,
      categoryCodes: ["IT.HARDWARE"],
      steps: [{ sequence: 1, name: "IT director", roleCode: "it_director" }],
    });
    const chosen = policy.selectRule({ amount: usd(50_000), categoryCodes: ["IT.HARDWARE"] });
    assert.equal(chosen?.code, "IT_HARDWARE");
  });

  it("refuses a second policy with the same code", () => {
    const ctx = buildModule();
    policyWithSteps(ctx);
    assertDomainError(() => policyWithSteps(ctx), "POLICY_EXISTS");
  });

  it("fails the request when no active policy covers the amount", () => {
    const ctx = buildModule();
    const requisitionWithoutPolicy = requisition(ctx, 10_000);
    assertDomainError(
      () => ctx.module.requisitionService.submit(ctx.tenant, requisitionWithoutPolicy.id),
      "NO_APPROVAL_POLICY",
    );
  });

  it("ignores deactivated policies when matching", () => {
    const ctx = buildModule();
    const policy = policyWithSteps(ctx);
    ctx.module.approvalService.setPolicyActive(ctx.tenant, policy.code, false);
    const doc = requisition(ctx, 10_000);
    assertDomainError(
      () => ctx.module.requisitionService.submit(ctx.tenant, doc.id),
      "NO_APPROVAL_POLICY",
    );
  });
});

describe("approval chains", () => {
  it("advances step by step and only approves at the end", () => {
    const ctx = buildModule();
    policyWithSteps(ctx);
    const doc = requisition(ctx, 150_000);
    ctx.module.requisitionService.submit(ctx.tenant, doc.id);

    const request = ctx.module.approvalService.pendingForDocument(ctx.tenant, doc.id);
    assert.ok(request);
    assert.equal(request.currentStep?.name, "Manager");

    ctx.module.approvalService.approve(ctx.tenant, request.id, {
      approverId: id("user_manager"),
      roles: ["manager"],
    });
    assert.equal(request.status, "pending");
    assert.equal(request.currentStep?.name, "Finance");
    assert.equal(doc.status, "pending_approval");
  });

  it("holds a quorum step until enough distinct approvers sign", () => {
    const ctx = buildModule();
    policyWithSteps(ctx);
    const doc = requisition(ctx, 150_000);
    ctx.module.requisitionService.submit(ctx.tenant, doc.id);
    const request = ctx.module.approvalService.pendingForDocument(ctx.tenant, doc.id);
    assert.ok(request);

    ctx.module.approvalService.approve(ctx.tenant, request.id, {
      approverId: id("user_manager"),
      roles: ["manager"],
    });
    ctx.module.approvalService.approve(ctx.tenant, request.id, {
      approverId: id("user_finance_a"),
      roles: ["finance"],
    });
    assert.equal(request.status, "pending");
    assert.equal(request.currentStep?.remainingApprovals, 1);

    ctx.module.approvalService.approve(ctx.tenant, request.id, {
      approverId: id("user_finance_b"),
      roles: ["finance"],
    });
    assert.equal(request.status, "approved");
    assert.equal(doc.status, "approved");
  });

  it("counts one approver only once against a quorum", () => {
    const ctx = buildModule();
    policyWithSteps(ctx);
    const doc = requisition(ctx, 150_000);
    ctx.module.requisitionService.submit(ctx.tenant, doc.id);
    const request = ctx.module.approvalService.pendingForDocument(ctx.tenant, doc.id);
    assert.ok(request);
    ctx.module.approvalService.approve(ctx.tenant, request.id, {
      approverId: id("user_manager"),
      roles: ["manager"],
    });
    ctx.module.approvalService.approve(ctx.tenant, request.id, {
      approverId: id("user_finance_a"),
      roles: ["finance"],
    });
    assertDomainError(
      () =>
        ctx.module.approvalService.approve(ctx.tenant, request.id, {
          approverId: id("user_finance_a"),
          roles: ["finance"],
        }),
      "DUPLICATE_DECISION",
    );
  });

  it("blocks the requester from approving their own document", () => {
    const ctx = buildModule();
    policyWithSteps(ctx);
    const doc = requisition(ctx, 50_000);
    ctx.module.requisitionService.submit(ctx.tenant, doc.id);
    const request = ctx.module.approvalService.pendingForDocument(ctx.tenant, doc.id);
    assert.ok(request);
    assertDomainError(
      () =>
        ctx.module.approvalService.approve(ctx.tenant, request.id, {
          approverId: REQUESTER,
          roles: ["manager"],
        }),
      "SELF_APPROVAL",
    );
  });

  it("blocks someone without the step's role", () => {
    const ctx = buildModule();
    policyWithSteps(ctx);
    const doc = requisition(ctx, 50_000);
    ctx.module.requisitionService.submit(ctx.tenant, doc.id);
    const request = ctx.module.approvalService.pendingForDocument(ctx.tenant, doc.id);
    assert.ok(request);
    assertDomainError(
      () =>
        ctx.module.approvalService.approve(ctx.tenant, request.id, {
          approverId: id("user_intern"),
          roles: ["viewer"],
        }),
      "NOT_AN_APPROVER",
    );
  });

  it("rejection stops the chain and rejects the document", () => {
    const ctx = buildModule();
    policyWithSteps(ctx);
    const doc = requisition(ctx, 150_000);
    ctx.module.requisitionService.submit(ctx.tenant, doc.id);
    const request = ctx.module.approvalService.pendingForDocument(ctx.tenant, doc.id);
    assert.ok(request);

    ctx.module.approvalService.reject(ctx.tenant, request.id, {
      approverId: id("user_manager"),
      roles: ["manager"],
      reason: "Not in this quarter's budget",
    });
    assert.equal(request.status, "rejected");
    assert.equal(request.steps[1].status, "skipped");
    assert.equal(doc.status, "rejected");
    assertEmitted(ctx.module, ProcurementEvents.ApprovalCompleted);
  });

  it("delegation entitles the stand-in without removing the original approver", () => {
    const ctx = buildModule();
    policyWithSteps(ctx);
    const doc = requisition(ctx, 50_000);
    ctx.module.requisitionService.submit(ctx.tenant, doc.id);
    const request = ctx.module.approvalService.pendingForDocument(ctx.tenant, doc.id);
    assert.ok(request);

    ctx.module.approvalService.delegate(ctx.tenant, request.id, {
      fromApproverId: id("user_manager"),
      toApproverId: id("user_deputy"),
      roles: ["manager"],
      reason: "Annual leave",
    });
    ctx.module.approvalService.approve(ctx.tenant, request.id, {
      approverId: id("user_deputy"),
      roles: ["viewer"],
    });
    assert.equal(request.status, "approved");
  });

  it("refuses to delegate approval back to the requester", () => {
    const ctx = buildModule();
    policyWithSteps(ctx);
    const doc = requisition(ctx, 50_000);
    ctx.module.requisitionService.submit(ctx.tenant, doc.id);
    const request = ctx.module.approvalService.pendingForDocument(ctx.tenant, doc.id);
    assert.ok(request);
    assertDomainError(
      () =>
        ctx.module.approvalService.delegate(ctx.tenant, request.id, {
          fromApproverId: id("user_manager"),
          toApproverId: REQUESTER,
          roles: ["manager"],
          reason: "Convenient",
        }),
      "SELF_APPROVAL",
    );
  });

  it("escalation only opens once the SLA has lapsed", () => {
    const ctx = buildModule("2026-03-02");
    policyWithSteps(ctx);
    const doc = requisition(ctx, 50_000);
    ctx.module.requisitionService.submit(ctx.tenant, doc.id);
    const request = ctx.module.approvalService.pendingForDocument(ctx.tenant, doc.id);
    assert.ok(request);

    assertDomainError(
      () => ctx.module.approvalService.escalate(ctx.tenant, request.id, { reason: "Too slow" }),
      "NOT_OVERDUE",
    );

    ctx.clock.advanceHours(25);
    assert.equal(ctx.module.approvalService.overdue(ctx.tenant).length, 1);
    const escalated = ctx.module.approvalService.sweepOverdue(ctx.tenant);
    assert.equal(escalated.length, 1);
    assertEmitted(ctx.module, ProcurementEvents.ApprovalEscalated);

    // The escalation role can now decide the step the manager sat on.
    ctx.module.approvalService.approve(ctx.tenant, request.id, {
      approverId: id("user_finance"),
      roles: ["finance"],
    });
    assert.equal(request.status, "approved");
  });

  it("lists pending work for an approver's roles", () => {
    const ctx = buildModule();
    policyWithSteps(ctx);
    const doc = requisition(ctx, 50_000);
    ctx.module.requisitionService.submit(ctx.tenant, doc.id);

    assert.equal(
      ctx.module.approvalService.listPending(ctx.tenant, { roles: ["manager"] }).length,
      1,
    );
    assert.equal(
      ctx.module.approvalService.listPending(ctx.tenant, { roles: ["cfo"] }).length,
      0,
    );
  });
});
