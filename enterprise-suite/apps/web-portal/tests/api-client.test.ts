import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ApiClient } from "../src/api/client.js";
import { ApiError, buildQueryString, classifyStatus, type ApiRequest, type ApiResponse, type Transport } from "../src/api/types.js";
import { SalesApi } from "../src/api/sales.js";

class ScriptedTransport implements Transport {
  readonly seen: ApiRequest[] = [];
  constructor(private readonly responses: Array<ApiResponse | Error>) {}

  async send(request: ApiRequest): Promise<ApiResponse> {
    this.seen.push(request);
    const next = this.responses.shift();
    if (!next) throw new Error("no scripted response left");
    if (next instanceof Error) throw next;
    return next;
  }
}

function client(transport: Transport, overrides: Partial<ConstructorParameters<typeof ApiClient>[0]> = {}): ApiClient {
  let counter = 0;
  return new ApiClient({
    service: "sales-erp",
    baseUrl: "http://svc/api/sales/",
    transport,
    auth: { headers: () => ({ "x-tenant-id": "acme", authorization: "Bearer t" }) },
    sleep: async () => {},
    newRequestId: () => `req-${++counter}`,
    ...overrides,
  });
}

const ok = (body: unknown): ApiResponse => ({ status: 200, headers: {}, body });

describe("query strings", () => {
  it("drops empty values and encodes the rest", () => {
    assert.equal(
      buildQueryString({ page: 2, q: "a b", status: undefined, sort: "", flag: false }),
      "?page=2&q=a+b&flag=false",
    );
    assert.equal(buildQueryString(undefined), "");
  });
});

describe("ApiClient", () => {
  it("resolves URLs against the base and attaches auth headers", async () => {
    const transport = new ScriptedTransport([ok({ items: [] })]);
    await client(transport).get("/quotes", { query: { page: 2 } });

    const request = transport.seen[0]!;
    assert.equal(request.url, "http://svc/api/sales/quotes?page=2");
    assert.equal(request.headers["x-tenant-id"], "acme");
    assert.equal(request.headers["x-request-id"], "req-1");
    assert.equal(request.headers.accept, "application/json");
    assert.equal(request.headers["content-type"], undefined, "GET carries no content-type");
  });

  it("sets content-type and idempotency-key on writes", async () => {
    const transport = new ScriptedTransport([{ status: 202, headers: {}, body: { ok: true } }]);
    await client(transport).post("/quotes", { body: { customerId: "c1" }, idempotencyKey: "k-1" });
    const request = transport.seen[0]!;
    assert.equal(request.headers["content-type"], "application/json");
    assert.equal(request.headers["idempotency-key"], "k-1");
  });

  it("retries idempotent calls with the same request id, then succeeds", async () => {
    const transport = new ScriptedTransport([
      { status: 503, headers: {}, body: { code: "UNAVAILABLE", message: "down" } },
      ok({ total: 1 }),
    ]);
    const result = await client(transport).get<{ total: number }>("/quotes");
    assert.equal(result.total, 1);
    assert.equal(transport.seen.length, 2);
    assert.deepEqual(transport.seen.map((r) => r.attempt), [1, 2]);
    assert.equal(transport.seen[0]!.requestId, transport.seen[1]!.requestId);
  });

  it("does not retry POST unless it is idempotent", async () => {
    const transport = new ScriptedTransport([
      { status: 500, headers: {}, body: { message: "boom" } },
      ok({}),
    ]);
    await assert.rejects(client(transport).post("/quotes", { body: {} }), ApiError);
    assert.equal(transport.seen.length, 1);
  });

  it("gives up after the retry budget and reports the last error", async () => {
    const transport = new ScriptedTransport([
      new Error("ECONNREFUSED"),
      new Error("ECONNREFUSED"),
      new Error("ECONNREFUSED"),
    ]);
    await assert.rejects(
      client(transport, { retries: 2 }).get("/quotes"),
      (error: unknown) =>
        error instanceof ApiError && error.kind === "network" && error.retryable,
    );
    assert.equal(transport.seen.length, 3);
  });

  it("classifies status codes and keeps the service's error envelope", async () => {
    const transport = new ScriptedTransport([
      { status: 403, headers: {}, body: { code: "FORBIDDEN", message: "nope", details: { need: "sales:approve" } } },
    ]);
    await assert.rejects(
      client(transport).get("/approvals"),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.kind, "forbidden");
        assert.equal(error.code, "FORBIDDEN");
        assert.equal(error.message, "nope");
        assert.deepEqual(error.details, { need: "sales:approve" });
        assert.equal(error.retryable, false);
        return true;
      },
    );
    assert.equal(transport.seen.length, 1, "4xx is not retried");
  });

  it("reports every call to the telemetry hook", async () => {
    const records: string[] = [];
    const transport = new ScriptedTransport([
      { status: 503, headers: {}, body: {} },
      ok({}),
    ]);
    await client(transport, { onCall: (r) => records.push(`${r.method} ${r.path} ${r.status} x${r.attempts}`) })
      .get("/orders");
    assert.deepEqual(records, ["GET /orders 200 x2"]);
  });

  it("maps status codes to kinds", () => {
    assert.equal(classifyStatus(401), "unauthorized");
    assert.equal(classifyStatus(409), "conflict");
    assert.equal(classifyStatus(422), "validation");
    assert.equal(classifyStatus(502), "server");
    assert.equal(classifyStatus(302), "unknown");
  });
});

describe("module client stubs", () => {
  it("build the routes the services expose", async () => {
    const transport = new ScriptedTransport([ok({ items: [] }), ok({})]);
    const sales = new SalesApi(client(transport));

    await sales.listQuotes({ status: "sent", page: 2 });
    await sales.approveDiscount("apv-1", { approvedPct: 0.15 });

    assert.deepEqual(
      transport.seen.map((r) => `${r.method} ${r.url}`),
      [
        "GET http://svc/api/sales/quotes?status=sent&page=2",
        "POST http://svc/api/sales/approvals/apv-1/approve",
      ],
    );
  });

  it("composes search from the services' real list endpoints", async () => {
    const transport = new ScriptedTransport([
      ok({ items: [{ id: "qte-1", number: "Q-1", customerName: "Northwind Traders", status: "sent" }] }),
      ok({ items: [] }),
      ok({ items: [] }),
    ]);
    const sales = new SalesApi(client(transport));

    const hits = await sales.search("north", 3);

    assert.deepEqual(
      transport.seen.map((r) => `${r.method} ${r.url}`),
      [
        "GET http://svc/api/sales/quotes?pageSize=50",
        "GET http://svc/api/sales/orders?pageSize=50",
        "GET http://svc/api/sales/customers?pageSize=50",
      ],
      "no synthetic /search endpoint is required of the backend",
    );
    assert.equal(hits.length, 1);
    assert.equal(hits[0]!.title, "Q-1 · Northwind Traders");
    assert.equal(hits[0]!.path, "/m/sales/quotes?q=north");
  });

  it("encodes path parameters", async () => {
    const transport = new ScriptedTransport([ok({})]);
    await new SalesApi(client(transport)).getQuote("qte/1 2");
    assert.equal(transport.seen[0]!.url, "http://svc/api/sales/quotes/qte%2F1%202");
  });
});
