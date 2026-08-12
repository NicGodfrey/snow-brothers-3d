import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HcmEvents } from "../src/domain/events.js";
import { assertDomainError, buildModule, eventTypes } from "./helpers.js";

describe("org units", () => {
  it("creates a hierarchy with nesting rules enforced", () => {
    const { module, tenant } = buildModule();
    const org = module.orgService;

    const company = org.createOrgUnit(tenant, { code: "co", name: "Co", kind: "company" });
    assert.equal(company.code, "CO"); // codes are normalized to upper case
    const division = org.createOrgUnit(tenant, {
      code: "DIV",
      name: "Division",
      kind: "division",
      parentId: company.id,
    });
    const team = org.createOrgUnit(tenant, {
      code: "TEAM",
      name: "Team",
      kind: "team",
      parentId: division.id,
    });
    assert.equal(team.parentId, division.id);
    assert.ok(eventTypes(module).includes(HcmEvents.OrgUnitCreated));

    // a team cannot hang directly under a company
    assertDomainError(
      () => org.createOrgUnit(tenant, { code: "T2", name: "T2", kind: "team", parentId: company.id }),
      "INVALID_ORG_NESTING",
    );
    // a company cannot have a parent
    assertDomainError(
      () => org.createOrgUnit(tenant, { code: "C2", name: "C2", kind: "company", parentId: division.id }),
      "INVALID_ORG_NESTING",
    );
    // non-company units require a parent
    assertDomainError(
      () => org.createOrgUnit(tenant, { code: "D2", name: "D2", kind: "division" }),
      "INVALID_ORG_NESTING",
    );
  });

  it("rejects duplicate codes and malformed codes", () => {
    const { module, tenant } = buildModule();
    module.orgService.createOrgUnit(tenant, { code: "ACME", name: "Acme", kind: "company" });
    assertDomainError(
      () => module.orgService.createOrgUnit(tenant, { code: "acme", name: "Other", kind: "company" }),
      "CONFLICT",
    );
    assertDomainError(
      () => module.orgService.createOrgUnit(tenant, { code: "a b", name: "Bad", kind: "company" }),
      "INVALID_ORG_CODE",
    );
  });

  it("prevents cycles and kind violations when moving units", () => {
    const { module, tenant } = buildModule();
    const org = module.orgService;
    const company = org.createOrgUnit(tenant, { code: "CO", name: "Co", kind: "company" });
    const a = org.createOrgUnit(tenant, { code: "AA", name: "A", kind: "division", parentId: company.id });
    const b = org.createOrgUnit(tenant, { code: "BB", name: "B", kind: "department", parentId: a.id });
    const c = org.createOrgUnit(tenant, { code: "CC", name: "C", kind: "team", parentId: b.id });

    // moving A (or B) under C would make the unit its own ancestor
    assertDomainError(() => org.moveOrgUnit(tenant, a.id, c.id), "ORG_CYCLE");
    assertDomainError(() => org.moveOrgUnit(tenant, b.id, c.id), "ORG_CYCLE");
    assertDomainError(() => org.moveOrgUnit(tenant, a.id, a.id), "ORG_CYCLE");

    // kind rules still apply for non-cyclic targets: a department cannot sit under a team
    const d2 = org.createOrgUnit(tenant, { code: "DD", name: "D2", kind: "division", parentId: company.id });
    const t2 = org.createOrgUnit(tenant, { code: "TT", name: "T2", kind: "team", parentId: d2.id });
    assertDomainError(() => org.moveOrgUnit(tenant, b.id, t2.id), "INVALID_ORG_NESTING");

    // a legitimate move works and is recorded
    org.moveOrgUnit(tenant, b.id, d2.id);
    assert.equal(org.getOrgUnit(tenant, b.id).parentId, d2.id);
  });

  it("deactivation requires inactive children and no filled positions", () => {
    const { module, tenant } = buildModule();
    const org = module.orgService;
    const company = org.createOrgUnit(tenant, { code: "CO", name: "Co", kind: "company" });
    const division = org.createOrgUnit(tenant, {
      code: "DIV",
      name: "Div",
      kind: "division",
      parentId: company.id,
    });

    assertDomainError(() => org.deactivateOrgUnit(tenant, company.id), "CONFLICT");

    const position = org.openPosition(tenant, { orgUnitId: division.id, title: "Engineer", grade: "IC3" });
    position.fill(module.employeeService.hire(tenant, {
      employeeNumber: "E-1",
      firstName: "A",
      lastName: "B",
      email: "a@b.test",
      hireDate: module.clock.today(),
    }).id);
    module.repos.positions.save(position);
    assertDomainError(() => org.deactivateOrgUnit(tenant, division.id), "CONFLICT");

    position.vacate();
    module.repos.positions.save(position);
    const deactivated = org.deactivateOrgUnit(tenant, division.id);
    assert.equal(deactivated.status, "inactive");
    // the open position was eliminated as part of deactivation
    assert.equal(org.getPosition(tenant, position.id).status, "eliminated");
    // now the company can go too
    assert.equal(org.deactivateOrgUnit(tenant, company.id).status, "inactive");
  });

  it("subtree returns the full breadth-first closure", () => {
    const { module, tenant } = buildModule();
    const org = module.orgService;
    const company = org.createOrgUnit(tenant, { code: "CO", name: "Co", kind: "company" });
    const d1 = org.createOrgUnit(tenant, { code: "D1", name: "D1", kind: "division", parentId: company.id });
    org.createOrgUnit(tenant, { code: "D2", name: "D2", kind: "division", parentId: company.id });
    org.createOrgUnit(tenant, { code: "T1", name: "T1", kind: "team", parentId: d1.id });
    assert.equal(org.subtree(tenant, company.id).length, 4);
    assert.equal(org.subtree(tenant, d1.id).length, 2);
  });
});

describe("positions", () => {
  it("runs the open → filled → vacated → eliminated lifecycle", () => {
    const { module, tenant } = buildModule();
    const org = module.orgService;
    const company = org.createOrgUnit(tenant, { code: "CO", name: "Co", kind: "company" });
    const position = org.openPosition(tenant, { orgUnitId: company.id, title: "Analyst", grade: "IC2" });
    const employee = module.employeeService.hire(tenant, {
      employeeNumber: "E-2",
      firstName: "C",
      lastName: "D",
      email: "c@d.test",
      hireDate: module.clock.today(),
    });

    position.fill(employee.id);
    assert.equal(position.status, "filled");
    assert.equal(position.currentEmployeeId, employee.id);
    assertDomainError(() => position.fill(employee.id), "POSITION_NOT_OPEN");
    assertDomainError(() => position.eliminate(), "POSITION_FILLED");

    position.vacate();
    assert.equal(position.status, "open");
    assert.equal(position.currentEmployeeId, undefined);
    position.eliminate();
    assert.equal(position.status, "eliminated");
    assertDomainError(() => position.eliminate(), "ALREADY_ELIMINATED");
  });

  it("freeze blocks filling until unfrozen", () => {
    const { module, tenant } = buildModule();
    const org = module.orgService;
    const company = org.createOrgUnit(tenant, { code: "CO", name: "Co", kind: "company" });
    const position = org.openPosition(tenant, { orgUnitId: company.id, title: "PM", grade: "IC4" });
    org.freezePosition(tenant, position.id, "budget freeze");
    assert.equal(position.status, "frozen");
    assert.equal(position.isFillable(), false);
    org.unfreezePosition(tenant, position.id);
    assert.equal(position.status, "open");
  });

  it("rejects reporting-line cycles", () => {
    const { module, tenant } = buildModule();
    const org = module.orgService;
    const company = org.createOrgUnit(tenant, { code: "CO", name: "Co", kind: "company" });
    const head = org.openPosition(tenant, { orgUnitId: company.id, title: "Head", grade: "M4" });
    const lead = org.openPosition(tenant, {
      orgUnitId: company.id,
      title: "Lead",
      grade: "M2",
      reportsToPositionId: head.id,
    });
    const ic = org.openPosition(tenant, {
      orgUnitId: company.id,
      title: "IC",
      grade: "IC3",
      reportsToPositionId: lead.id,
    });
    assertDomainError(() => org.changePositionReportsTo(tenant, head.id, ic.id), "POSITION_REPORT_CYCLE");
    assertDomainError(() => org.changePositionReportsTo(tenant, head.id, head.id), "POSITION_SELF_REPORT");
  });

  it("cannot open a position in an inactive unit or with a bad FTE", () => {
    const { module, tenant } = buildModule();
    const org = module.orgService;
    const company = org.createOrgUnit(tenant, { code: "CO", name: "Co", kind: "company" });
    assertDomainError(
      () => org.openPosition(tenant, { orgUnitId: company.id, title: "X", grade: "IC1", fte: 1.5 }),
      "INVALID_FTE",
    );
    org.deactivateOrgUnit(tenant, company.id);
    assertDomainError(
      () => org.openPosition(tenant, { orgUnitId: company.id, title: "X", grade: "IC1" }),
      "CONFLICT",
    );
  });
});
