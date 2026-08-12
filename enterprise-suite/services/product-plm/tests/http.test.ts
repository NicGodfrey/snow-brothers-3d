import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createContainer } from "../src/infrastructure/container.js";
import { seedDemoData, type SeedResult } from "../src/infrastructure/seed.js";
import { createPlmServer } from "../src/http/server.js";
import { FixedClock } from "../src/infrastructure/memory/stores.js";
import { DAY_MS } from "./helpers.js";

let server: Server;
let baseUrl: string;
let seeded: SeedResult;
const clock = new FixedClock("2026-01-01T00:00:00.000Z");

interface CallResult {
  status: number;
  body: any;
}

async function call(
  method: string,
  path: string,
  options: { body?: unknown; tenant?: string | null; user?: string } = {},
): Promise<CallResult> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.tenant !== null) headers["x-tenant-id"] = options.tenant ?? "demo";
  headers["x-user-id"] = options.user ?? "http-tester";
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, body: text.length > 0 ? JSON.parse(text) : undefined };
}

before(async () => {
  const container = createContainer({ clock });
  seeded = await seedDemoData(container, "demo");
  server = createPlmServer(container);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))));

describe("HTTP API", () => {
  it("health needs no tenant; everything else does", async () => {
    const health = await call("GET", "/health", { tenant: null });
    assert.equal(health.status, 200);
    const noTenant = await call("GET", "/products", { tenant: null });
    assert.equal(noTenant.status, 400);
    assert.equal(noTenant.body.code, "TENANT_REQUIRED");
  });

  it("lists and filters the seeded catalog", async () => {
    const all = await call("GET", "/products?pageSize=50");
    assert.equal(all.status, 200);
    assert.equal(all.body.total, 12);
    const manufactured = await call("GET", "/products?type=manufactured");
    assert.deepEqual(
      manufactured.body.items.map((p: any) => p.code).sort(),
      ["DECK-MAPLE", "SKATE-COMP-100"],
    );
    const search = await call("GET", "/products?q=wheel");
    assert.equal(search.body.total, 2);
    const badFilter = await call("GET", "/products?lifecycle=retired");
    assert.equal(badFilter.status, 400);
  });

  it("resolves SKUs to product and variant", async () => {
    const resolved = await call("GET", "/skus/DECK-MAPLE-BLACK-80");
    assert.equal(resolved.status, 200);
    assert.equal(resolved.body.product.code, "DECK-MAPLE");
    assert.deepEqual(resolved.body.variant.axisValues, { color: "black", deck_width: "8_0" });
    const missing = await call("GET", "/skus/NO-SUCH-SKU");
    assert.equal(missing.status, 404);
  });

  it("keeps tenants isolated", async () => {
    const foreign = await call("GET", `/products/${seeded.products["DECK-MAPLE"]}`, { tenant: "someone-else" });
    assert.equal(foreign.status, 404);
  });

  it("converts units and rejects nonsense", async () => {
    const ok = await call("GET", "/uoms/convert?value=2&from=DZ&to=EA");
    assert.equal(ok.body.result, 24);
    const bad = await call("GET", "/uoms/convert?value=1&from=KG&to=M");
    assert.equal(bad.status, 400);
  });

  it("runs the full make-item flow: product, BOM, release, activate, cost", async () => {
    const tenant = "flow-tenant";
    const part = await call("POST", "/products", {
      tenant,
      body: { code: "HTTP-PART", name: "Part", type: "purchased", baseUom: "EA" },
    });
    assert.equal(part.status, 201);
    await call("POST", `/products/${part.body.id}/cost`, { tenant, body: { amountMinor: 250, currency: "USD" } });

    const asm = await call("POST", "/products", {
      tenant,
      body: { code: "HTTP-ASM", name: "Assembly", type: "manufactured", baseUom: "EA" },
    });
    const bom = await call("POST", `/products/${asm.body.id}/bom`, { tenant });
    assert.equal(bom.status, 201);
    const revisionId = bom.body.revisions[0].id;
    const line = await call("POST", `/products/${asm.body.id}/bom/revisions/${revisionId}/lines`, {
      tenant,
      body: { componentProductId: part.body.id, quantity: 4, uom: "EA", scrapFactor: 0.25 },
    });
    assert.equal(line.status, 201);
    const release = await call("POST", `/products/${asm.body.id}/bom/revisions/${revisionId}/release`, {
      tenant,
      body: { effectiveFrom: clock.now() },
    });
    assert.equal(release.status, 200);

    // design -> pilot -> active now succeeds because the BOM is effective.
    await call("POST", `/products/${asm.body.id}/lifecycle`, { tenant, body: { to: "pilot" } });
    const active = await call("POST", `/products/${asm.body.id}/lifecycle`, { tenant, body: { to: "active" } });
    assert.equal(active.body.lifecycle, "active");

    const rollup = await call("GET", `/products/${asm.body.id}/cost-rollup`);
    assert.equal(rollup.status, 404, "rollup is tenant-scoped too (wrong tenant gets 404)");
    const rollupOk = await call("GET", `/products/${asm.body.id}/cost-rollup`, { tenant });
    // 4 × 1.25 scrap × 250 = 1250
    assert.equal(rollupOk.body.root.unitCost.amountMinor, 1250);
    const applied = await call("POST", `/products/${asm.body.id}/cost-rollup/apply`, { tenant, body: {} });
    assert.equal(applied.status, 200);
    const product = await call("GET", `/products/${asm.body.id}`, { tenant });
    assert.equal(product.body.standardCost.amountMinor, 1250);
  });

  it("drives the seeded wheel-swap ECO through approval to implementation", async () => {
    const ecoId = seeded.pendingEcoId;
    const pending = await call("GET", `/ecos/${ecoId}`);
    assert.equal(pending.body.status, "submitted");

    // The submitter (seed-bot) cannot approve its own ECO.
    const self = await call("POST", `/ecos/${ecoId}/approve`, { user: "seed-bot", body: {} });
    assert.equal(self.status, 422);

    const approved = await call("POST", `/ecos/${ecoId}/approve`, { user: "chief-engineer", body: { comment: "ok" } });
    assert.equal(approved.body.status, "approved");
    const implemented = await call("POST", `/ecos/${ecoId}/implement`, { user: "release-manager" });
    assert.equal(implemented.body.status, "implemented");

    // 31 days out, the effective BOM revision is B with the 56mm wheels.
    const at = new Date(Date.parse(clock.now()) + 31 * DAY_MS).toISOString();
    const completeId = seeded.products["SKATE-COMP-100"];
    const effective = await call("GET", `/products/${completeId}/bom/effective?at=${encodeURIComponent(at)}`);
    assert.equal(effective.body.code, "B");
    const explosion = await call(
      "GET",
      `/products/${completeId}/bom/explosion?at=${encodeURIComponent(at)}&quantity=5`,
    );
    const codes = explosion.body.root.children.map((c: any) => c.productCode);
    assert.ok(codes.includes("WHEEL-56"));
    assert.ok(!codes.includes("WHEEL-54"));
    const wheel = explosion.body.root.children.find((c: any) => c.productCode === "WHEEL-56");
    assert.equal(wheel.extendedQuantity, 20);
  });

  it("exposes the tenant's event stream", async () => {
    const events = await call("GET", "/events?type=plm.eco.implemented");
    assert.equal(events.status, 200);
    assert.equal(events.body.length, 1);
    assert.equal(events.body[0].payload.number, "ECO-00001");
  });

  it("maps domain errors to HTTP statuses", async () => {
    const notFound = await call("GET", "/products/prod_nope");
    assert.equal(notFound.status, 404);
    const badBody = await call("POST", "/products", { body: { name: "no code" } });
    assert.equal(badBody.status, 400);
    assert.equal(badBody.body.code, "VALIDATION");
    const conflict = await call("POST", "/products", {
      body: { code: "DECK-MAPLE", name: "Dup", type: "purchased", baseUom: "EA" },
    });
    assert.equal(conflict.status, 409);
    const unknownRoute = await call("GET", "/warehouse");
    assert.equal(unknownRoute.status, 404);
    assert.equal(unknownRoute.body.code, "ROUTE_NOT_FOUND");
  });
});
