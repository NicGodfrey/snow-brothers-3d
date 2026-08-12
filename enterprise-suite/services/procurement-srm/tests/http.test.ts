import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildProcurementRouter } from "../src/http/app.js";
import type { HttpResponse, Router } from "../src/http/router.js";
import { buildModule, type TestContext } from "./helpers.js";

interface Client {
  ctx: TestContext;
  router: Router;
  call(
    method: string,
    url: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<HttpResponse>;
}

const ADMIN = { "x-user-id": "user_admin", "x-roles": "procurement_admin,buyer" };
const BUYER = { "x-user-id": "user_buyer", "x-roles": "buyer" };
const MANAGER = { "x-user-id": "user_manager", "x-roles": "manager" };
const AP = { "x-user-id": "user_ap", "x-roles": "ap_clerk" };

function client(today = "2026-03-02"): Client {
  const ctx = buildModule(today);
  const router = buildProcurementRouter(ctx.module);
  return {
    ctx,
    router,
    call: (method, url, body, headers = BUYER) =>
      router.dispatch({
        method,
        url,
        headers: { "x-tenant-id": ctx.tenant, ...headers },
        body,
      }),
  };
}

function record(response: HttpResponse): Record<string, any> {
  return response.body as Record<string, any>;
}

function errorCode(response: HttpResponse): string {
  return record(response).error.code;
}

/** Policies + one active supplier: the minimum a tenant needs to transact. */
async function bootstrap(api: Client): Promise<string> {
  for (const documentType of ["requisition", "purchase_order"]) {
    const policy = await api.call(
      "POST",
      "/approval-policies/default",
      { documentType, currency: "USD" },
      ADMIN,
    );
    assert.equal(policy.status, 201);
  }
  const supplier = await api.call(
    "POST",
    "/suppliers",
    {
      supplierNumber: "SUP-2001",
      legalName: "Office Direct Supplies Inc",
      currency: "USD",
      paymentTermsDays: 30,
      categories: ["IND.OFFICE"],
      defaultLeadTimeDays: 4,
    },
    ADMIN,
  );
  assert.equal(supplier.status, 201);
  return record(supplier).id as string;
}

describe("http routing and errors", () => {
  it("serves health and route discovery without a tenant", async () => {
    const api = client();
    const health = await api.router.dispatch({ method: "GET", url: "/health", headers: {} });
    assert.equal(health.status, 200);
    assert.deepEqual(health.body, { status: "ok", service: "procurement-srm" });

    const routes = await api.router.dispatch({ method: "GET", url: "/routes", headers: {} });
    assert.equal(routes.status, 200);
    const patterns = record(routes).items.map((route: { pattern: string }) => route.pattern);
    assert.ok(patterns.includes("/requisitions"));
    assert.ok(patterns.includes("/invoices/register-and-match"));
  });

  it("requires the tenant header everywhere else", async () => {
    const api = client();
    const response = await api.router.dispatch({ method: "GET", url: "/requisitions", headers: {} });
    assert.equal(response.status, 401);
    assert.equal(errorCode(response), "MISSING_TENANT");
  });

  it("returns 404 for an unknown route and for an unknown id", async () => {
    const api = client();
    const noRoute = await api.call("GET", "/nope");
    assert.equal(noRoute.status, 404);
    assert.equal(errorCode(noRoute), "ROUTE_NOT_FOUND");

    const noEntity = await api.call("GET", "/requisitions/pr_missing");
    assert.equal(noEntity.status, 404);
  });

  it("maps a malformed body onto 422 with the offending field", async () => {
    const api = client();
    const response = await api.call("POST", "/requisitions", {
      title: "",
      costCenter: "CC-900",
      currency: "USD",
      neededBy: "2026-04-01",
      deliverTo: "HQ mailroom",
    });
    assert.equal(response.status, 422);
    assert.equal(errorCode(response), "VALIDATION");
    assert.equal(record(response).error.details.field, "title");
  });

  it("rejects a body that is not a JSON object", async () => {
    const api = client();
    const response = await api.call("POST", "/requisitions", "not-json");
    assert.equal(response.status, 422);
  });

  it("enforces the role gate on privileged endpoints", async () => {
    const api = client();
    const forbidden = await api.call(
      "POST",
      "/approval-policies/default",
      { documentType: "requisition", currency: "USD" },
      { "x-user-id": "user_nobody", "x-roles": "viewer" },
    );
    assert.equal(forbidden.status, 403);

    const allowed = await api.call(
      "POST",
      "/approval-policies/default",
      { documentType: "requisition", currency: "USD" },
      ADMIN,
    );
    assert.equal(allowed.status, 201);
  });

  it("maps a domain state error onto 409", async () => {
    const api = client();
    const supplierId = await bootstrap(api);
    const order = await api.call("POST", "/purchase-orders", {
      supplierId,
      shipTo: "HQ mailroom",
      lines: [
        {
          description: "A4 copier paper",
          categoryCode: "IND.OFFICE",
          quantity: 10,
          uom: "BOX",
          unitPriceMinor: 1_850,
          needBy: "2026-04-01",
        },
      ],
    });
    assert.equal(order.status, 201);

    const issueTooEarly = await api.call(
      "POST",
      `/purchase-orders/${record(order).id}/issue`,
      {},
    );
    assert.equal(issueTooEarly.status, 409);
    assert.equal(errorCode(issueTooEarly), "INVALID_STATE");
  });

  it("keeps tenants apart", async () => {
    const api = client();
    const supplierId = await bootstrap(api);
    const otherTenant = await api.router.dispatch({
      method: "GET",
      url: `/suppliers/${supplierId}`,
      headers: { "x-tenant-id": "other-tenant", ...BUYER },
    });
    assert.equal(otherTenant.status, 404);
  });
});

describe("http procure-to-pay walkthrough", () => {
  it("carries a requisition through to an approved invoice", async () => {
    const api = client();
    const supplierId = await bootstrap(api);

    // 1. Demand, small enough to auto-approve.
    const requisition = await api.call("POST", "/requisitions", {
      title: "Q1 stationery top-up",
      costCenter: "CC-900",
      currency: "USD",
      neededBy: "2026-04-01",
      deliverTo: "HQ mailroom",
      lines: [
        {
          description: "A4 copier paper, 80gsm, box of 5 reams",
          categoryCode: "IND.OFFICE",
          quantity: 20,
          uom: "BOX",
          unitPriceMinor: 1_200,
        },
      ],
    });
    assert.equal(requisition.status, 201);
    const requisitionId = record(requisition).id as string;

    const submitted = await api.call("POST", `/requisitions/${requisitionId}/submit`);
    assert.equal(submitted.status, 200);
    assert.equal(record(submitted).requisition.status, "approved");
    assert.equal(record(submitted).approval.status, "approved");

    const sourceable = await api.call("GET", "/requisitions/sourceable");
    assert.deepEqual(
      record(sourceable).items.map((item: { id: string }) => item.id),
      [requisitionId],
    );

    // 2. Convert to a purchase order and issue it.
    const requisitionBody = record(await api.call("GET", `/requisitions/${requisitionId}`));
    const order = await api.call("POST", "/purchase-orders/from-requisition", {
      requisitionId,
      supplierId,
      lineSelections: [{ lineId: requisitionBody.lines[0].id }],
    });
    assert.equal(order.status, 201);
    const orderId = record(order).id as string;
    assert.equal(record(order).netTotal.amountMinor, 24_000);

    assert.equal((await api.call("POST", `/purchase-orders/${orderId}/submit`, {})).status, 200);
    const issued = await api.call("POST", `/purchase-orders/${orderId}/issue`, {});
    assert.equal(issued.status, 200);
    assert.equal(record(issued).status, "issued");

    const receivable = await api.call("GET", "/purchase-orders/receivable");
    assert.equal(record(receivable).items.length, 1);

    // 3. Receive the goods.
    const orderBody = record(await api.call("GET", `/purchase-orders/${orderId}`));
    const receipt = await api.call("POST", "/receipts", {
      purchaseOrderId: orderId,
      deliveryNoteReference: "DN-5501",
      lines: [{ purchaseOrderLineNumber: orderBody.lines[0].lineNumber, receivedQuantity: 20 }],
    });
    assert.equal(receipt.status, 201);
    const posted = await api.call("POST", `/receipts/${record(receipt).id}/post`, {});
    assert.equal(posted.status, 200);
    assert.equal(record(posted).purchaseOrder.status, "received");

    const grIr = await api.call("GET", `/purchase-orders/${orderId}/gr-ir`);
    assert.equal(record(grIr).amountMinor, 24_000);

    // 4. Invoice, match and approve for payment.
    const invoice = await api.call(
      "POST",
      "/invoices/register-and-match",
      {
        supplierInvoiceNumber: "SI-7781",
        supplierId,
        purchaseOrderId: orderId,
        invoiceDate: "2026-03-02",
        declaredTotal: { amountMinor: 24_000, currency: "USD" },
        lines: [
          {
            description: "A4 copier paper, 80gsm, box of 5 reams",
            quantity: 20,
            uom: "BOX",
            unitPriceMinor: 1_200,
            purchaseOrderLineNumber: orderBody.lines[0].lineNumber,
          },
        ],
      },
      AP,
    );
    assert.equal(invoice.status, 201);
    assert.equal(record(invoice).match.status, "matched");
    assert.equal(record(invoice).match.matchType, "three_way");

    const invoiceId = record(invoice).invoice.id as string;
    const approved = await api.call(
      "POST",
      `/invoices/${invoiceId}/approve-for-payment`,
      {},
      AP,
    );
    assert.equal(approved.status, 200);
    assert.equal(record(approved).status, "approved_for_payment");

    assert.equal(record(await api.call("GET", `/purchase-orders/${orderId}/gr-ir`)).amountMinor, 0);

    // 5. The integration outbox carries the whole story.
    const outbox = await api.call("GET", "/outbox");
    const eventTypes = record(outbox).items.map((event: { eventType: string }) => event.eventType);
    for (const expected of [
      "procurement.requisition.approved",
      "procurement.po.issued",
      "procurement.receipt.posted",
      "procurement.invoice.matched",
      "procurement.invoice.approved_for_payment",
    ]) {
      assert.ok(eventTypes.includes(expected), `${expected} missing from ${eventTypes.join(", ")}`);
    }

    const drained = await api.call("POST", "/outbox/drain", {});
    assert.equal(record(drained).count, eventTypes.length);
    assert.equal(record(await api.call("GET", "/outbox")).items.length, 0);
  });

  it("routes spend above the auto-approval band through an approver's inbox", async () => {
    const api = client();
    await bootstrap(api);

    const requisition = await api.call("POST", "/requisitions", {
      title: "Ergonomic chairs for the design floor",
      costCenter: "CC-410",
      currency: "USD",
      neededBy: "2026-05-01",
      deliverTo: "HQ floor 3",
      lines: [
        {
          description: "Task chair, adjustable",
          categoryCode: "IND.OFFICE",
          quantity: 10,
          uom: "EA",
          unitPriceMinor: 30_000,
        },
      ],
    });
    const requisitionId = record(requisition).id as string;

    const submitted = await api.call("POST", `/requisitions/${requisitionId}/submit`);
    assert.equal(record(submitted).requisition.status, "pending_approval");
    const requestId = record(submitted).approval.id as string;

    const buyerInbox = await api.call("GET", "/approval-requests/inbox");
    assert.equal(record(buyerInbox).items.length, 0, "a buyer cannot decide their own chain");

    const managerInbox = await api.call("GET", "/approval-requests/inbox", undefined, MANAGER);
    assert.deepEqual(
      record(managerInbox).items.map((item: { id: string }) => item.id),
      [requestId],
    );

    const wrongRole = await api.call(
      "POST",
      `/approval-requests/${requestId}/approve`,
      { comment: "Not my call" },
      AP,
    );
    assert.equal(wrongRole.status, 403, "the step's role gate is enforced by the aggregate");

    const approved = await api.call(
      "POST",
      `/approval-requests/${requestId}/approve`,
      { comment: "Budgeted in the refit" },
      MANAGER,
    );
    assert.equal(approved.status, 200);
    assert.equal(record(approved).status, "approved");
    assert.equal(
      record(await api.call("GET", `/requisitions/${requisitionId}`)).status,
      "approved",
      "the approval outcome propagates back to the document",
    );
  });

  it("reports a blocked invoice and clears it once the exception is waived", async () => {
    const api = client();
    const supplierId = await bootstrap(api);
    const order = await api.call("POST", "/purchase-orders", {
      supplierId,
      shipTo: "HQ mailroom",
      lines: [
        {
          description: "A4 copier paper",
          categoryCode: "IND.OFFICE",
          quantity: 10,
          uom: "BOX",
          unitPriceMinor: 1_850,
          needBy: "2026-04-01",
        },
      ],
    });
    const orderId = record(order).id as string;
    await api.call("POST", `/purchase-orders/${orderId}/submit`, {});
    await api.call("POST", `/purchase-orders/${orderId}/issue`, {});

    const invoice = await api.call(
      "POST",
      "/invoices/register-and-match",
      {
        supplierInvoiceNumber: "SI-9002",
        supplierId,
        purchaseOrderId: orderId,
        invoiceDate: "2026-03-02",
        declaredTotal: { amountMinor: 18_500, currency: "USD" },
        lines: [
          {
            description: "A4 copier paper",
            quantity: 10,
            uom: "BOX",
            unitPriceMinor: 1_850,
            purchaseOrderLineNumber: record(order).lines[0].lineNumber,
          },
        ],
      },
      AP,
    );
    assert.equal(record(invoice).match.status, "exception");
    const invoiceId = record(invoice).invoice.id as string;

    const queue = await api.call("GET", "/invoices/exception-queue", undefined, AP);
    assert.equal(record(queue).items.length, 1);
    assert.equal(record(queue).items[0].exceptions[0].code, "NO_RECEIPT_RECORDED");

    const blocked = await api.call("POST", `/invoices/${invoiceId}/approve-for-payment`, {}, AP);
    assert.equal(blocked.status, 409);

    const resolved = await api.call(
      "POST",
      `/invoices/${invoiceId}/exceptions/resolve`,
      {
        code: "NO_RECEIPT_RECORDED",
        lineNumber: 1,
        action: "waived",
        note: "Service delivered, no goods receipt applies",
      },
      AP,
    );
    assert.equal(resolved.status, 200);
    assert.equal(record(resolved).action, "waived");

    const cleared = await api.call("POST", `/invoices/${invoiceId}/approve-for-payment`, {}, AP);
    assert.equal(cleared.status, 200);
    assert.equal(record(cleared).status, "approved_for_payment");
  });

  it("serves the buyer dashboard and spend analytics", async () => {
    const api = client();
    const supplierId = await bootstrap(api);
    const order = await api.call("POST", "/purchase-orders", {
      supplierId,
      shipTo: "HQ mailroom",
      lines: [
        {
          description: "A4 copier paper",
          categoryCode: "IND.OFFICE",
          quantity: 10,
          uom: "BOX",
          unitPriceMinor: 1_850,
          needBy: "2026-04-01",
        },
      ],
    });
    const orderId = record(order).id as string;
    await api.call("POST", `/purchase-orders/${orderId}/submit`, {});
    await api.call("POST", `/purchase-orders/${orderId}/issue`, {});

    const dashboard = record(await api.call("GET", "/analytics/dashboard?currency=USD"));
    assert.equal(dashboard.currency, "USD");
    assert.equal(dashboard.asOf, "2026-03-02");
    assert.equal(dashboard.openOrders, 1);
    assert.equal(dashboard.openCommitment.amountMinor, 18_500);
    assert.equal(dashboard.topSuppliers[0].orderedValue.amountMinor, 18_500);

    const byCategory = record(await api.call("GET", "/analytics/spend/by-category"));
    assert.equal(byCategory.items[0].key, "IND.OFFICE");
    assert.equal(byCategory.items[0].shareBps, 10_000);

    const coverage = record(await api.call("GET", "/analytics/contract-coverage"));
    assert.equal(coverage.coverageBps, 0, "nothing is on contract yet");

    const commitments = record(await api.call("GET", "/analytics/open-commitments"));
    assert.equal(commitments.items[0].supplierId, supplierId);
    assert.equal(commitments.items[0].outstanding.amountMinor, 18_500);
  });
});
