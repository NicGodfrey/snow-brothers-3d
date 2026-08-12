import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { TenantId, Ulid } from "@enterprise-suite/shared-kernel";
import { Site } from "../src/domain/site.js";
import { haversineKm } from "../src/domain/address.js";
import { US_ADDRESS, expectRejects, expectThrows, world } from "./helpers.js";

const TENANT = "acme" as TenantId;
const CUSTOMER = "01JA000000000000000000CUST" as Ulid;
const T0 = "2026-01-01T00:00:00.000Z" as never;
const T1 = "2026-06-01T00:00:00.000Z" as never;

const BOSTON = { latitude: 42.3505, longitude: -71.0754 };
const CAMBRIDGE = { latitude: 42.3736, longitude: -71.1097 };
const CHICAGO = { latitude: 41.8781, longitude: -87.6298 };

function site(overrides: Record<string, unknown> = {}): Site {
  return Site.create(TENANT, {
    customerId: CUSTOMER,
    code: "hq",
    name: "Head office",
    roles: ["bill_to"],
    address: US_ADDRESS,
    effectiveFrom: T0,
    ...overrides,
  } as Parameters<typeof Site.create>[1]);
}

describe("site creation", () => {
  it("normalises the code and sorts roles canonically", () => {
    const created = site({ roles: ["ship_to", "bill_to", "ship_to"] });
    assert.equal(created.code, "HQ");
    assert.deepEqual(created.roles, ["ship_to", "bill_to"]);
    assert.equal(created.timezone, "UTC");
    assert.equal(created.active, true);
    const [event] = created.pullEvents();
    assert.equal(event?.eventType, "mdm.site.created");
  });

  it("rejects bad codes, blank names and empty role sets", () => {
    expectThrows(() => site({ code: "!" }), "VALIDATION", "code");
    expectThrows(() => site({ name: "  " }), "VALIDATION", "name");
    expectThrows(() => site({ roles: [] }), "VALIDATION", "at least one role");
    expectThrows(() => site({ roles: ["warehouse"] }), "VALIDATION", "unknown site role");
  });

  it("insists that a goods-receiving site has a deliverable address", () => {
    const incomplete = { line1: "1 Main St", city: "Boston", countryCode: "US" };
    // A bill-to only needs to be postable enough to invoice.
    site({ roles: ["bill_to"], address: incomplete });
    expectThrows(
      () => site({ roles: ["ship_to"], address: incomplete }),
      "ADDRESS_INVALID",
      "postalCode",
    );
    expectThrows(
      () => site({ roles: ["service"], address: { ...US_ADDRESS, region: "ZZ" } }),
      "ADDRESS_INVALID",
      "region",
    );
  });
});

describe("effective-dated addresses", () => {
  it("keeps the old address resolvable for back-dated documents", () => {
    const created = site();
    created.pullEvents();
    const moved = created.changeAddress(
      { line1: "1 Beacon Street", city: "Boston", region: "MA", postalCode: "02108", countryCode: "US" },
      T1,
      "Lease ended",
    );
    assert.equal(moved.postalCode, "02108");
    assert.equal(created.addressAt("2026-03-01T00:00:00.000Z").postalCode, "02116");
    assert.equal(created.addressAt("2026-06-01T00:00:00.000Z").postalCode, "02108");
    // Documents dated before the site existed fall back to its first address.
    assert.equal(created.addressAt("2025-01-01T00:00:00.000Z").postalCode, "02116");
    assert.equal(created.address.postalCode, "02108");
    assert.equal(created.addressHistory[0]?.effectiveTo, T1);
    assert.equal(created.addressHistory[1]?.reason, "Lease ended");
    const [event] = created.pullEvents();
    assert.equal(event?.eventType, "mdm.site.address-changed");
  });

  it("refuses a relocation that starts before the current period", () => {
    const created = site();
    expectThrows(
      () => created.changeAddress(US_ADDRESS, "2025-12-31T00:00:00.000Z" as never),
      "INVALID_STATE",
      "must start after",
    );
    expectThrows(() => created.changeAddress(US_ADDRESS, "not-a-date" as never), "VALIDATION");
  });

  it("re-validates deliverability when the address changes", () => {
    const created = site({ roles: ["ship_to"] });
    expectThrows(
      () => created.changeAddress({ line1: "1 Main St", city: "Boston", countryCode: "US" }, T1),
      "ADDRESS_INVALID",
    );
  });
});

describe("roles and lifecycle", () => {
  it("drops the primary badge for a role the site no longer performs", () => {
    const created = site({ roles: ["ship_to", "bill_to"] });
    created.markPrimaryFor("ship_to", true);
    created.markPrimaryFor("bill_to", true);
    created.setRoles(["bill_to"]);
    assert.deepEqual(created.roles, ["bill_to"]);
    assert.deepEqual(created.primaryForRoles, ["bill_to"]);
  });

  it("will not make a site primary for a role it does not hold", () => {
    const created = site({ roles: ["bill_to"] });
    expectThrows(() => created.markPrimaryFor("ship_to", true), "INVALID_STATE", "does not have");
    // Setting the same value twice is a no-op rather than an error.
    created.markPrimaryFor("bill_to", true);
    created.pullEvents();
    created.markPrimaryFor("bill_to", true);
    assert.deepEqual(created.pullEvents(), []);
  });

  it("blocks deactivation while the site is a primary and freezes edits after", () => {
    const created = site();
    created.markPrimaryFor("bill_to", true);
    expectThrows(() => created.deactivate("Closed"), "INVALID_STATE", "still primary");
    created.markPrimaryFor("bill_to", false);
    expectThrows(() => created.deactivate("  "), "VALIDATION", "reason");
    created.deactivate("Branch closed");
    assert.equal(created.active, false);
    expectThrows(() => created.updateDetails({ name: "New name" }), "INVALID_STATE", "inactive");
    expectThrows(() => created.changeAddress(US_ADDRESS, T1), "INVALID_STATE");
    created.reactivate();
    assert.equal(created.active, true);
    expectThrows(() => created.reactivate(), "INVALID_STATE", "already active");
  });
});

describe("site service", () => {
  async function withCustomer() {
    const context = world();
    const customer = await context.container.services.customer.create(context.ctx, {
      legalName: "Northwind Traders",
      classification: "mid_market",
      registeredAddress: US_ADDRESS,
    });
    return { ...context, customer };
  }

  it("scopes site codes to the customer, not the tenant", async () => {
    const { container, ctx, customer } = await withCustomer();
    const other = await container.services.customer.create(ctx, {
      legalName: "Contoso",
      classification: "small_business",
      registeredAddress: US_ADDRESS,
    });
    await container.services.site.create(ctx, {
      customerId: customer.id,
      code: "HQ",
      name: "Head office",
      roles: ["bill_to"],
      address: US_ADDRESS,
    });
    await expectRejects(
      container.services.site.create(ctx, {
        customerId: customer.id,
        code: "hq",
        name: "Duplicate",
        roles: ["bill_to"],
        address: US_ADDRESS,
      }),
      "CONFLICT",
    );
    // The same code is fine under a different customer.
    const twin = await container.services.site.create(ctx, {
      customerId: other.id,
      code: "HQ",
      name: "Head office",
      roles: ["bill_to"],
      address: US_ADDRESS,
    });
    assert.equal(twin.code, "HQ");
  });

  it("refuses an unknown customer and a merged one", async () => {
    const { container, ctx, customer } = await withCustomer();
    await expectRejects(
      container.services.site.create(ctx, {
        customerId: "01JA00000000000000000GHOST" as Ulid,
        code: "HQ",
        name: "Head office",
        roles: ["bill_to"],
        address: US_ADDRESS,
      }),
      "NOT_FOUND",
    );
    const duplicate = await container.services.customer.create(ctx, {
      legalName: "Northwind Traders",
      classification: "mid_market",
      registeredAddress: US_ADDRESS,
    });
    await container.services.customer.merge(ctx, customer.id, duplicate.id);
    await expectRejects(
      container.services.site.create(ctx, {
        customerId: duplicate.id,
        code: "BR1",
        name: "Branch",
        roles: ["bill_to"],
        address: US_ADDRESS,
      }),
      "INVALID_STATE",
      "merged",
    );
  });

  it("validates a GLN check digit before storing it", async () => {
    const { container, ctx, customer } = await withCustomer();
    await expectRejects(
      container.services.site.create(ctx, {
        customerId: customer.id,
        code: "HQ",
        name: "Head office",
        roles: ["bill_to"],
        address: US_ADDRESS,
        gln: "4012345678900",
      }),
      "VALIDATION",
      "check digit",
    );
    const created = await container.services.site.create(ctx, {
      customerId: customer.id,
      code: "HQ",
      name: "Head office",
      roles: ["bill_to"],
      address: US_ADDRESS,
      gln: "4012345678901",
    });
    assert.equal(created.gln, "4012345678901");
  });

  it("keeps at most one primary site per role", async () => {
    const { container, ctx, customer } = await withCustomer();
    const first = await container.services.site.create(ctx, {
      customerId: customer.id,
      code: "WH1",
      name: "Warehouse 1",
      roles: ["ship_to"],
      address: US_ADDRESS,
      primaryForRoles: ["ship_to"],
    });
    assert.deepEqual(first.primaryForRoles, ["ship_to"]);

    const second = await container.services.site.create(ctx, {
      customerId: customer.id,
      code: "WH2",
      name: "Warehouse 2",
      roles: ["ship_to"],
      address: US_ADDRESS,
    });
    await container.services.site.setPrimary(ctx, second.id, "ship_to");

    assert.equal((await container.services.site.get(ctx, first.id)).isPrimaryFor("ship_to"), false);
    assert.equal((await container.services.site.primaryFor(ctx, customer.id, "ship_to"))?.code, "WH2");
    assert.equal((await container.services.site.resolveForRole(ctx, customer.id, "ship_to")).code, "WH2");
  });

  it("resolves the only candidate for a role but refuses to guess", async () => {
    const { container, ctx, customer } = await withCustomer();
    await expectRejects(
      container.services.site.resolveForRole(ctx, customer.id, "ship_to"),
      "NOT_FOUND",
    );
    const only = await container.services.site.create(ctx, {
      customerId: customer.id,
      code: "WH1",
      name: "Warehouse 1",
      roles: ["ship_to"],
      address: US_ADDRESS,
    });
    assert.equal((await container.services.site.resolveForRole(ctx, customer.id, "ship_to")).id, only.id);

    await container.services.site.create(ctx, {
      customerId: customer.id,
      code: "WH2",
      name: "Warehouse 2",
      roles: ["ship_to"],
      address: US_ADDRESS,
    });
    await expectRejects(
      container.services.site.resolveForRole(ctx, customer.id, "ship_to"),
      "INVALID_STATE",
      "no primary",
    );
    // A deactivated site stops being a candidate.
    await container.services.site.deactivate(ctx, only.id, "Closed");
    assert.equal((await container.services.site.resolveForRole(ctx, customer.id, "ship_to")).code, "WH2");
  });

  it("stamps the clock on a relocation when no date is given", async () => {
    const { container, ctx, customer, clock } = await withCustomer();
    const created = await container.services.site.create(ctx, {
      customerId: customer.id,
      code: "HQ",
      name: "Head office",
      roles: ["bill_to"],
      address: US_ADDRESS,
    });
    clock.set("2026-04-01T00:00:00.000Z");
    await container.services.site.changeAddress(ctx, created.id, {
      line1: "1 Beacon Street",
      city: "Boston",
      region: "MA",
      postalCode: "02108",
      countryCode: "US",
    });
    const reloaded = await container.services.site.get(ctx, created.id);
    assert.equal(reloaded.addressAt("2026-03-31T00:00:00.000Z").postalCode, "02116");
    assert.equal(reloaded.addressAt("2026-04-01T00:00:00.000Z").postalCode, "02108");
  });

  it("filters sites by role, country and activity", async () => {
    const { container, ctx, customer } = await withCustomer();
    await container.services.site.create(ctx, {
      customerId: customer.id,
      code: "WH1",
      name: "Warehouse 1",
      roles: ["ship_to"],
      address: US_ADDRESS,
    });
    const berlin = await container.services.site.create(ctx, {
      customerId: customer.id,
      code: "BER",
      name: "Berlin office",
      roles: ["bill_to"],
      address: { line1: "Hauptstrasse 1", city: "Berlin", postalCode: "10115", countryCode: "DE" },
    });
    await container.services.site.deactivate(ctx, berlin.id, "Office closed");

    const shipTo = await container.services.site.list(ctx, { role: "ship_to" });
    assert.deepEqual(shipTo.items.map((s) => s.code), ["WH1"]);
    const german = await container.services.site.list(ctx, { countryCode: "DE" });
    assert.deepEqual(german.items.map((s) => s.code), ["BER"]);
    const active = await container.services.site.list(ctx, { active: true });
    assert.deepEqual(active.items.map((s) => s.code), ["WH1"]);
    assert.equal((await container.services.site.forCustomer(ctx, customer.id)).length, 2);
  });

  it("ranks nearby sites by great-circle distance", async () => {
    const { container, ctx, customer } = await withCustomer();
    await container.services.site.create(ctx, {
      customerId: customer.id,
      code: "CAM",
      name: "Cambridge lab",
      roles: ["service"],
      address: { ...US_ADDRESS, city: "Cambridge", postalCode: "02139", coordinates: CAMBRIDGE },
    });
    await container.services.site.create(ctx, {
      customerId: customer.id,
      code: "CHI",
      name: "Chicago depot",
      roles: ["service"],
      address: {
        line1: "233 S Wacker Dr",
        city: "Chicago",
        region: "IL",
        postalCode: "60606",
        coordinates: CHICAGO,
        countryCode: "US",
      },
    });
    // A site with no coordinates cannot be ranked and is skipped.
    await container.services.site.create(ctx, {
      customerId: customer.id,
      code: "HQ",
      name: "Head office",
      roles: ["service"],
      address: US_ADDRESS,
    });

    const nearby = await container.services.site.nearest(ctx, BOSTON, { radiusKm: 50 });
    assert.deepEqual(nearby.map((hit) => hit.site.code), ["CAM"]);
    assert.ok(nearby[0]!.distanceKm < 5);

    const wide = await container.services.site.nearest(ctx, BOSTON, { radiusKm: 2_000 });
    assert.deepEqual(wide.map((hit) => hit.site.code), ["CAM", "CHI"]);
    assert.deepEqual(
      await container.services.site.nearest(ctx, BOSTON, { radiusKm: 2_000, role: "bill_to" }),
      [],
    );
    assert.equal(Math.round(haversineKm(BOSTON, CHICAGO)), 1364);
  });

  it("publishes site events through the outbox", async () => {
    const { container, ctx, customer } = await withCustomer();
    const created = await container.services.site.create(ctx, {
      customerId: customer.id,
      code: "WH1",
      name: "Warehouse 1",
      roles: ["ship_to"],
      address: US_ADDRESS,
      primaryForRoles: ["ship_to"],
    });
    await container.services.site.setRoles(ctx, created.id, ["ship_to", "return_to"]);
    assert.deepEqual(
      container.outbox
        .entries(ctx.tenantId)
        .map((event) => event.eventType)
        .filter((type) => type.startsWith("mdm.site.")),
      ["mdm.site.created", "mdm.site.primary-changed", "mdm.site.roles-changed"],
    );
  });
});
