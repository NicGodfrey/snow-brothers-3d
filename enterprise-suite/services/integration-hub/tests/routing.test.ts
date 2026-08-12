import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConflictError, DomainError } from "@enterprise-suite/shared-kernel";
import { IntegrationEventTypes } from "../src/domain/events.js";
import {
  describeFilter,
  evaluateFilter,
  validateFilterExpression,
  type FilterExpression,
} from "../src/domain/filter.js";
import { routingContext } from "../src/domain/routing.js";
import {
  applyTransform,
  getPath,
  renderTemplate,
  validateTransformSpec,
} from "../src/domain/transform.js";
import { domainEvent, harness, ncrOpened, orderPlaced, otherTenantCtx, ulid } from "./helpers.js";

describe("path access", () => {
  const source = {
    orderId: "SO-1",
    total: { amount: 25_000, currency: "EUR" },
    lines: [{ sku: "A", qty: 2 }, { sku: "B", qty: 5 }],
    grid: [[1, 2], [3, 4]],
  };

  it("reads nested keys and array indexes", () => {
    assert.equal(getPath(source, "orderId"), "SO-1");
    assert.equal(getPath(source, "total.amount"), 25_000);
    assert.equal(getPath(source, "lines[1].sku"), "B");
    assert.equal(getPath(source, "grid[1][0]"), 3);
    assert.deepEqual(getPath(source, "$"), source);
  });

  it("returns undefined for any missing link instead of throwing", () => {
    assert.equal(getPath(source, "missing"), undefined);
    assert.equal(getPath(source, "total.missing.deeper"), undefined);
    assert.equal(getPath(source, "lines[9].sku"), undefined);
    assert.equal(getPath(source, "orderId.nope"), undefined);
    assert.equal(getPath(undefined, "a.b"), undefined);
  });

  it("renders templates, blanking missing values", () => {
    assert.equal(
      renderTemplate("{{orderId}} for {{total.amount}} {{total.currency}}", source),
      "SO-1 for 25000 EUR",
    );
    assert.equal(renderTemplate("[{{ total.amount }}]", source), "[25000]");
    assert.equal(renderTemplate("x={{nope}}", source), "x=");
    assert.equal(renderTemplate("{{total}}", source), '{"amount":25000,"currency":"EUR"}');
  });
});

describe("filters", () => {
  const context = routingContext(orderPlaced({ tenantId: "tenant-acme" } as never, "SO-1", 25_000));

  const matches = (expression: FilterExpression) =>
    evaluateFilter(validateFilterExpression(expression), context);

  it("evaluates comparison and membership operators", () => {
    assert.equal(matches({ all: [{ path: "payload.total.amount", op: "gt", value: 10_000 }] }), true);
    assert.equal(matches({ all: [{ path: "payload.total.amount", op: "gt", value: 50_000 }] }), false);
    assert.equal(matches({ all: [{ path: "payload.total.amount", op: "lte", value: 25_000 }] }), true);
    assert.equal(matches({ all: [{ path: "payload.region", op: "in", value: ["EU", "UK"] }] }), true);
    assert.equal(matches({ all: [{ path: "payload.region", op: "nin", value: ["US"] }] }), true);
    assert.equal(matches({ all: [{ path: "payload.customerId", op: "eq", value: "CUST-9" }] }), true);
    assert.equal(matches({ all: [{ path: "payload.customerId", op: "neq", value: "CUST-9" }] }), false);
  });

  it("evaluates string and existence operators", () => {
    assert.equal(matches({ all: [{ path: "eventType", op: "starts-with", value: "sales." }] }), true);
    assert.equal(matches({ all: [{ path: "eventType", op: "contains", value: "order" }] }), true);
    assert.equal(matches({ all: [{ path: "eventType", op: "matches", value: "^sales\\..*placed$" }] }), true);
    assert.equal(matches({ all: [{ path: "payload.total", op: "exists" }] }), true);
    assert.equal(matches({ all: [{ path: "payload.discount", op: "missing" }] }), true);
    assert.equal(matches({ all: [{ path: "payload.discount", op: "exists" }] }), false);
  });

  it("combines all / any / none", () => {
    assert.equal(
      matches({
        all: [{ path: "payload.region", op: "eq", value: "EU" }],
        any: [
          { path: "payload.total.amount", op: "gt", value: 1_000_000 },
          { path: "payload.customerId", op: "eq", value: "CUST-9" },
        ],
        none: [{ path: "payload.internal", op: "exists" }],
      }),
      true,
    );
    assert.equal(
      matches({
        all: [{ path: "payload.region", op: "eq", value: "EU" }],
        none: [{ path: "payload.customerId", op: "eq", value: "CUST-9" }],
      }),
      false,
    );
  });

  it("treats incomparable operands as non-matching rather than throwing", () => {
    assert.equal(matches({ all: [{ path: "payload.customerId", op: "gt", value: 5 }] }), false);
    assert.equal(matches({ all: [{ path: "payload.total", op: "contains", value: "EUR" }] }), false);
    assert.equal(matches({ all: [{ path: "payload.missing", op: "starts-with", value: "x" }] }), false);
  });

  it("rejects malformed expressions at write time", () => {
    assert.throws(() => validateFilterExpression({} as FilterExpression), /at least one of: all, any, none/);
    assert.throws(
      () => validateFilterExpression({ all: [{ path: "", op: "eq", value: 1 }] }),
      /requires a 'path'/,
    );
    assert.throws(
      () => validateFilterExpression({ all: [{ path: "a", op: "like" as never, value: 1 }] }),
      /unknown filter operator/,
    );
    assert.throws(() => validateFilterExpression({ all: [{ path: "a", op: "eq" }] }), /requires a 'value'/);
    assert.throws(
      () => validateFilterExpression({ all: [{ path: "a", op: "in", value: "EU" }] }),
      /requires an array value/,
    );
    assert.throws(
      () => validateFilterExpression({ all: [{ path: "a", op: "matches", value: "([" }] }),
      /not a valid regex/,
    );
  });

  it("describes an expression for the API", () => {
    assert.equal(describeFilter(undefined), "match all");
    assert.equal(
      describeFilter({
        all: [{ path: "payload.region", op: "eq", value: "EU" }],
        none: [{ path: "payload.test", op: "exists" }],
      }),
      'payload.region eq "EU" AND NOT (payload.test exists)',
    );
  });
});

describe("transforms", () => {
  const context = routingContext(
    domainEvent({ tenantId: "tenant-acme" } as never, "sales.order.placed", {
      orderId: "SO-1",
      total: { amount: 25_000, currency: "EUR" },
      lines: [
        { sku: "A", qty: 2, price: 10 },
        { sku: "B", qty: 5, price: 4 },
      ],
    }),
  );

  it("builds a partner-shaped payload from paths, literals and templates", () => {
    const spec = validateTransformSpec({
      fields: {
        messageType: { const: "ORDER_CREATE" },
        reference: { path: "payload.orderId" },
        summary: { template: "{{payload.orderId}}: {{payload.total.amount}} {{payload.total.currency}}" },
        amounts: {
          fields: {
            gross: { path: "payload.total.amount" },
            currency: { path: "payload.total.currency" },
            tax: { path: "payload.tax", default: 0 },
          },
        },
      },
    });

    assert.deepEqual(applyTransform(spec, context), {
      messageType: "ORDER_CREATE",
      reference: "SO-1",
      summary: "SO-1: 25000 EUR",
      amounts: { gross: 25_000, currency: "EUR", tax: 0 },
    });
  });

  it("maps arrays with `each`, binding each element to `it`", () => {
    const spec = validateTransformSpec({
      fields: {
        items: {
          each: "payload.lines",
          item: {
            fields: {
              position: { path: "index" },
              article: { path: "it.sku" },
              quantity: { path: "it.qty" },
              label: { template: "{{it.qty}}x{{it.sku}}" },
            },
          },
        },
      },
    });

    assert.deepEqual(applyTransform(spec, context), {
      items: [
        { position: 0, article: "A", quantity: 2, label: "2xA" },
        { position: 1, article: "B", quantity: 5, label: "5xB" },
      ],
    });
  });

  it("yields an empty array when the mapped path is not an array", () => {
    const spec = validateTransformSpec({
      fields: { items: { each: "payload.missing", item: { path: "it" } } },
    });
    assert.deepEqual(applyTransform(spec, context), { items: [] });
  });

  it("omits absent optional fields but fails on a required one", () => {
    assert.deepEqual(
      applyTransform(validateTransformSpec({ fields: { note: { path: "payload.note" } } }), context),
      {},
    );
    assert.throws(
      () =>
        applyTransform(
          validateTransformSpec({ fields: { note: { path: "payload.note", required: true } } }),
          context,
        ),
      /requires missing path 'payload.note'/,
    );
  });

  it("rejects specs that are not data", () => {
    assert.throws(() => validateTransformSpec({ fields: "nope" } as never), /'fields' map/);
    assert.throws(
      () => validateTransformSpec({ fields: { a: { unknown: 1 } as never } }),
      /must have one of: const, path, template, fields, each/,
    );
    assert.throws(
      () => validateTransformSpec({ fields: { a: { path: "payload.a;DROP" } } }),
      /invalid path segment/,
    );
    assert.throws(() => validateTransformSpec({ fields: { a: null as never } }), /must be an object/);
  });
});

describe("route rules", () => {
  const busDestination = { type: "bus", topic: "partner.orders.v2" } as const;

  it("creates a rule and validates its destination", async () => {
    const h = harness();
    const rule = await h.hub.services.routing.create(h.ctx, {
      name: "orders-to-partner",
      eventPatterns: ["sales.order.*"],
      destination: busDestination,
    });

    assert.equal(rule.enabled, true);
    assert.equal(rule.priority, 100);
    assert.equal(h.recorder.ofType(IntegrationEventTypes.RouteRuleCreated).length, 1);

    await assert.rejects(
      () =>
        h.hub.services.routing.create(h.ctx, {
          name: "wildcard-bus",
          eventPatterns: ["sales.**"],
          destination: { type: "bus", topic: "partner.*" },
        }),
      /must be concrete/,
    );
    await assert.rejects(
      () =>
        h.hub.services.routing.create(h.ctx, {
          name: "nowhere",
          eventPatterns: ["sales.**"],
          destination: { type: "carrier" as never, id: "x" } as never,
        }),
      /destination.type must be/,
    );
    await assert.rejects(
      () =>
        h.hub.services.routing.create(h.ctx, {
          name: "bad-priority",
          eventPatterns: ["sales.**"],
          destination: busDestination,
          priority: 5_000,
        }),
      DomainError,
    );
    await assert.rejects(
      () =>
        h.hub.services.routing.create(h.ctx, {
          name: "orders-to-partner",
          eventPatterns: ["sales.**"],
          destination: busDestination,
        }),
      ConflictError,
    );
  });

  it("resolves matching rules in priority then specificity order", async () => {
    const h = harness();
    const create = (name: string, patterns: string[], priority?: number) =>
      h.hub.services.routing.create(h.ctx, {
        name,
        eventPatterns: patterns,
        destination: { type: "bus", topic: `partner.${name}` },
        priority,
      });

    await create("catch-all", ["**"], 10);
    await create("sales-broad", ["sales.**"], 50);
    await create("exact", ["sales.order.placed"], 50);
    await create("urgent", ["sales.order.placed"], 900);

    const resolved = await h.hub.services.routing.resolve(orderPlaced(h.ctx));
    assert.deepEqual(
      resolved.map((r) => r.rule.name),
      ["urgent", "exact", "sales-broad", "catch-all"],
    );
  });

  it("applies content filters and transforms when resolving", async () => {
    const h = harness();
    await h.hub.services.routing.create(h.ctx, {
      name: "large-eu-orders",
      eventPatterns: ["sales.order.placed"],
      destination: busDestination,
      filter: {
        all: [
          { path: "payload.total.amount", op: "gte", value: 10_000 },
          { path: "payload.region", op: "eq", value: "EU" },
        ],
      },
      transform: {
        fields: {
          type: { const: "ORDER" },
          ref: { path: "payload.orderId" },
          value: { path: "payload.total.amount" },
        },
      },
    });

    const big = await h.hub.services.routing.resolve(orderPlaced(h.ctx, "SO-1", 25_000));
    assert.equal(big.length, 1);
    assert.deepEqual(big[0]!.payload, { type: "ORDER", ref: "SO-1", value: 25_000 });

    const small = await h.hub.services.routing.resolve(orderPlaced(h.ctx, "SO-2", 500));
    assert.equal(small.length, 0);

    const rule = (await h.hub.services.routing.list(h.ctx))[0]!;
    assert.equal(rule.matchCount, 1);
    assert.equal(rule.lastMatchedAt, h.clock.now());
  });

  it("passes the raw payload through when no transform is configured", async () => {
    const h = harness();
    await h.hub.services.routing.create(h.ctx, {
      name: "passthrough",
      eventPatterns: ["quality.**"],
      destination: busDestination,
    });
    const event = ncrOpened(h.ctx);
    const [resolved] = await h.hub.services.routing.resolve(event);
    assert.deepEqual(resolved!.payload, event.payload);
  });

  it("skips disabled rules and other tenants' rules", async () => {
    const h = harness();
    const rule = await h.hub.services.routing.create(h.ctx, {
      name: "orders",
      eventPatterns: ["sales.**"],
      destination: busDestination,
    });

    await h.hub.services.routing.disable(h.ctx, rule.id);
    assert.equal((await h.hub.services.routing.resolve(orderPlaced(h.ctx))).length, 0);
    await assert.rejects(() => h.hub.services.routing.disable(h.ctx, rule.id), ConflictError);

    await h.hub.services.routing.enable(h.ctx, rule.id);
    assert.equal((await h.hub.services.routing.resolve(orderPlaced(h.ctx))).length, 1);

    const other = otherTenantCtx();
    assert.equal((await h.hub.services.routing.resolve(orderPlaced(other))).length, 0);
    await assert.rejects(
      () => h.hub.services.routing.preview(h.ctx, orderPlaced(other)),
      ConflictError,
    );
  });

  it("previews without recording a match", async () => {
    const h = harness();
    const rule = await h.hub.services.routing.create(h.ctx, {
      name: "orders",
      eventPatterns: ["sales.**"],
      destination: busDestination,
    });
    const preview = await h.hub.services.routing.preview(h.ctx, orderPlaced(h.ctx));

    assert.equal(preview.length, 1);
    assert.equal((await h.hub.services.routing.get(h.ctx, rule.id)).matchCount, 0);
  });

  it("updates patterns, filter and transform, and clears them with null", async () => {
    const h = harness();
    const rule = await h.hub.services.routing.create(h.ctx, {
      name: "orders",
      eventPatterns: ["sales.order.placed"],
      destination: busDestination,
      filter: { all: [{ path: "payload.region", op: "eq", value: "US" }] },
      transform: { fields: { ref: { path: "payload.orderId" } } },
    });
    assert.equal((await h.hub.services.routing.resolve(orderPlaced(h.ctx))).length, 0);

    await h.hub.services.routing.update(h.ctx, rule.id, {
      eventPatterns: ["sales.**", "quality.**"],
      filter: null,
      transform: null,
      priority: 300,
    });

    const updated = await h.hub.services.routing.get(h.ctx, rule.id);
    assert.equal(updated.filter, undefined);
    assert.equal(updated.transform, undefined);
    assert.equal(updated.priority, 300);
    const [resolved] = await h.hub.services.routing.resolve(orderPlaced(h.ctx));
    assert.deepEqual(resolved!.payload, orderPlaced(h.ctx).payload);
    assert.equal((await h.hub.services.routing.resolve(ncrOpened(h.ctx))).length, 1);
  });

  it("only deletes a disabled rule", async () => {
    const h = harness();
    const rule = await h.hub.services.routing.create(h.ctx, {
      name: "orders",
      eventPatterns: ["sales.**"],
      destination: { type: "adapter", adapterId: ulid("adapter_1") },
    });
    await assert.rejects(() => h.hub.services.routing.delete(h.ctx, rule.id), ConflictError);
    await h.hub.services.routing.disable(h.ctx, rule.id);
    await h.hub.services.routing.delete(h.ctx, rule.id);
    assert.equal((await h.hub.services.routing.list(h.ctx)).length, 0);
  });
});
