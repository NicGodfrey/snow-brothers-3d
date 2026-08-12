import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createHcmServer } from "../src/http/server.js";
import { buildSeededModule, d, type SeededContext } from "./helpers.js";

let ctx: SeededContext;
let server: Server;
let baseUrl: string;

interface CallOptions {
  method?: string;
  body?: unknown;
  user?: string;
  roles?: string;
  tenant?: string | null;
}

async function call(path: string, options: CallOptions = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.tenant !== null) headers["x-tenant-id"] = options.tenant ?? "acme";
  headers["x-user-id"] = options.user ?? "user_hr";
  if (options.roles) headers["x-roles"] = options.roles;
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : undefined };
}

describe("HTTP API", () => {
  before(async () => {
    ctx = buildSeededModule();
    server = createHcmServer(ctx.module);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(() => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))));

  it("serves health without a tenant header", async () => {
    const res = await call("/health", { tenant: null });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "ok");
  });

  it("rejects requests without x-tenant-id", async () => {
    const res = await call("/employees", { tenant: null });
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, "MISSING_TENANT");
  });

  it("returns 404 for unknown routes", async () => {
    const res = await call("/no-such-resource");
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, "ROUTE_NOT_FOUND");
  });

  it("enforces role-based access on privileged endpoints", async () => {
    const forbidden = await call("/employees", {
      body: { employeeNumber: "X-1" },
      roles: "viewer",
    });
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.body.error.code, "FORBIDDEN");
  });

  it("validates request bodies with field-level errors", async () => {
    const res = await call("/employees", {
      roles: "hr_admin",
      body: { firstName: "No", lastName: "Number", email: "x@y.test", hireDate: "2026-01-01" },
    });
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, "VALIDATION");
    assert.equal(res.body.error.details.field, "employeeNumber");
  });

  it("runs an onboarding flow over HTTP: hire → contract → activate", async () => {
    const positionRes = await call("/positions", {
      roles: "hr_admin",
      body: {
        orgUnitId: ctx.seed.platformTeam.id,
        title: "Backend Engineer",
        grade: "IC3",
        jobFamily: "engineering",
      },
    });
    assert.equal(positionRes.status, 201);

    const employeeRes = await call("/employees", {
      roles: "hr_admin",
      body: {
        employeeNumber: "ACME-0900",
        firstName: "Noor",
        lastName: "Haddad",
        email: "noor@acme.test",
        hireDate: "2026-02-01",
        managerEmployeeId: ctx.seed.cto.id,
      },
    });
    assert.equal(employeeRes.status, 201);
    assert.equal(employeeRes.body.status, "active");

    const contractRes = await call("/contracts", {
      roles: "hr_admin",
      body: {
        employeeId: employeeRes.body.id,
        positionId: positionRes.body.id,
        contractType: "permanent",
        startDate: "2026-02-01",
        baseSalary: { amountMinor: 10_800_000, currency: "USD" },
        payFrequency: "monthly",
      },
    });
    assert.equal(contractRes.status, 201);
    assert.equal(contractRes.body.status, "draft");

    const activateRes = await call(`/contracts/${contractRes.body.id}/activate`, {
      roles: "hr_admin",
      body: {},
    });
    assert.equal(activateRes.status, 200);
    assert.equal(activateRes.body.status, "active");

    const positionAfter = await call(`/positions/${positionRes.body.id}`);
    assert.equal(positionAfter.body.status, "filled");
    assert.equal(positionAfter.body.currentEmployeeId, employeeRes.body.id);

    const compensation = await call(`/employees/${employeeRes.body.id}/compensation`);
    assert.equal(compensation.status, 200);
    assert.equal(compensation.body.baseSalary.amountMinor, 10_800_000);
    assert.equal(compensation.body.perPeriodBase.amountMinor, 900_000);
  });

  it("runs the leave workflow over HTTP with approval RBAC", async () => {
    const employeeId = ctx.seed.staffEngineer.id;

    const grantRes = await call(`/employees/${employeeId}/leave-balances/annual/grant`, {
      roles: "hr_admin",
      body: { year: 2026 },
    });
    assert.equal(grantRes.status, 200);
    assert.equal(grantRes.body.entitledDays, 24);

    const requestRes = await call("/leave-requests", {
      body: {
        employeeId,
        leaveType: "annual",
        startDate: "2026-04-27",
        endDate: "2026-05-01",
        reason: "spring break",
      },
    });
    assert.equal(requestRes.status, 201);
    assert.equal(requestRes.body.workingDays, 4); // May 1 is a seeded public holiday

    // a viewer cannot approve
    const viewerApprove = await call(`/leave-requests/${requestRes.body.id}/approve`, {
      roles: "viewer",
      body: {},
    });
    assert.equal(viewerApprove.status, 403);

    // the requester cannot self-approve even with the manager role
    const selfApprove = await call(`/leave-requests/${requestRes.body.id}/approve`, {
      roles: "manager",
      user: employeeId,
      body: {},
    });
    assert.equal(selfApprove.status, 403);
    assert.equal(selfApprove.body.error.code, "SELF_APPROVAL");

    const approve = await call(`/leave-requests/${requestRes.body.id}/approve`, {
      roles: "manager",
      user: ctx.seed.cto.id,
      body: {},
    });
    assert.equal(approve.status, 200);
    assert.equal(approve.body.status, "approved");

    const balances = await call(`/employees/${employeeId}/leave-balances?year=2026`);
    assert.equal(balances.status, 200);
    const annual = balances.body.items.find((b: { leaveType: string }) => b.leaveType === "annual");
    assert.equal(annual.takenDays, 4);
    assert.equal(annual.availableDays, 20);
  });

  it("exposes payslip previews with stub-marked deductions", async () => {
    const res = await call(`/employees/${ctx.seed.staffEngineer.id}/payslip-preview?year=2026&month=2`);
    assert.equal(res.status, 200);
    assert.equal(res.body.stub, true);
    assert.ok(res.body.grossMinor > 0);
    assert.ok(res.body.lines.some((l: { code: string }) => l.code === "income_tax_stub"));
  });

  it("maps domain conflicts to HTTP 409", async () => {
    const res = await call("/attendance-periods", {
      body: { employeeId: ctx.seed.staffEngineer.id, year: 2026, month: 3 },
    });
    assert.equal(res.status, 201);
    const dupe = await call("/attendance-periods", {
      body: { employeeId: ctx.seed.staffEngineer.id, year: 2026, month: 3 },
    });
    assert.equal(dupe.status, 409);
    assert.equal(dupe.body.error.code, "CONFLICT");
  });

  it("drains the outbox exactly once", async () => {
    const first = await call("/outbox/drain", { body: {} });
    assert.equal(first.status, 200);
    assert.ok(first.body.count > 0); // events from the flows above
    const second = await call("/outbox/drain", { body: {} });
    assert.equal(second.body.count, 0);
  });
});
