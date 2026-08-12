import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createContainer } from "../src/infrastructure/container.js";
import { seedDemoData } from "../src/infrastructure/seed.js";
import { createMasterDataServer } from "../src/http/server.js";

/**
 * Boots the real server over the seeded demo tenant and drives it with fetch,
 * so the routing table, header-based tenant context, body validation and
 * error mapping are exercised the way a client sees them.
 */

let server: Server;
let base: string;
const TENANT = "demo";

interface Reply<T = unknown> {
  readonly status: number;
  readonly body: T;
}

async function call<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = { "x-tenant-id": TENANT, "x-user-id": "tester" },
): Promise<Reply<T>> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: (text.length > 0 ? JSON.parse(text) : undefined) as T };
}

const get = <T = unknown>(path: string): Promise<Reply<T>> => call<T>("GET", path);
const post = <T = unknown>(path: string, body?: unknown): Promise<Reply<T>> =>
  call<T>("POST", path, body);

before(async () => {
  const container = createContainer();
  await seedDemoData(container, TENANT, "seed-bot");
  server = createMasterDataServer(container);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

describe("router plumbing", () => {
  it("serves health without a tenant header", async () => {
    const response = await fetch(`${base}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok", service: "master-data" });
  });

  it("requires a tenant header everywhere else", async () => {
    const response = await fetch(`${base}/customers`);
    assert.equal(response.status, 400);
    assert.equal(((await response.json()) as { code: string }).code, "TENANT_REQUIRED");
  });

  it("404s an unknown route and 400s malformed JSON", async () => {
    const missing = await get("/nope");
    assert.equal(missing.status, 404);
    assert.equal((missing.body as { code: string }).code, "ROUTE_NOT_FOUND");

    const badJson = await fetch(`${base}/customers`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant-id": TENANT },
      body: "{not json",
    });
    assert.equal(badJson.status, 400);
    assert.equal(((await badJson.json()) as { code: string }).code, "BAD_JSON");
  });

  it("maps domain errors onto their declared status", async () => {
    const notFound = await get("/customers/01JA00000000000000000GHOST");
    assert.equal(notFound.status, 404);
    assert.equal((notFound.body as { code: string }).code, "NOT_FOUND");

    const invalid = await post("/customers", { legalName: "No classification" });
    assert.equal(invalid.status, 400);
    assert.equal((invalid.body as { code: string }).code, "VALIDATION");

    const conflict = await post("/code-lists", { listCode: "industry", name: "Duplicate" });
    assert.equal(conflict.status, 409);
    assert.equal((conflict.body as { code: string }).code, "CONFLICT");
  });

  it("isolates tenants by header", async () => {
    const other = await call("GET", "/customers", undefined, { "x-tenant-id": "someone-else" });
    assert.equal(other.status, 200);
    assert.equal((other.body as { total: number }).total, 0);
  });
});

describe("reference and address endpoints", () => {
  it("serves country reference data", async () => {
    const eu = await get<readonly { alpha2: string }[]>("/countries?eu=true");
    assert.equal(eu.status, 200);
    assert.ok(eu.body.some((country) => country.alpha2 === "DE"));
    assert.ok(!eu.body.some((country) => country.alpha2 === "US"));

    const subdivisions = await get<readonly { code: string }[]>("/countries/us/subdivisions");
    assert.ok(subdivisions.body.some((subdivision) => subdivision.code === "MA"));
  });

  it("grades an address instead of rejecting it", async () => {
    const checked = await post<{ valid: boolean; issues: readonly { field: string }[] }>(
      "/addresses/validate",
      { line1: "1 Main St", city: "Boston", region: "MA", countryCode: "US" },
    );
    assert.equal(checked.status, 200);
    assert.equal(checked.body.valid, false);
    assert.deepEqual(checked.body.issues.map((issue) => issue.field), ["postalCode"]);

    const formatted = await post<{ lines: readonly string[] }>("/addresses/format", {
      line1: "1200 harbor boulevard",
      city: "boston",
      region: "Massachusetts",
      postalCode: "021101234",
      countryCode: "us",
    });
    assert.deepEqual(formatted.body.lines, [
      "1200 harbor boulevard",
      "boston MA 02110-1234",
      "United States",
    ]);
  });

  it("validates an identifier's check digits", async () => {
    const good = await post<{ valid: boolean; normalized: string }>("/identifiers/validate", {
      scheme: "vat",
      value: "de 136695976",
    });
    assert.equal(good.body.valid, true);
    assert.equal(good.body.normalized, "DE136695976");

    const bad = await post<{ valid: boolean; reason: string }>("/identifiers/validate", {
      scheme: "gln",
      value: "4012345678900",
    });
    assert.equal(bad.body.valid, false);
    assert.match(bad.body.reason, /check digit/);
  });
});

describe("money endpoints", () => {
  it("lists the tenant's currencies and its functional one", async () => {
    const enabled = await get<readonly { code: string }[]>("/currencies?enabled=true");
    assert.deepEqual(
      enabled.body.map((currency) => currency.code).sort(),
      ["CAD", "CHF", "EUR", "GBP", "JPY", "SEK", "USD"],
    );
    assert.deepEqual((await get("/currencies/functional")).body, { code: "USD" });
  });

  it("converts through a direct rate and a triangulation", async () => {
    const direct = await post<{ to: { amountMinor: number }; rate: number }>("/fx/convert", {
      amountMinor: 100_000,
      from: "EUR",
      to: "USD",
    });
    assert.equal(direct.status, 200);
    assert.equal(direct.body.to.amountMinor, 108_420);

    const triangulated = await get<{ path: string; legs: readonly { base: string; quote: string }[] }>(
      "/fx/resolve?base=GBP&quote=EUR",
    );
    assert.equal(triangulated.status, 200);
    assert.equal(triangulated.body.path, "triangulated");
    assert.deepEqual(
      triangulated.body.legs.map((leg) => `${leg.base}/${leg.quote}`),
      ["GBP/USD", "USD/EUR"],
    );

    const unavailable = await get("/fx/resolve?base=GBP&quote=EUR&directOnly=true");
    assert.equal(unavailable.status, 422);
    assert.equal((unavailable.body as { code: string }).code, "FX_RATE_UNAVAILABLE");
  });

  it("allocates an amount across weights", async () => {
    const allocated = await post<{ parts: readonly { amountMinor: number }[] }>(
      "/currencies/USD/allocate",
      { amountMinor: 10_000, weights: [1, 1, 1] },
    );
    assert.deepEqual(allocated.body.parts.map((part) => part.amountMinor), [3_334, 3_333, 3_333]);
  });

  it("reports per-row outcomes for a bulk rate load", async () => {
    const loaded = await post<{ accepted: readonly unknown[]; rejected: readonly unknown[] }>(
      "/fx/rates/bulk",
      {
        rates: [
          { base: "USD", quote: "NOK", rate: 10.5, validFrom: "2026-02-01T00:00:00.000Z" },
          { base: "USD", quote: "ZZZ", rate: 1, validFrom: "2026-02-01T00:00:00.000Z" },
        ],
      },
    );
    // Partial success reports 207 rather than pretending the batch was clean.
    assert.equal(loaded.status, 207);
    assert.equal(loaded.body.accepted.length, 1);
    assert.equal(loaded.body.rejected.length, 1);
  });
});

describe("uom endpoints", () => {
  it("converts through the seeded packaging conversions", async () => {
    const cases = await post<{ value: number; steps: readonly unknown[] }>("/uoms/convert", {
      value: 2,
      from: "PALLET",
      to: "CASE",
    });
    assert.equal(cases.body.value, 80);

    // CASE -> KG bridges dimensions through a declared item conversion.
    const weight = await post<{ value: number }>("/uoms/convert", {
      value: 10,
      from: "CASE",
      to: "KG",
    });
    assert.equal(weight.body.value, 72);

    const impossible = await post("/uoms/convert", { value: 1, from: "KG", to: "L" });
    assert.equal(impossible.status, 400);
    assert.equal((impossible.body as { code: string }).code, "UOM_ERROR");
  });

  it("rounds an order quantity onto a packaging multiple", async () => {
    assert.deepEqual((await get("/uoms/round?value=17&increment=6")).body, { value: 18 });
    assert.deepEqual((await get("/uoms/round?value=17&increment=6&mode=down")).body, { value: 12 });
  });
});

describe("term endpoints", () => {
  it("schedules a seeded discount term against the US calendar", async () => {
    const schedule = await post<{
      dueDate: string;
      discounts: readonly { lastDay: string; discountAmount?: { amountMinor: number } }[];
      discountOnPaymentDate?: { percent: number };
    }>("/payment-terms/2-10-NET30/schedule", {
      invoiceDate: "2026-06-01",
      amountMinor: 500_000,
      currency: "USD",
      paymentDate: "2026-06-08",
    });
    assert.equal(schedule.status, 200);
    assert.equal(schedule.body.dueDate, "2026-07-01");
    assert.equal(schedule.body.discounts[0]?.lastDay, "2026-06-11");
    assert.equal(schedule.body.discounts[0]?.discountAmount?.amountMinor, 10_000);
    assert.equal(schedule.body.discountOnPaymentDate?.percent, 2);
  });

  it("previews an unsaved instalment plan", async () => {
    const preview = await post<{ installments: readonly { dueDate: string }[] }>(
      "/payment-terms/preview",
      {
        term: {
          code: "DRAFT-50-50",
          name: "Half up front, half on delivery",
          due: { kind: "net_days", days: 30 },
          installments: [
            { sequence: 1, percent: 50, days: 0 },
            { sequence: 2, percent: 50, days: 30 },
          ],
        },
        document: { invoiceDate: "2026-03-02", amountMinor: 100_000, currency: "USD" },
      },
    );
    assert.deepEqual(
      preview.body.installments.map((line) => line.dueDate),
      ["2026-03-02", "2026-04-01"],
    );
    // Previewing does not add the term to the catalog.
    assert.equal((await get("/payment-terms/DRAFT-50-50")).status, 404);
  });

  it("answers business-day questions on a named calendar", async () => {
    assert.deepEqual((await get("/calendars/US/business-days?from=2026-07-03")).body, {
      date: "2026-07-03",
      isBusinessDay: false,
    });
    const window = await get<{ businessDays: number }>(
      "/calendars/US/business-days?from=2026-06-29&to=2026-07-10",
    );
    assert.equal(window.body.businessDays, 9);
  });

  it("exposes Incoterms responsibilities and delivery estimates", async () => {
    const responsibilities = await get<{ importClearance: string; clause: string }>(
      "/shipping-terms/DDP-CUST/responsibilities",
    );
    assert.equal(responsibilities.body.importClearance, "seller");
    assert.match(responsibilities.body.clause, /^DDP .+ \(Incoterms 2020\)$/);

    const estimate = await get<{ dispatchDate: string; estimatedDelivery: string }>(
      "/shipping-terms/DAP-CUST/delivery-estimate?orderDate=2026-06-01&calendar=US",
    );
    assert.equal(estimate.body.dispatchDate, "2026-06-02");
    assert.equal(estimate.body.estimatedDelivery, "2026-06-05");
  });
});

describe("code list endpoints", () => {
  it("resolves a hierarchical code and its descendants", async () => {
    const resolved = await get<{ path: readonly string[]; entry: { label: string } }>(
      "/code-lists/industry/entries/MFG.AUTO",
    );
    assert.deepEqual(resolved.body.path, ["MFG", "MFG.AUTO"]);
    assert.equal(resolved.body.entry.label, "Automotive");

    const descendants = await get<readonly { code: string }[]>(
      "/code-lists/industry/entries/MFG/descendants",
    );
    assert.deepEqual(
      descendants.body.map((entry) => entry.code).sort(),
      ["MFG.AUTO", "MFG.ELEC", "MFG.FOOD"],
    );
  });

  it("runs the draft, deprecate, publish and translate cycle", async () => {
    assert.equal((await post("/code-lists/customer_segment/versions", { notes: "FY27" })).status, 201);
    assert.equal(
      (
        await post("/code-lists/customer_segment/entries", {
          code: "MIDMARKET",
          label: "Mid market",
          sortOrder: 5,
        })
      ).status,
      201,
    );
    assert.equal(
      (
        await post("/code-lists/customer_segment/entries/VOLUME/deprecate", {
          version: 2,
          reason: "Renamed",
          replacedBy: "MIDMARKET",
        })
      ).status,
      200,
    );
    const published = await post<{ version: number; status: string }>(
      "/code-lists/customer_segment/publish",
      { effectiveFrom: "2026-07-01" },
    );
    assert.equal(published.body.version, 2);
    assert.equal(published.body.status, "published");

    const translated = await get<{ to: string }>(
      "/code-lists/customer_segment/translate?code=VOLUME&from=1&to=2",
    );
    assert.equal(translated.body.to, "MIDMARKET");

    const diff = await get<readonly { code: string; change: string }[]>(
      "/code-lists/customer_segment/diff?from=1&to=2",
    );
    assert.deepEqual(
      diff.body.map((change) => `${change.code}:${change.change}`),
      ["MIDMARKET:added", "VOLUME:deprecated"],
    );

    // Reads before the new version still see the old vocabulary.
    const before = await get<readonly { code: string }[]>(
      "/code-lists/customer_segment/entries?asOf=2026-06-30",
    );
    assert.ok(before.body.some((entry) => entry.code === "VOLUME"));
    assert.ok(!before.body.some((entry) => entry.code === "MIDMARKET"));
  });
});

describe("customer and site endpoints", () => {
  it("walks the seeded book", async () => {
    const page = await get<{ total: number; items: readonly { number: string }[] }>("/customers");
    assert.equal(page.body.total, 3);

    const byNumber = await get<{ id: string; legalName: string; terms: { paymentTermCode: string } }>(
      "/customers/by-number/C-000001",
    );
    assert.equal(byNumber.body.legalName, "Northwind Traders Inc.");
    assert.equal(byNumber.body.terms.paymentTermCode, "2-10-NET30");

    const sites = await get<readonly { code: string }[]>(`/customers/${byNumber.body.id}/sites`);
    assert.deepEqual(sites.body.map((site) => site.code).sort(), ["DC-EAST", "HQ"]);

    const hierarchy = await get<{ children: readonly { customer: { number: string } }[] }>(
      "/customers/by-number/C-000002",
    ).then(async (parent) =>
      get<{ children: readonly { customer: { number: string } }[] }>(
        `/customers/${(parent.body as unknown as { id: string }).id}/hierarchy`,
      ),
    );
    assert.deepEqual(
      hierarchy.body.children.map((child) => child.customer.number),
      ["C-000003"],
    );
  });

  it("creates a customer, activates it and blocks an unqualified activation", async () => {
    const created = await post<{ id: string; number: string; status: string }>("/customers", {
      legalName: "Cascadia Outfitters LLC",
      classification: "small_business",
      currency: "USD",
      registeredAddress: {
        line1: "400 Pike Street",
        city: "Seattle",
        region: "WA",
        postalCode: "98101",
        countryCode: "US",
      },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.status, "draft");

    const premature = await post(`/customers/${created.body.id}/status`, { status: "active" });
    assert.equal(premature.status, 422);
    assert.match((premature.body as { message: string }).message, /identifier/);

    assert.equal(
      (await post(`/customers/${created.body.id}/identifiers`, { scheme: "duns", value: "804735132" }))
        .status,
      201,
    );
    const activated = await post<{ status: string }>(`/customers/${created.body.id}/status`, {
      status: "active",
    });
    assert.equal(activated.body.status, "active");
  });

  it("resolves the primary ship-to and records a relocation", async () => {
    const customer = await get<{ id: string }>("/customers/by-number/C-000001");
    const resolved = await get<{ code: string; id: string }>(
      `/sites/resolve?customerId=${customer.body.id}&role=ship_to`,
    );
    assert.equal(resolved.body.code, "DC-EAST");

    const moved = await post(`/sites/${resolved.body.id}/address`, {
      address: {
        line1: "12 Commerce Way",
        city: "Springfield",
        region: "MA",
        postalCode: "01103",
        countryCode: "US",
      },
      effectiveFrom: "2027-01-01T00:00:00.000Z",
      reason: "Lease relocation",
    });
    assert.equal(moved.status, 200);

    const history = await get<{ address: { city: string }; history: readonly unknown[] }>(
      `/sites/${resolved.body.id}/address?asOf=2026-06-01T00:00:00.000Z`,
    );
    assert.equal(history.body.address.city, "Worcester");
    assert.equal(history.body.history.length, 2);

    const future = await get<{ address: { city: string } }>(
      `/sites/${resolved.body.id}/address?asOf=2027-06-01T00:00:00.000Z`,
    );
    assert.equal(future.body.address.city, "Springfield");
  });

  it("finds sites near a point", async () => {
    const nearby = await get<readonly { site: { code: string }; distanceKm: number }[]>(
      "/sites/nearest?lat=42.3554&lon=-71.0524&radiusKm=100",
    );
    assert.deepEqual(nearby.body.map((hit) => hit.site.code), ["HQ", "DC-EAST"]);
    assert.ok(nearby.body[0]!.distanceKm < nearby.body[1]!.distanceKm);
  });

  it("plans a merge before performing one", async () => {
    const survivor = await post<{ id: string }>("/customers", {
      legalName: "Puget Sound Marine Ltd",
      classification: "small_business",
      registeredAddress: {
        line1: "77 Alaskan Way",
        city: "Seattle",
        region: "WA",
        postalCode: "98104",
        countryCode: "US",
      },
    });
    const duplicate = await post<{ id: string }>("/customers", {
      legalName: "Puget Sound Marine Limited",
      classification: "small_business",
      registeredAddress: {
        line1: "77 Alaskan Way",
        city: "Seattle",
        region: "WA",
        postalCode: "98104",
        countryCode: "US",
      },
    });

    const duplicates = await get<readonly { score: { decision: string } }[]>(
      `/customers/${survivor.body.id}/duplicates`,
    );
    assert.equal(duplicates.body[0]?.score.decision, "duplicate");

    const plan = await post<{ conflicts: readonly { field: string }[] }>(
      `/customers/${survivor.body.id}/merge-plan`,
      { duplicateId: duplicate.body.id },
    );
    assert.deepEqual(plan.body.conflicts.map((conflict) => conflict.field), ["legalName"]);

    const merged = await post<{ merged: { status: string } }>(`/customers/${survivor.body.id}/merge`, {
      duplicateId: duplicate.body.id,
    });
    assert.equal(merged.body.merged.status, "merged");

    const forwarded = await get<{ id: string }>(`/customers/${duplicate.body.id}/resolved`);
    assert.equal(forwarded.body.id, survivor.body.id);
  });
});

describe("event log", () => {
  it("exposes the outbox for the calling tenant", async () => {
    const created = await get<readonly { eventType: string; tenantId: string }[]>(
      "/events?type=mdm.customer.created",
    );
    assert.ok(created.body.length >= 3);
    assert.ok(created.body.every((event) => event.tenantId === TENANT));
    assert.deepEqual(
      await call("GET", "/events", undefined, { "x-tenant-id": "someone-else" }).then((r) => r.body),
      [],
    );
  });
});
