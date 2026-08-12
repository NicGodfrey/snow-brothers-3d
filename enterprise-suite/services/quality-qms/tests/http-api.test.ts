/**
 * Black-box HTTP tests: real node:http server on an ephemeral port,
 * exercising routing, tenant headers, validation and error mapping.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import { createQualityQmsServer } from "../src/http/server.js";
import { createQualityQmsModule } from "../src/infrastructure/module.js";
import { FixedClock } from "../src/infrastructure/in-memory/clock.js";

const clock = new FixedClock("2026-08-12T09:00:00.000Z");
const module_ = createQualityQmsModule({ clock });
const server = createQualityQmsServer(module_);
let baseUrl = "";

const HEADERS = {
  "content-type": "application/json",
  "x-tenant-id": "tenant-http",
  "x-user-id": "user-api",
  "x-roles": "inspector",
};
const QM_HEADERS = { ...HEADERS, "x-user-id": "user-qm", "x-roles": "quality-manager" };

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))));

async function call(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = HEADERS,
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

test("health endpoint works without tenant headers", async () => {
  const res = await fetch(`${baseUrl}/health`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { status: string; service: string };
  assert.equal(body.status, "ok");
  assert.equal(body.service, "quality-qms");
});

test("requests without tenant headers are rejected with 401", async () => {
  const res = await fetch(`${baseUrl}/ncrs`);
  assert.equal(res.status, 401);
});

test("unknown routes return 404, invalid JSON returns 400", async () => {
  const notFound = await call("GET", "/nope");
  assert.equal(notFound.status, 404);

  const badJson = await fetch(`${baseUrl}/ncrs`, {
    method: "POST",
    headers: HEADERS,
    body: "{not json",
  });
  assert.equal(badJson.status, 400);
  const body = (await badJson.json()) as { error: { code: string } };
  assert.equal(body.error.code, "INVALID_JSON");
});

test("full inspection flow over HTTP: plan -> lot -> reject -> NCR + supplier event", async () => {
  // Create + activate plan
  const planRes = await call("POST", "/inspection-plans", {
    planCode: "QP-HTTP-01",
    name: "HTTP flow plan",
    targetType: "material",
    materialCode: "MAT-HTTP",
    samplingRule: { kind: "fixed", sampleSize: 5 },
    characteristics: [
      {
        code: "LEN",
        name: "Length",
        type: "quantitative",
        criticality: "major",
        quantitative: { unit: "mm", lowerLimit: 99, upperLimit: 101 },
      },
    ],
  });
  assert.equal(planRes.status, 201);
  const planId = planRes.json.id as string;

  const activateRes = await call("POST", `/inspection-plans/${planId}/activate`);
  assert.equal(activateRes.status, 200);
  assert.equal(activateRes.json.status, "active");

  // Create lot
  const lotRes = await call("POST", "/inspection-lots", {
    planId,
    origin: "goods-receipt",
    quantity: 200,
    uom: "EA",
    supplierId: "SUP-HTTP",
    purchaseOrderRef: "PO-HTTP-1",
  });
  assert.equal(lotRes.status, 201);
  const lotId = lotRes.json.id as string;
  assert.equal(lotRes.json.sampling.sampleSize, 5);

  // Start, record failing readings, complete
  assert.equal((await call("POST", `/inspection-lots/${lotId}/start`)).status, 200);
  const resultRes = await call("POST", `/inspection-lots/${lotId}/results/quantitative`, {
    characteristicCode: "LEN",
    readings: [100.2, 99.8, 102.5, 100.0, 98.1],
  });
  assert.equal(resultRes.status, 201);
  assert.equal(resultRes.json.results[0].evaluation, "fail");
  assert.equal(resultRes.json.results[0].statistics.outOfSpecCount, 2);

  assert.equal((await call("POST", `/inspection-lots/${lotId}/complete`)).status, 200);

  // Reject -> auto NCR + supplier event in the response
  const decisionRes = await call("POST", `/inspection-lots/${lotId}/decision`, {
    decision: "reject",
  });
  assert.equal(decisionRes.status, 200);
  assert.equal(decisionRes.json.lot.status, "decided");
  assert.ok(decisionRes.json.ncr.ncrNumber.startsWith("NCR-2026-"));
  assert.equal(decisionRes.json.supplierEvent.supplierId, "SUP-HTTP");

  // Supplier summary reflects it
  const summaryRes = await call("GET", "/supplier-quality/suppliers/SUP-HTTP/summary");
  assert.equal(summaryRes.status, 200);
  assert.equal(summaryRes.json.totalEvents, 1);
});

test("domain conflicts map to 409 and validation to 400", async () => {
  const ncrRes = await call("POST", "/ncrs", {
    title: "Conflict check",
    description: "desc",
    source: "internal",
    severity: "major",
  });
  assert.equal(ncrRes.status, 201);
  const ncrId = ncrRes.json.id as string;

  // draft -> containment is an illegal transition -> 409
  const conflict = await call("POST", `/ncrs/${ncrId}/containment/start`);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.json.error.code, "CONFLICT");

  // missing required field -> 400
  const invalid = await call("POST", "/ncrs", { title: "no description" });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.json.error.code, "VALIDATION");
});

test("disposition approval requires the quality-manager role over HTTP", async () => {
  const ncrRes = await call("POST", "/ncrs", {
    title: "Role check",
    description: "minor scratch",
    source: "internal",
    severity: "minor",
  });
  const ncrId = ncrRes.json.id as string;
  await call("POST", `/ncrs/${ncrId}/submit`);
  await call("POST", `/ncrs/${ncrId}/move-to-disposition`);
  await call("POST", `/ncrs/${ncrId}/disposition`, {
    type: "use-as-is",
    justification: "cosmetic",
  });

  const forbidden = await call("POST", `/ncrs/${ncrId}/disposition/approve`);
  assert.equal(forbidden.status, 403);

  const approved = await call("POST", `/ncrs/${ncrId}/disposition/approve`, undefined, QM_HEADERS);
  assert.equal(approved.status, 200);
  assert.ok(approved.json.disposition.approvedBy);
});

test("tenants are isolated over HTTP", async () => {
  const planRes = await call("POST", "/inspection-plans", {
    planCode: "QP-TENANT",
    name: "Tenant isolation",
    targetType: "process",
    samplingRule: { kind: "full" },
  });
  const planId = planRes.json.id as string;

  const crossTenant = await call("GET", `/inspection-plans/${planId}`, undefined, {
    ...HEADERS,
    "x-tenant-id": "tenant-someone-else",
  });
  assert.equal(crossTenant.status, 404);
});

test("outbox diagnostics endpoints expose pending events", async () => {
  const pendingBefore = await call("GET", "/outbox/pending");
  assert.ok(pendingBefore.json.items.length > 0);

  const drained = await call("POST", "/outbox/drain");
  assert.equal(drained.json.items.length, pendingBefore.json.items.length);

  const pendingAfter = await call("GET", "/outbox/pending");
  assert.equal(pendingAfter.json.items.length, 0);
});

test("audit checklist flow over HTTP", async () => {
  const templateRes = await call("POST", "/audit-templates", {
    code: "SUP-PROC",
    title: "Supplier process audit",
    sections: [
      {
        title: "Process control",
        items: [
          { question: "Is SPC in place?", answerType: "conformity" },
          { question: "Rate housekeeping", answerType: "score" },
        ],
      },
    ],
  });
  assert.equal(templateRes.status, 201);
  const templateId = templateRes.json.id as string;
  await call("POST", `/audit-templates/${templateId}/activate`);

  const auditRes = await call("POST", "/audits", {
    templateId,
    auditType: "supplier",
    scope: "Full process walk",
    auditee: { supplierId: "SUP-AUD" },
    plannedFrom: "2026-09-01T08:00:00Z",
    plannedTo: "2026-09-02T17:00:00Z",
  });
  assert.equal(auditRes.status, 201);
  const auditId = auditRes.json.id as string;
  const items = auditRes.json.sections.flatMap((s: any) => s.items);

  await call("POST", `/audits/${auditId}/start`);
  await call("POST", `/audits/${auditId}/responses`, {
    itemId: items[0].id,
    answer: { kind: "conformity", value: "conform" },
  });
  await call("POST", `/audits/${auditId}/responses`, {
    itemId: items[1].id,
    answer: { kind: "score", value: 4 },
  });
  await call("POST", `/audits/${auditId}/review`);
  const completeRes = await call("POST", `/audits/${auditId}/complete`, { summary: "ok" });
  assert.equal(completeRes.status, 200);
  assert.equal(completeRes.json.result.scorePercent, 90);
  assert.equal(completeRes.json.result.outcome, "pass");

  const closeRes = await call("POST", `/audits/${auditId}/close`);
  assert.equal(closeRes.status, 200);
  assert.equal(closeRes.json.status, "closed");
});
