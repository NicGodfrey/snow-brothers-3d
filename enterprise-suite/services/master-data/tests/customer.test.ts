import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { TenantId, Ulid } from "@enterprise-suite/shared-kernel";
import { Customer, assertTransition, canTransact, canTransition } from "../src/domain/customer.js";
import {
  DEFAULT_THRESHOLDS,
  jaroWinkler,
  levenshtein,
  mergeConflicts,
  nameSimilarity,
  nameTokens,
  normalizeCompanyName,
  scoreMatch,
  tokenSetSimilarity,
} from "../src/domain/matching.js";
import { normalizeAddress } from "../src/domain/address.js";
import { moneyFromMinor } from "../src/domain/currency.js";
import { formatCustomerNumber } from "../src/application/customer-service.js";
import { US_ADDRESS, expectRejects, expectThrows, world } from "./helpers.js";

const TENANT = "acme" as TenantId;
const ACTOR = "steward-1" as never;
const NOW = "2026-01-01T00:00:00.000Z" as never;

function customer(overrides: Record<string, unknown> = {}): Customer {
  return Customer.create(TENANT, {
    number: "C-000001",
    legalName: "Northwind Traders, Inc.",
    classification: "mid_market",
    registeredAddress: US_ADDRESS,
    ...overrides,
  } as Parameters<typeof Customer.create>[1]);
}

describe("customer lifecycle", () => {
  it("starts in draft with a normalised number and address", () => {
    const record = customer({ number: " c-000001 " });
    assert.equal(record.number, "C-000001");
    assert.equal(record.status, "draft");
    assert.equal(record.canTransact(), false);
    assert.equal(String(record.registeredAddress.countryCode), "US");
    assert.equal(record.currency, "USD");
    const [event] = record.pullEvents();
    assert.equal(event?.eventType, "mdm.customer.created");
  });

  it("rejects malformed numbers, names and classifications", () => {
    expectThrows(() => customer({ number: "C!" }), "VALIDATION", "number");
    expectThrows(() => customer({ legalName: "   " }), "VALIDATION", "legalName");
    expectThrows(() => customer({ classification: "vip" }), "VALIDATION", "classification");
    expectThrows(() => customer({ currency: "XYZ" }), "CURRENCY_ERROR");
  });

  it("needs a registration identifier before it can go active", () => {
    const record = customer();
    expectThrows(() => record.changeStatus("active", ACTOR), "INVALID_STATE", "identifier");
    record.addIdentifier({ scheme: "duns", value: "15-048-3782" }, NOW);
    record.changeStatus("active", ACTOR);
    assert.equal(record.canTransact(), true);
  });

  it("enforces the status machine and demands a reason for holds", () => {
    assert.equal(canTransition("draft", "active"), true);
    assert.equal(canTransition("draft", "on_hold"), false);
    assert.equal(canTransition("merged", "active"), false);
    assert.equal(canTransact("on_hold"), false);
    expectThrows(() => assertTransition("active", "active"), "INVALID_STATE", "already");
    expectThrows(() => assertTransition("draft", "blocked"), "INVALID_STATE", "Illegal");

    const record = customer();
    record.addIdentifier({ scheme: "duns", value: "150483782" }, NOW);
    record.changeStatus("active", ACTOR);
    expectThrows(() => record.changeStatus("on_hold", ACTOR), "VALIDATION", "reason");
    record.changeStatus("on_hold", ACTOR, "Overdue receivables");
    record.changeStatus("blocked", ACTOR, "Sanctions review");
    record.changeStatus("inactive", ACTOR);
    // Reactivation from inactive skips the identifier gate, which only guards
    // the first activation out of draft.
    record.changeStatus("active", ACTOR);
    assert.equal(record.status, "active");
  });

  it("freezes a merged record", () => {
    const record = customer();
    const survivor = "01JZZZZZZZZZZZZZZZZZZZZZZZ" as Ulid;
    record.markMerged(survivor, ACTOR, { sites: 0, identifiers: 0 });
    assert.equal(record.status, "merged");
    expectThrows(() => record.updateProfile({ legalName: "Anything" }), "INVALID_STATE", "merged");
    expectThrows(() => record.changeStatus("active", ACTOR), "INVALID_STATE", "merged");
    expectThrows(() => record.markMerged(record.id, ACTOR, { sites: 0, identifiers: 0 }), "INVALID_STATE");
  });
});

describe("identifiers and contacts", () => {
  it("stores the canonical form and stamps a verification time", () => {
    const record = customer();
    const stored = record.addIdentifier({ scheme: "vat", value: "de 136695976", countryCode: "DE" }, NOW);
    assert.equal(stored.value, "DE136695976");
    assert.equal(stored.verifiedAt, NOW);
    expectThrows(
      () => record.addIdentifier({ scheme: "vat", value: "DE136695976", countryCode: "DE" }, NOW),
      "INVALID_STATE",
      "already on",
    );
    expectThrows(
      () => record.addIdentifier({ scheme: "duns", value: "12345" }, NOW),
      "VALIDATION",
      "identifiers.duns",
    );
    assert.equal(record.identifierOf("vat")?.value, "DE136695976");
    record.removeIdentifier("vat", "de136695976");
    assert.equal(record.identifiers.length, 0);
    expectThrows(() => record.removeIdentifier("vat", "DE136695976"), "INVALID_STATE", "not registered");
  });

  it("keeps a single primary contact", () => {
    const record = customer();
    const first = record.addContact({ name: "Ada Lovelace", email: "ADA@northwind.example", at: NOW });
    assert.deepEqual(first.roles, ["primary"]);
    assert.equal(first.email, "ada@northwind.example");
    const second = record.addContact({ name: "Grace Hopper", roles: ["primary", "billing"], at: NOW });
    assert.equal(record.primaryContact()?.id, second.id);
    assert.deepEqual(record.contacts[0]?.roles, []);

    expectThrows(() => record.addContact({ name: "X", email: "not-an-email", at: NOW }), "VALIDATION", "email");
    expectThrows(() => record.addContact({ name: " ", at: NOW }), "VALIDATION", "name");
    expectThrows(
      () => record.addContact({ name: "Y", roles: ["owner" as never], at: NOW }),
      "VALIDATION",
      "roles",
    );

    record.removeContact(first.id);
    assert.equal(record.contacts.length, 1);
    expectThrows(() => record.removeContact(first.id), "INVALID_STATE");
  });

  it("keeps the credit limit in the customer's currency", () => {
    const record = customer({ currency: "EUR" });
    expectThrows(
      () => record.setCreditLimit(moneyFromMinor(1000, "USD"), ACTOR, NOW),
      "VALIDATION",
      "customer currency EUR",
    );
    expectThrows(
      () => record.setCreditLimit(moneyFromMinor(-1, "EUR"), ACTOR, NOW),
      "VALIDATION",
      "negative",
    );
    record.setCreditLimit(moneyFromMinor(500_000, "EUR"), ACTOR, NOW, "BBB");
    assert.equal(record.credit.limit?.amountMinor, 500_000);
    assert.equal(record.credit.riskRating, "BBB");
    assert.equal(record.credit.approvedBy, ACTOR);
  });

  it("merges term assignments rather than replacing them wholesale", () => {
    const record = customer();
    record.assignTerms({ paymentTermCode: "NET30" });
    record.assignTerms({ shippingTermCode: "DAP-CUST" });
    assert.deepEqual(record.terms, {
      paymentTermCode: "NET30",
      shippingTermCode: "DAP-CUST",
      priceListCode: undefined,
      incotermPlace: undefined,
    });
  });
});

describe("name and address matching", () => {
  it("strips legal forms and noise words before comparing", () => {
    assert.equal(normalizeCompanyName("Müller & Söhne GmbH"), "muller and sohne gmbh");
    assert.deepEqual(nameTokens("Acme International Holdings Ltd"), ["acme"]);
    assert.equal(nameSimilarity("Acme Ltd", "ACME Limited"), 1);
    assert.equal(nameSimilarity("Northwind Trading", "Trading Northwind"), 1);
    assert.ok(nameSimilarity("Acme Manufacturing", "Acme Mfg") > 0.8);
    assert.ok(nameSimilarity("Acme Manufacturing", "Zenith Logistics") < 0.5);
  });

  it("implements the string metrics it advertises", () => {
    assert.equal(levenshtein("kitten", "sitting"), 3);
    assert.equal(levenshtein("", "abc"), 3);
    assert.equal(levenshtein("same", "same"), 0);
    assert.equal(jaroWinkler("martha", "marhta").toFixed(3), "0.961");
    assert.equal(jaroWinkler("abc", "xyz"), 0);
    assert.equal(tokenSetSimilarity(["a", "b"], ["b", "a"]), 1);
    assert.equal(tokenSetSimilarity(["a", "b"], ["b", "c"]), 0.5);
    assert.equal(tokenSetSimilarity([], []), 1);
  });

  it("treats a shared registration identifier as decisive", () => {
    const score = scoreMatch(
      {
        legalName: "Northwind Traders",
        identifiers: [{ scheme: "vat", value: "DE136695976", countryCode: "DE" }],
      },
      {
        legalName: "Completely Different Name",
        identifiers: [{ scheme: "vat", value: "DE136695976", countryCode: "DE" }],
      },
    );
    assert.equal(score.decision, "duplicate");
    assert.equal(score.score, 1);
    assert.equal(score.signals[0]?.kind, "identifier");
  });

  it("settles an identical name at an identical address without further signals", () => {
    const address = normalizeAddress(US_ADDRESS);
    const score = scoreMatch(
      { legalName: "Northwind Traders Inc", address },
      { legalName: "Northwind Traders Incorporated", address },
    );
    assert.equal(score.decision, "duplicate");
    assert.equal(score.score, 1);
    assert.equal(score.signals.at(-1)?.detail, "identical name at an identical address");
  });

  it("adds up name, address and contact signals", () => {
    const address = normalizeAddress(US_ADDRESS);
    const score = scoreMatch(
      { legalName: "Northwind Traders Inc", address, emailDomains: ["northwind.example"] },
      { legalName: "Northwind Trading Inc", address, emailDomains: ["NORTHWIND.example"] },
    );
    assert.deepEqual(
      score.signals.map((signal) => signal.kind),
      ["name", "address", "contact"],
    );
    assert.equal(score.decision, "duplicate");

    const weaker = scoreMatch(
      { legalName: "Northwind Traders Inc", address },
      { legalName: "Northwind Trading Inc", address: normalizeAddress({ ...US_ADDRESS, line1: "1 Beacon St" }) },
    );
    assert.equal(weaker.decision, "review");
    assert.ok(weaker.score < DEFAULT_THRESHOLDS.duplicate);
  });

  it("never auto-merges across borders", () => {
    const us = normalizeAddress(US_ADDRESS);
    const de = normalizeAddress({
      line1: "500 Boylston Street",
      city: "Boston",
      postalCode: "10115",
      countryCode: "DE",
    });
    const score = scoreMatch({ legalName: "Acme GmbH", address: de }, { legalName: "Acme Inc", address: us });
    assert.equal(score.decision, "review");
    assert.ok(score.score <= DEFAULT_THRESHOLDS.duplicate - 0.01);
    assert.ok(score.signals.some((signal) => signal.kind === "country"));
  });

  it("lists the fields a steward would have to reconcile", () => {
    const conflicts = mergeConflicts(
      {
        legalName: "Northwind Traders Inc",
        tradingName: "Northwind",
        identifiers: [{ scheme: "vat", value: "DE111111111" }],
        address: normalizeAddress(US_ADDRESS),
      },
      {
        legalName: "Northwind Trading Inc",
        tradingName: "Northwind",
        identifiers: [{ scheme: "vat", value: "DE222222222" }],
        address: normalizeAddress({ ...US_ADDRESS, line1: "1 Beacon St" }),
      },
    );
    assert.deepEqual(conflicts.map((conflict) => conflict.field), [
      "legalName",
      "address",
      "identifiers.vat",
    ]);
  });
});

describe("customer service", () => {
  const command = {
    legalName: "Northwind Traders, Inc.",
    classification: "mid_market",
    registeredAddress: US_ADDRESS,
  } as const;

  it("mints sequential numbers and rejects collisions", async () => {
    const { container, ctx } = world();
    assert.equal(formatCustomerNumber(42), "C-000042");
    const first = await container.services.customer.create(ctx, { ...command });
    const second = await container.services.customer.create(ctx, { ...command, legalName: "Contoso" });
    assert.equal(first.number, "C-000001");
    assert.equal(second.number, "C-000002");
    await expectRejects(
      container.services.customer.create(ctx, { ...command, number: "c-000001" }),
      "CONFLICT",
    );
  });

  it("checks the currency against the tenant's enabled set once configured", async () => {
    const { container, ctx } = world();
    // Before configuration anything ISO is accepted, so setup is not blocked.
    await container.services.customer.create(ctx, { ...command, currency: "SEK" });
    await container.services.currency.enable(ctx, { code: "USD", functional: true });
    await expectRejects(
      container.services.customer.create(ctx, { ...command, currency: "SEK" }),
      "CURRENCY_ERROR",
    );
    const ok = await container.services.customer.create(ctx, { ...command, currency: "USD" });
    assert.equal(ok.currency, "USD");
  });

  it("validates code list references but tolerates lists a tenant does not keep", async () => {
    const { container, ctx } = world();
    // No code lists exist yet, so the reference passes through.
    await container.services.customer.create(ctx, { ...command, segmentCode: "ANYTHING" });

    await container.services.codeList.create(ctx, { listCode: "customer_segment", name: "Segment" });
    await container.services.codeList.upsertEntry(ctx, "customer_segment", { code: "KEY", label: "Key" });
    await container.services.codeList.publish(ctx, "customer_segment", "2026-01-01");
    await expectRejects(
      container.services.customer.create(ctx, { ...command, segmentCode: "GHOST" }),
      "CODE_LIST_ERROR",
    );
    const ok = await container.services.customer.create(ctx, { ...command, segmentCode: "KEY" });
    assert.equal(ok.segmentCode, "KEY");
  });

  it("keeps registration identifiers unique across the tenant", async () => {
    const { container, ctx } = world();
    const first = await container.services.customer.create(ctx, { ...command });
    const second = await container.services.customer.create(ctx, { ...command, legalName: "Contoso" });
    await container.services.customer.addIdentifier(ctx, first.id, {
      scheme: "vat",
      value: "DE136695976",
      countryCode: "DE",
    });
    await expectRejects(
      container.services.customer.addIdentifier(ctx, second.id, {
        scheme: "vat",
        value: "de 136695976",
        countryCode: "DE",
      }),
      "CONFLICT",
      "already registered",
    );
  });

  it("refuses terms that are retired", async () => {
    const { container, ctx } = world();
    const record = await container.services.customer.create(ctx, { ...command });
    await container.services.paymentTerm.create(ctx, {
      code: "NET30",
      name: "Net 30",
      due: { kind: "net_days", days: 30 },
    });
    await container.services.customer.assignTerms(ctx, record.id, { paymentTermCode: "NET30" });
    await container.services.paymentTerm.retire(ctx, "NET30", "Replaced");
    await expectRejects(
      container.services.customer.assignTerms(ctx, record.id, { paymentTermCode: "NET30" }),
      "INVALID_STATE",
      "retired",
    );
    await expectRejects(
      container.services.customer.assignTerms(ctx, record.id, { shippingTermCode: "GHOST" }),
      "NOT_FOUND",
    );
  });

  it("records a block reason code against the governed list", async () => {
    const { container, ctx } = world();
    await container.services.codeList.create(ctx, { listCode: "block_reason", name: "Block reason" });
    await container.services.codeList.upsertEntry(ctx, "block_reason", {
      code: "CREDIT",
      label: "Credit limit exceeded",
    });
    await container.services.codeList.publish(ctx, "block_reason", "2026-01-01");

    const record = await container.services.customer.create(ctx, { ...command });
    await container.services.customer.addIdentifier(ctx, record.id, {
      scheme: "duns",
      value: "150483782",
    });
    await container.services.customer.changeStatus(ctx, record.id, "active");
    await expectRejects(
      container.services.customer.changeStatus(ctx, record.id, "on_hold", "Late", "GHOST"),
      "CODE_LIST_ERROR",
    );
    const held = await container.services.customer.changeStatus(
      ctx,
      record.id,
      "on_hold",
      "Two invoices overdue",
      "CREDIT",
    );
    assert.equal(held.status, "on_hold");
  });

  it("prevents hierarchy cycles and walks ancestors", async () => {
    const { container, ctx } = world();
    const parent = await container.services.customer.create(ctx, { ...command, legalName: "Group" });
    const child = await container.services.customer.create(ctx, { ...command, legalName: "Division" });
    const grandchild = await container.services.customer.create(ctx, { ...command, legalName: "Branch" });
    await container.services.customer.setParent(ctx, child.id, parent.id);
    await container.services.customer.setParent(ctx, grandchild.id, child.id);

    assert.deepEqual(
      (await container.services.customer.ancestors(ctx, grandchild.id)).map((c) => c.legalName),
      ["Division", "Group"],
    );
    await expectRejects(
      container.services.customer.setParent(ctx, parent.id, grandchild.id),
      "INVALID_STATE",
      "cycle",
    );
    await expectRejects(
      container.services.customer.setParent(ctx, parent.id, parent.id),
      "INVALID_STATE",
    );

    const tree = await container.services.customer.hierarchy(ctx, parent.id);
    assert.equal(tree.children.length, 1);
    assert.equal(tree.children[0]?.children[0]?.customer.legalName, "Branch");
  });

  it("blocks a duplicate on creation when asked to", async () => {
    const { container, ctx } = world();
    await container.services.customer.create(ctx, { ...command });
    await expectRejects(
      container.services.customer.create(ctx, {
        ...command,
        legalName: "Northwind Traders Incorporated",
        rejectDuplicates: true,
      }),
      "CONFLICT",
      "duplicates C-000001",
    );
    // Without the flag the record is created and simply flagged for review.
    const created = await container.services.customer.create(ctx, {
      ...command,
      legalName: "Northwind Traders Incorporated",
    });
    const duplicates = await container.services.customer.duplicatesOf(ctx, created.id);
    assert.equal(duplicates.length, 1);
    assert.equal(duplicates[0]?.score.decision, "duplicate");
  });

  it("merges a duplicate, moving sites, identifiers and contacts", async () => {
    const { container, ctx } = world();
    const survivor = await container.services.customer.create(ctx, { ...command });
    const duplicate = await container.services.customer.create(ctx, {
      ...command,
      legalName: "Northwind Traders Incorporated",
      externalIds: { salesforce: "0011t000abc" },
    });
    await container.services.customer.addIdentifier(ctx, survivor.id, {
      scheme: "duns",
      value: "150483782",
    });
    await container.services.customer.addIdentifier(ctx, duplicate.id, {
      scheme: "vat",
      value: "DE136695976",
      countryCode: "DE",
    });
    await container.services.customer.addContact(ctx, duplicate.id, {
      name: "Ada Lovelace",
      email: "ada@northwind.example",
    });
    await container.services.site.create(ctx, {
      customerId: survivor.id,
      code: "HQ",
      name: "Head office",
      roles: ["bill_to"],
      address: US_ADDRESS,
    });
    await container.services.site.create(ctx, {
      customerId: duplicate.id,
      code: "HQ",
      name: "Head office (dup)",
      roles: ["bill_to"],
      address: US_ADDRESS,
    });

    const plan = await container.services.customer.planMerge(ctx, survivor.id, duplicate.id);
    assert.equal(plan.sitesToMove.length, 1);
    assert.equal(plan.identifiersToMove.length, 1);
    assert.ok(plan.conflicts.some((conflict) => conflict.field === "legalName"));

    const result = await container.services.customer.merge(ctx, survivor.id, duplicate.id);
    assert.equal(result.movedSites, 1);
    assert.equal(result.movedIdentifiers, 1);
    assert.equal(result.movedContacts, 1);
    assert.deepEqual(result.renamedSiteCodes, ["HQ -> HQ-C-000002"]);
    assert.equal(result.survivor.identifiers.length, 2);
    assert.equal(result.survivor.externalIds.salesforce, "0011t000abc");
    // The moved contact does not steal the survivor's primary badge.
    assert.deepEqual(result.survivor.contacts[0]?.roles, []);
    assert.equal(result.merged.status, "merged");

    // Old ids keep resolving to the survivor.
    assert.equal((await container.services.customer.resolve(ctx, duplicate.id)).id, survivor.id);
    assert.equal((await container.services.site.forCustomer(ctx, survivor.id)).length, 2);
    await expectRejects(
      container.services.customer.merge(ctx, survivor.id, duplicate.id),
      "INVALID_STATE",
      "already merged",
    );
    await expectRejects(
      container.services.customer.merge(ctx, survivor.id, survivor.id),
      "INVALID_STATE",
      "into itself",
    );
  });

  it("hides merged records from listings and duplicate scans", async () => {
    const { container, ctx } = world();
    const survivor = await container.services.customer.create(ctx, { ...command });
    const duplicate = await container.services.customer.create(ctx, {
      ...command,
      legalName: "Northwind Traders Incorporated",
    });
    await container.services.customer.merge(ctx, survivor.id, duplicate.id);
    const page = await container.services.customer.list(ctx);
    assert.deepEqual(page.items.map((c) => c.number), ["C-000001"]);
    const withMerged = await container.services.customer.list(ctx, { includeMerged: true });
    assert.equal(withMerged.items.length, 2);
    assert.deepEqual(await container.services.customer.duplicatesOf(ctx, survivor.id), []);
  });

  it("filters and searches the customer book", async () => {
    const { container, ctx } = world();
    await container.services.customer.create(ctx, {
      ...command,
      legalName: "Northwind Traders",
      classification: "enterprise",
      tags: ["Key", "eu"],
    });
    await container.services.customer.create(ctx, {
      ...command,
      legalName: "Contoso Manufacturing",
      classification: "small_business",
      registeredAddress: {
        line1: "Hauptstrasse 1",
        city: "Berlin",
        postalCode: "10115",
        countryCode: "DE",
      },
    });

    const byClass = await container.services.customer.list(ctx, { classification: "enterprise" });
    assert.deepEqual(byClass.items.map((c) => c.legalName), ["Northwind Traders"]);
    const byCountry = await container.services.customer.list(ctx, { countryCode: "DE" });
    assert.deepEqual(byCountry.items.map((c) => c.legalName), ["Contoso Manufacturing"]);
    const bySearch = await container.services.customer.list(ctx, { search: "contoso" });
    assert.equal(bySearch.items.length, 1);
    const byTag = await container.services.customer.list(ctx, { tag: "key" });
    assert.equal(byTag.items.length, 1);
    const byNumber = await container.services.customer.getByNumber(ctx, "c-000002");
    assert.equal(byNumber.legalName, "Contoso Manufacturing");
  });

  it("keeps two tenants' books apart", async () => {
    const acme = world("acme");
    const globex = world("globex");
    const record = await acme.container.services.customer.create(acme.ctx, { ...command });
    await expectRejects(globex.container.services.customer.get(globex.ctx, record.id), "NOT_FOUND");
    const globexRecord = await globex.container.services.customer.create(globex.ctx, { ...command });
    // Numbering restarts per tenant.
    assert.equal(globexRecord.number, "C-000001");
  });

  it("publishes one event per state change", async () => {
    const { container, ctx } = world();
    const record = await container.services.customer.create(ctx, { ...command });
    await container.services.customer.addIdentifier(ctx, record.id, {
      scheme: "duns",
      value: "150483782",
    });
    await container.services.customer.changeStatus(ctx, record.id, "active");
    await container.services.customer.setCreditLimit(ctx, record.id, {
      amountMinor: 1_000_000,
      currency: "USD",
    });
    assert.deepEqual(
      container.outbox.entries(ctx.tenantId).map((event) => event.eventType),
      [
        "mdm.customer.created",
        "mdm.customer.identifier-added",
        "mdm.customer.status-changed",
        "mdm.customer.credit-limit-changed",
      ],
    );
  });
});
