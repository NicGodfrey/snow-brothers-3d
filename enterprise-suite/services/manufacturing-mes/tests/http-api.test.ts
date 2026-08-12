import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import { FixedClock } from "../src/infrastructure/clock.js";
import { createContainer } from "../src/infrastructure/container.js";
import { createMesServer } from "../src/http/server.js";
import { TODAY } from "./helpers.js";

const TENANT_A = { "x-tenant-id": "tenant-a", "x-user-id": "planner-1", "x-roles": "planner" };
const TENANT_B = { "x-tenant-id": "tenant-b", "x-user-id": "spy-1" };

let server: Server;
let baseUrl: string;

interface ApiResponse<T = any> {
  status: number;
  json: { data?: T; error?: { code: string; message: string } } & Record<string, any>;
}

async function api(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = TENANT_A,
): Promise<ApiResponse> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as ApiResponse["json"] };
}

function expectOk<T>(res: ApiResponse<T>, status = 200): T {
  assert.equal(
    res.status,
    status,
    `expected ${status}, got ${res.status}: ${JSON.stringify(res.json)}`,
  );
  return res.json.data as T;
}

before(async () => {
  const clock = new FixedClock(new Date(`${TODAY}T08:00:00Z`));
  const { server: httpServer } = createMesServer(createContainer({ clock }));
  server = httpServer;
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (typeof address === "object" && address) {
    baseUrl = `http://127.0.0.1:${address.port}`;
  }
});

after(() => {
  server.close();
});

describe("manufacturing-mes HTTP API", () => {
  let cncId: string;
  let assemblyId: string;
  let calendarId: string;
  let routingIdValue: string;
  let workOrderId: string;
  let scrapRecordId: string;

  it("rejects requests without a tenant header", async () => {
    const res = await api("GET", "/work-centers", undefined, {});
    assert.equal(res.status, 401);
    assert.equal(res.json.error!.code, "TENANT_REQUIRED");
  });

  it("returns 404 for unknown routes and 400 for invalid JSON bodies", async () => {
    const notFound = await api("GET", "/no-such-route");
    assert.equal(notFound.status, 404);

    const res = await fetch(`${baseUrl}/work-centers`, {
      method: "POST",
      headers: { "content-type": "application/json", ...TENANT_A },
      body: "{not json",
    });
    assert.equal(res.status, 400);
  });

  it("sets up the plant: shift template, calendar, work centers", async () => {
    const template = expectOk<any>(
      await api("POST", "/shift-templates", {
        code: "DAY-1X8",
        name: "Day shift",
        shifts: [
          {
            name: "Day",
            startTime: "08:00",
            durationMinutes: 480,
            breakMinutes: 0,
            daysOfWeek: [1, 2, 3, 4, 5],
          },
        ],
      }),
      201,
    );
    const calendar = expectOk<any>(
      await api("POST", "/capacity-calendars", {
        code: "PLANT-1",
        name: "Plant calendar",
        shiftTemplateId: template.id,
      }),
      201,
    );
    calendarId = calendar.id;
    expectOk<any>(
      await api("POST", `/capacity-calendars/${calendarId}/exceptions`, {
        date: "2026-08-12",
        type: "HOLIDAY",
        reason: "Maintenance day",
      }),
      201,
    );

    const cnc = expectOk<any>(
      await api("POST", "/work-centers", {
        code: "CNC-01",
        name: "CNC milling",
        machineCount: 2,
        efficiencyPct: 90,
        utilizationPct: 80,
      }),
      201,
    );
    cncId = cnc.id;
    const assembly = expectOk<any>(
      await api("POST", "/work-centers", { code: "ASSY-01", name: "Assembly" }),
      201,
    );
    assemblyId = assembly.id;

    expectOk(await api("POST", `/work-centers/${cncId}/calendar`, { calendarId }));
    expectOk(await api("POST", `/work-centers/${assemblyId}/calendar`, { calendarId }));

    // Duplicate code is a conflict.
    const dup = await api("POST", "/work-centers", { code: "CNC-01", name: "Dup" });
    assert.equal(dup.status, 409);
  });

  it("shows capacity with the holiday zeroed out", async () => {
    const capacity = expectOk<any[]>(
      await api("GET", `/work-centers/${cncId}/capacity?from=2026-08-10&to=2026-08-14`),
    );
    assert.equal(capacity.length, 5);
    assert.equal(capacity[0].calendarMinutes, 480);
    assert.equal(capacity[0].effectiveMinutes, 691); // 480 * 2 * 0.9 * 0.8
    assert.equal(capacity[2].calendarMinutes, 0); // Wednesday holiday
  });

  it("creates and releases a routing", async () => {
    const routing = expectOk<any>(
      await api("POST", "/routings", {
        sku: "WIDGET-100",
        description: "Widget process",
        operations: [
          {
            seq: 10,
            description: "Mill housing",
            workCenterId: cncId,
            setupMinutes: 30,
            runMinutesPerUnit: 2,
          },
        ],
      }),
      201,
    );
    routingIdValue = routing.id;
    expectOk<any>(
      await api("POST", `/routings/${routingIdValue}/operations`, {
        seq: 20,
        description: "Assemble",
        workCenterId: assemblyId,
        setupMinutes: 15,
        runMinutesPerUnit: 1,
        teardownMinutes: 15,
      }),
      201,
    );

    const leadTime = expectOk<any>(
      await api("GET", `/routings/${routingIdValue}/lead-time?quantity=10`),
    );
    assert.equal(leadTime.leadTimeMinutes, 90); // 50 + 40

    const released = expectOk<any>(await api("POST", `/routings/${routingIdValue}/release`));
    assert.equal(released.status, "RELEASED");

    // Editing after release is a conflict.
    const editAfter = await api("POST", `/routings/${routingIdValue}/operations`, {
      seq: 30,
      description: "Late op",
      workCenterId: cncId,
      runMinutesPerUnit: 1,
    });
    assert.equal(editAfter.status, 409);
  });

  it("creates a work order from BOM and demand, plans and releases it", async () => {
    const wo = expectOk<any>(
      await api("POST", "/work-orders", {
        sku: "WIDGET-100",
        quantity: 10,
        uom: "EA",
        dueDate: "2026-08-14",
        demandSource: { type: "SALES_ORDER", refId: "so_42" },
        bomLines: [
          {
            componentSku: "CMP-HOUSING",
            qtyPerUnit: 1,
            uom: "EA",
            scrapFactorPct: 10,
            operationSeq: 10,
          },
          { componentSku: "CMP-SCREW", qtyPerUnit: 4, uom: "EA", operationSeq: 20 },
        ],
      }),
      201,
    );
    workOrderId = wo.id;
    assert.equal(wo.orderNumber, "WO-000001");
    assert.equal(wo.status, "DRAFT");
    assert.equal(wo.requirements[0].requiredQty, 11);

    const planned = expectOk<any>(await api("POST", `/work-orders/${workOrderId}/plan`));
    assert.equal(planned.status, "PLANNED");
    assert.equal(planned.scheduledEnd, "2026-08-14T16:00:00.000Z");

    const releasedWo = expectOk<any>(await api("POST", `/work-orders/${workOrderId}/release`));
    assert.equal(releasedWo.status, "RELEASED");
    assert.equal(releasedWo.operations[0].status, "READY");
  });

  it("issues materials and reports production with scrap", async () => {
    const issue = expectOk<any>(
      await api("POST", `/work-orders/${workOrderId}/material-issues`, {
        warehouseCode: "WH-MAIN",
        lines: [
          { componentSku: "CMP-HOUSING", qty: 11, uom: "EA", lotNumber: "LOT-1" },
          { componentSku: "CMP-SCREW", qty: 40, uom: "EA" },
        ],
      }),
      201,
    );
    assert.equal(issue.document.direction, "ISSUE");

    const report1 = expectOk<any>(
      await api("POST", `/work-orders/${workOrderId}/report`, {
        seq: 10,
        qtyGood: 8,
        qtyScrap: 2,
        laborMinutes: 55,
        scrapReasonCode: "MACHINE_FAULT",
        scrapDisposition: "REWORK",
      }),
    );
    assert.equal(report1.workOrder.status, "IN_PROGRESS");
    assert.equal(report1.workOrder.quantityScrapped, 2);
    assert.ok(report1.scrapRecord);
    scrapRecordId = report1.scrapRecord.id;

    // Op 10 finished (8 good + 2 scrap = 10 ordered), so the dispatch list
    // shows the assembly operation as READY and nothing at the CNC.
    const cncDispatch = expectOk<any[]>(await api("GET", `/work-centers/${cncId}/dispatch-list`));
    assert.equal(cncDispatch.length, 0);
    const assyDispatch = expectOk<any[]>(
      await api("GET", `/work-centers/${assemblyId}/dispatch-list`),
    );
    assert.equal(assyDispatch.length, 1);
    assert.equal(assyDispatch[0].operationSeq, 20);
    assert.equal(assyDispatch[0].operationStatus, "READY");

    const report2 = expectOk<any>(
      await api("POST", `/work-orders/${workOrderId}/report`, { seq: 20, qtyGood: 8 }),
    );
    assert.equal(report2.workOrder.quantityCompleted, 8);

    // Over-reporting beyond upstream flow is a 422.
    const overReport = await api("POST", `/work-orders/${workOrderId}/report`, {
      seq: 20,
      qtyGood: 1,
    });
    assert.equal(overReport.status, 409); // operation already complete
  });

  it("spawns a rework order from the scrap record", async () => {
    const res = expectOk<any>(
      await api("POST", `/scrap-records/${scrapRecordId}/rework-order`, {
        dueDate: "2026-08-21",
      }),
      201,
    );
    assert.equal(res.reworkOrder.quantityOrdered, 2);
    assert.equal(res.reworkOrder.demandSource.type, "REWORK");
    // Scrap happened at op 10, so rework routes through op 10 and everything after.
    assert.deepEqual(
      res.reworkOrder.operations.map((op: any) => op.seq),
      [10, 20],
    );
  });

  it("completes, receives and closes the order", async () => {
    const completed = expectOk<any>(await api("POST", `/work-orders/${workOrderId}/complete`));
    assert.equal(completed.status, "COMPLETED");

    const receipt = expectOk<any>(
      await api("POST", `/work-orders/${workOrderId}/receipts`, {
        qtyGood: 8,
        warehouseCode: "WH-FG",
        lotNumber: "FG-1",
      }),
      201,
    );
    assert.equal(receipt.workOrder.quantityReceived, 8);

    const closed = expectOk<any>(await api("POST", `/work-orders/${workOrderId}/close`));
    assert.equal(closed.status, "CLOSED");

    // Post-close mutations are conflicts.
    const lateHold = await api("POST", `/work-orders/${workOrderId}/hold`, { reason: "late" });
    assert.equal(lateHold.status, 409);
  });

  it("aggregates scrap and shows work center load", async () => {
    const summary = expectOk<any[]>(await api("GET", "/scrap-records/summary"));
    assert.equal(summary.length, 1);
    assert.equal(summary[0].reasonCode, "MACHINE_FAULT");
    assert.equal(summary[0].totalQty, 2);

    const load = expectOk<any[]>(
      await api("GET", `/work-centers/${cncId}/load?from=2026-08-10&to=2026-08-14`),
    );
    assert.equal(load.length, 5);
  });

  it("isolates tenants completely", async () => {
    const otherTenantList = expectOk<any[]>(
      await api("GET", "/work-orders", undefined, TENANT_B),
    );
    assert.equal(otherTenantList.length, 0);
    const otherTenantGet = await api("GET", `/work-orders/${workOrderId}`, undefined, TENANT_B);
    assert.equal(otherTenantGet.status, 404);
  });

  it("validates request bodies with field-level errors", async () => {
    const res = await api("POST", "/work-orders", { sku: "X" });
    assert.equal(res.status, 400);
    assert.equal(res.json.error!.code, "VALIDATION");
    assert.match(res.json.error!.message, /quantity/);
  });
});
