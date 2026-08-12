import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { brand, type EventEnvelope, type TenantId, type Ulid } from "@enterprise-suite/shared-kernel";
import { InMemoryEventBus } from "../src/in-memory-bus.js";
import {
  composeMiddleware,
  correlationMiddleware,
  filterMiddleware,
  loggingMiddleware,
  requireTenantMiddleware,
  tapMiddleware,
  tenantScopeMiddleware,
  type PublishMiddleware,
} from "../src/middleware.js";
import { ImmediateScheduler } from "../src/scheduler.js";
import { collect, testEvent } from "../src/testing.js";

const tenant = (value: string) => brand<string, "TenantId">(value) as TenantId;

function bus(middleware: PublishMiddleware[] = []): InMemoryEventBus {
  return new InMemoryEventBus({ scheduler: new ImmediateScheduler(), middleware });
}

describe("composeMiddleware", () => {
  it("runs left to right and unwinds right to left", async () => {
    const order: string[] = [];
    const trace = (name: string): PublishMiddleware => async (event, next) => {
      order.push(`>${name}`);
      await next(event);
      order.push(`<${name}`);
    };

    await composeMiddleware([trace("a"), trace("b"), trace("c")], async () => {
      order.push("terminal");
    })(testEvent("a.b.c", {}));

    assert.deepEqual(order, [">a", ">b", ">c", "terminal", "<c", "<b", "<a"]);
  });

  it("stops the chain when a middleware does not call next", async () => {
    let reached = false;
    await composeMiddleware(
      [async () => {}, async (event, next) => next(event)],
      async () => {
        reached = true;
      },
    )(testEvent("a.b.c", {}));
    assert.equal(reached, false);
  });

  it("lets a middleware rewrite the event seen downstream", async () => {
    let delivered: EventEnvelope | undefined;
    const rewrite: PublishMiddleware = async (event, next) =>
      next({ ...event, eventType: "rewritten.event" });

    await composeMiddleware([rewrite], async (event) => {
      delivered = event;
    })(testEvent("original.event", { n: 1 }));

    assert.equal(delivered!.eventType, "rewritten.event");
  });

  it("propagates a throw out of publish", async () => {
    const chain = composeMiddleware(
      [
        async () => {
          throw new Error("vetoed");
        },
      ],
      async () => {},
    );
    await assert.rejects(() => chain(testEvent("a.b.c", {})), /vetoed/);
  });
});

describe("bundled middleware", () => {
  it("filterMiddleware drops what the predicate rejects", async () => {
    const b = bus([filterMiddleware((event) => event.eventType.startsWith("sales."))]);
    const seen = collect(b, "**");

    await b.publish(testEvent("sales.order.placed", {}));
    await b.publish(testEvent("quality.ncr.opened", {}));
    await b.drain();

    assert.deepEqual(seen.types(), ["sales.order.placed"]);
    // A vetoed publish is not counted as published either.
    assert.equal(b.metrics().published, 1);
  });

  it("tenantScopeMiddleware confines a bus instance to one tenant", async () => {
    const b = bus([tenantScopeMiddleware(tenant("tenant-acme"))]);
    const seen = collect(b, "**");

    await b.publish(testEvent("sales.order.placed", { n: 1 }, { tenantId: "tenant-acme" }));
    await b.publish(testEvent("sales.order.placed", { n: 2 }, { tenantId: "tenant-other" }));
    await b.drain();

    assert.equal(seen.events.length, 1);
    assert.equal(seen.events[0]!.tenantId, "tenant-acme");
  });

  it("requireTenantMiddleware rejects an untenanted event", async () => {
    const b = bus([requireTenantMiddleware()]);
    const seen = collect(b, "**");

    const orphan = { ...testEvent("sales.order.placed", {}), tenantId: "" as unknown as TenantId };
    await assert.rejects(() => b.publish(orphan), /has no tenantId/);
    await b.publish(testEvent("sales.order.placed", {}));
    await b.drain();

    assert.equal(seen.events.length, 1);
  });

  it("correlationMiddleware stamps only events that lack a correlation id", async () => {
    const stamped = brand<string, "Ulid">("corr_generated") as Ulid;
    const b = bus([correlationMiddleware(() => stamped)]);
    const seen = collect(b, "**");

    const existing = brand<string, "Ulid">("corr_existing") as Ulid;
    await b.publish(testEvent("a.b.c", {}));
    await b.publish({ ...testEvent("a.b.c", {}), correlationId: existing });
    await b.drain();

    assert.deepEqual(
      seen.events.map((event) => event.correlationId),
      [stamped, existing],
    );
  });

  it("tapMiddleware observes without altering the flow", async () => {
    const tapped: string[] = [];
    const b = bus([tapMiddleware((event) => tapped.push(event.eventType))]);
    const seen = collect(b, "**");

    await b.publish(testEvent("a.b.c", {}));
    await b.drain();

    assert.deepEqual(tapped, ["a.b.c"]);
    assert.deepEqual(seen.types(), ["a.b.c"]);
  });

  it("loggingMiddleware records the envelope identity", async () => {
    const lines: { message: string; fields?: Record<string, unknown> }[] = [];
    const b = bus([loggingMiddleware({ debug: (message, fields) => lines.push({ message, fields }) })]);

    const event = testEvent("quality.ncr.opened", { ncr: "NCR-1" });
    await b.publish(event);
    await b.drain();

    assert.equal(lines.length, 1);
    assert.equal(lines[0]!.message, "event.publish");
    assert.equal(lines[0]!.fields?.["eventId"], event.eventId);
    assert.equal(lines[0]!.fields?.["eventType"], "quality.ncr.opened");
  });

  it("applies middleware added with use() after the constructor ones", async () => {
    const order: string[] = [];
    const b = bus([tapMiddleware(() => order.push("constructor"))]);
    b.use(tapMiddleware(() => order.push("use")));

    await b.publish(testEvent("a.b.c", {}));
    await b.drain();

    assert.deepEqual(order, ["constructor", "use"]);
  });

  it("combines a scope and a filter, and both are skipped on a bypassed replay", async () => {
    const b = bus([
      tenantScopeMiddleware(tenant("tenant-acme")),
      filterMiddleware((event) => !event.eventType.endsWith(".internal")),
    ]);
    const seen = collect(b, "**");

    await b.publish(testEvent("a.b.internal", {}, { tenantId: "tenant-acme" }));
    await b.publish(testEvent("a.b.c", {}, { tenantId: "tenant-other" }));
    await b.drain();
    assert.equal(seen.events.length, 0);

    // Replay tooling re-publishes verbatim, chain and all.
    await b.publish(testEvent("a.b.internal", {}, { tenantId: "tenant-other" }), {
      bypassMiddleware: true,
    });
    await b.drain();
    assert.equal(seen.events.length, 1);
  });
});
