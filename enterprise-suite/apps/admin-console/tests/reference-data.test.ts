import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InvalidStateError, ValidationError } from "../src/domain/errors.js";
import { ReferenceDataSet } from "../src/domain/reference-data.js";
import { activeTenant, harness, rejects, throwsSync } from "./support.js";

const tenant = "northwind" as never;
const at = (iso: string) => iso as never;

function sites(): ReferenceDataSet {
  const set = ReferenceDataSet.create(tenant, {
    code: "site-hierarchy",
    name: "Sites",
    hierarchical: true,
    entries: [
      { code: "EMEA", label: "Europe, Middle East & Africa", sortOrder: 10 },
      { code: "GB", label: "United Kingdom", parentCode: "EMEA", sortOrder: 20 },
      { code: "LEEDS", label: "Leeds Plant", parentCode: "GB", sortOrder: 30 },
      { code: "DERBY", label: "Derby Plant", parentCode: "GB", sortOrder: 40 },
    ],
  });
  set.pullEvents();
  return set;
}

describe("reference data set", () => {
  it("starts as a draft and orders entries by sort order then code", () => {
    const set = ReferenceDataSet.create(tenant, {
      code: "order-hold-reason",
      name: "Order Hold Reasons",
      entries: [
        { code: "STOCK", label: "Awaiting stock", sortOrder: 20 },
        { code: "CREDIT", label: "Credit hold", sortOrder: 10 },
        { code: "AUDIT", label: "Audit hold", sortOrder: 20 },
      ],
    });

    assert.equal(set.status, "draft");
    assert.deepEqual(
      set.entries.map((entry) => entry.code),
      ["CREDIT", "AUDIT", "STOCK"],
    );
  });

  it("hides a draft from consumers until it is published", () => {
    const h = harness();
    const set = ReferenceDataSet.create(tenant, {
      code: "order-hold-reason",
      name: "Order Hold Reasons",
      entries: [{ code: "CREDIT", label: "Credit hold" }],
    });
    void h;

    assert.equal(set.revision, 1);
    set.publish(at("2026-03-01T09:00:00.000Z"));
    assert.equal(set.status, "published");
    assert.equal(set.revision, 2, "publishing bumps the revision consumers cache on");
    assert.equal(set.pullEvents().at(-1)?.eventType, "admin.reference-data.set-published");
  });

  it("refuses to publish an empty set", () => {
    const set = ReferenceDataSet.create(tenant, { code: "empty-set", name: "Empty" });
    assert.throws(() => set.publish(at("2026-03-01T09:00:00.000Z")), InvalidStateError);
  });

  it("resolves entries at a point in time, not by a boolean", () => {
    const set = ReferenceDataSet.create(tenant, {
      code: "tax-code",
      name: "Tax codes",
      entries: [
        { code: "STD", label: "Standard rate" },
        { code: "OLD", label: "Legacy rate", effectiveTo: "2026-01-01T00:00:00.000Z" },
        { code: "NEW", label: "New rate", effectiveFrom: "2026-06-01T00:00:00.000Z" },
      ],
    });

    const during2025 = set.resolve(at("2025-06-01T00:00:00.000Z")).map((entry) => entry.code);
    assert.deepEqual(during2025.sort(), ["OLD", "STD"], "the legacy code still resolves for old documents");

    const march = set.resolve(at("2026-03-01T00:00:00.000Z")).map((entry) => entry.code);
    assert.deepEqual(march, ["STD"]);

    const july = set.resolve(at("2026-07-01T00:00:00.000Z")).map((entry) => entry.code);
    assert.deepEqual(july.sort(), ["NEW", "STD"]);

    assert.equal(set.lookup("OLD", at("2026-03-01T00:00:00.000Z")), undefined);
    assert.equal(set.lookup("OLD", at("2025-06-01T00:00:00.000Z"))?.label, "Legacy rate");
  });

  it("rejects an effective window that closes before it opens", () => {
    const set = ReferenceDataSet.create(tenant, { code: "tax-code", name: "Tax codes" });
    assert.throws(
      () =>
        set.addEntry({
          code: "BAD",
          label: "Bad window",
          effectiveFrom: "2026-06-01T00:00:00.000Z",
          effectiveTo: "2026-01-01T00:00:00.000Z",
        }),
      ValidationError,
    );
  });

  it("retires a subtree rather than deleting it", () => {
    const set = sites();
    const affected = set.retireEntry("GB", at("2026-03-01T09:00:00.000Z"));

    assert.deepEqual(affected.sort(), ["DERBY", "GB", "LEEDS"]);
    assert.equal(set.entries.length, 4, "nothing is removed");
    assert.deepEqual(
      set.resolve(at("2026-03-02T09:00:00.000Z")).map((entry) => entry.code),
      ["EMEA"],
    );
    assert.deepEqual(
      set.resolve(at("2026-02-01T09:00:00.000Z")).map((entry) => entry.code).sort(),
      ["DERBY", "EMEA", "GB", "LEEDS"],
      "the retirement is dated, so earlier instants are unaffected",
    );
  });

  it("builds a depth-first tree for hierarchical sets", () => {
    const tree = sites().tree();
    assert.equal(tree.length, 1);
    assert.equal(tree[0]?.entry.code, "EMEA");
    assert.deepEqual(
      tree[0]?.children[0]?.children.map((node) => node.entry.code),
      ["LEEDS", "DERBY"],
    );
  });

  it("refuses orphans, self-parents and parents on a flat set", () => {
    const set = sites();
    assert.throws(() => set.addEntry({ code: "PARIS", label: "Paris", parentCode: "FR" }), ValidationError);
    assert.throws(() => set.addEntry({ code: "SELF", label: "Self", parentCode: "SELF" }), ValidationError);

    const flat = ReferenceDataSet.create(tenant, { code: "flat-set", name: "Flat" });
    assert.throws(() => flat.addEntry({ code: "A", label: "A", parentCode: "B" }), ValidationError);
  });

  it("detects a cycle introduced by re-parenting", () => {
    const set = sites();
    const error = throwsSync(() => set.updateEntry("EMEA", { parentCode: "LEEDS" }));
    assert.ok(error instanceof InvalidStateError);
    assert.match(error.message, /cycle/i);
  });

  it("rolls a bulk import back when the new hierarchy does not hold together", () => {
    const set = sites();
    const before = set.entries.map((entry) => entry.code);
    assert.throws(
      () =>
        set.replaceEntries([
          { code: "AMER", label: "Americas" },
          { code: "AUSTIN", label: "Austin", parentCode: "US" },
        ]),
      ValidationError,
    );
    assert.deepEqual(
      set.entries.map((entry) => entry.code),
      before,
      "the previous entries are restored",
    );

    set.replaceEntries([
      { code: "AMER", label: "Americas", sortOrder: 10 },
      { code: "US", label: "United States", parentCode: "AMER", sortOrder: 20 },
    ]);
    assert.deepEqual(set.entries.map((entry) => entry.code), ["AMER", "US"]);
  });

  it("locks platform-owned sets against tenant edits", () => {
    const set = ReferenceDataSet.create(tenant, {
      code: "iso-currency",
      name: "Currencies",
      locked: true,
      entries: [{ code: "GBP", label: "Pound sterling" }],
    });
    assert.throws(() => set.addEntry({ code: "USD", label: "US dollar" }), Error);
    assert.throws(() => set.publish(at("2026-03-01T09:00:00.000Z")), Error);
  });
});

describe("reference data service", () => {
  it("returns nothing for a draft set and everything once published", async () => {
    const h = harness();
    await activeTenant(h);
    const { referenceData } = h.container.services;

    await referenceData.createSet(h.admin, {
      code: "order-hold-reason",
      name: "Order Hold Reasons",
      entries: [
        { code: "CREDIT", label: "Credit hold" },
        { code: "STOCK", label: "Awaiting stock" },
      ],
    });

    assert.deepEqual(
      referenceData.resolve(h.tenantId, "order-hold-reason"),
      [],
      "a domain service must not see a half-built code list",
    );
    assert.deepEqual(Object.keys(referenceData.labels(h.tenantId, "order-hold-reason")).sort(), [
      "CREDIT",
      "STOCK",
    ]);

    await referenceData.publish(h.admin, "order-hold-reason");
    assert.equal(referenceData.resolve(h.tenantId, "order-hold-reason").length, 2);
  });

  it("refuses edits to a deprecated set", async () => {
    const h = harness();
    await activeTenant(h);
    const { referenceData } = h.container.services;

    await referenceData.createSet(h.admin, {
      code: "order-hold-reason",
      name: "Order Hold Reasons",
      entries: [{ code: "CREDIT", label: "Credit hold" }],
    });
    await referenceData.publish(h.admin, "order-hold-reason");
    await referenceData.deprecate(h.admin, "order-hold-reason");

    const error = await rejects(() =>
      referenceData.addEntry(h.admin, "order-hold-reason", { code: "STOCK", label: "Stock" }),
    );
    assert.match(error.message, /deprecated/);
  });

  it("emits an event per publish so caches can be invalidated", async () => {
    const h = harness();
    await activeTenant(h);
    const { referenceData } = h.container.services;

    await referenceData.createSet(h.admin, {
      code: "order-hold-reason",
      name: "Order Hold Reasons",
      entries: [{ code: "CREDIT", label: "Credit hold" }],
    });
    await referenceData.publish(h.admin, "order-hold-reason");

    const published = h.container.outbox.ofType(h.tenantId, "admin.reference-data.set-published");
    assert.equal(published.length, 1);
    assert.equal((published[0]?.payload as { revision: number }).revision, 2);
  });
});
