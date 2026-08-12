import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { brand, type EventEnvelope, type TenantId } from "@enterprise-suite/shared-kernel";
import { InMemoryDeadLetterQueue } from "../src/dead-letter.js";
import { InMemoryEventBus } from "../src/in-memory-bus.js";
import { filterMiddleware, tapMiddleware } from "../src/middleware.js";
import { retryPolicy } from "../src/retry-policy.js";
import { ImmediateScheduler, ManualScheduler } from "../src/scheduler.js";
import { collect, flakyHandler, testEvent } from "../src/testing.js";

function bus(options: ConstructorParameters<typeof InMemoryEventBus>[0] = {}): InMemoryEventBus {
  return new InMemoryEventBus({ scheduler: new ImmediateScheduler(), ...options });
}

describe("InMemoryEventBus delivery", () => {
  it("delivers to every matching subscription and skips the rest", async () => {
    const b = bus();
    const ncrs = collect(b, "quality.ncr.**", "ncrs");
    const everything = collect(b, "**", "audit");
    const sales = collect(b, "sales.**", "sales");

    await b.publish(testEvent("quality.ncr.opened", { ncrNumber: "NCR-1" }));
    await b.publish(testEvent("sales.order.placed", { orderId: "SO-1" }));
    await b.drain();

    assert.deepEqual(ncrs.types(), ["quality.ncr.opened"]);
    assert.deepEqual(sales.types(), ["sales.order.placed"]);
    assert.deepEqual(everything.types(), ["quality.ncr.opened", "sales.order.placed"]);
  });

  it("preserves publish order per subscription even with async handlers", async () => {
    const b = bus();
    const seen: number[] = [];
    b.subscribe("seq.**", async (event) => {
      const payload = event as EventEnvelope<{ n: number }>;
      await new Promise((resolve) => setTimeout(resolve, payload.payload.n % 2 === 0 ? 5 : 0));
      seen.push(payload.payload.n);
    });

    for (let n = 0; n < 6; n++) await b.publish(testEvent("seq.tick", { n }));
    await b.drain();

    assert.deepEqual(seen, [0, 1, 2, 3, 4, 5]);
  });

  it("isolates subscribers: one failing handler does not stop the others", async () => {
    const b = bus({ retry: retryPolicy({ maxAttempts: 1 }) });
    const good = collect(b, "iso.**", "good");
    b.subscribe(
      "iso.**",
      () => {
        throw new Error("always fails");
      },
      { name: "bad" },
    );

    await b.publish(testEvent("iso.one", {}));
    await b.publish(testEvent("iso.two", {}));
    await b.drain();

    assert.deepEqual(good.types(), ["iso.one", "iso.two"]);
    assert.equal(b.deadLetters.size, 2);
  });

  it("filters by tenant and by predicate", async () => {
    const b = bus();
    const acme = collect2(b, { tenantId: brand<string, "TenantId">("tenant-acme") as TenantId });
    const highValue = collect2(b, { filter: (event) => (event.payload as { amount: number }).amount > 100 });

    await b.publish(testEvent("orders.placed", { amount: 500 }, { tenantId: "tenant-acme" }));
    await b.publish(testEvent("orders.placed", { amount: 50 }, { tenantId: "tenant-acme" }));
    await b.publish(testEvent("orders.placed", { amount: 900 }, { tenantId: "tenant-other" }));
    await b.drain();

    assert.equal(acme.events.length, 2);
    assert.equal(highValue.events.length, 2);
  });

  it("stops delivering after unsubscribe", async () => {
    const b = bus();
    const c = collect(b, "x.**");
    await b.publish(testEvent("x.one", {}));
    await b.drain();
    c.subscription.unsubscribe();
    await b.publish(testEvent("x.two", {}));
    await b.drain();
    assert.deepEqual(c.types(), ["x.one"]);
    assert.equal(b.subscriptionCount, 0);
  });

  it("queues while paused and flushes on resume, in order", async () => {
    const b = bus();
    const c = collect(b, "p.**");
    c.subscription.pause();
    await b.publish(testEvent("p.one", {}));
    await b.publish(testEvent("p.two", {}));
    await b.drain();
    assert.deepEqual(c.types(), []);
    assert.equal(c.subscription.stats().queueDepth, 2);

    c.subscription.resume();
    await b.drain();
    assert.deepEqual(c.types(), ["p.one", "p.two"]);
  });

  it("drops the oldest event when a paused subscriber exceeds its queue cap", async () => {
    const b = bus();
    const seen: string[] = [];
    const sub = b.subscribe(
      "cap.**",
      (event) => {
        seen.push((event as EventEnvelope<{ n: number }>).payload.n.toString());
      },
      { name: "capped", maxQueueDepth: 2, startPaused: true },
    );

    for (let n = 0; n < 5; n++) await b.publish(testEvent("cap.tick", { n }));
    assert.equal(sub.stats().dropped, 3);
    sub.resume();
    await b.drain();
    assert.deepEqual(seen, ["3", "4"]);
  });

  it("resolves waitFor with the first matching event", async () => {
    const b = bus();
    const pending = b.waitFor("late.arrival");
    await b.publish(testEvent("late.arrival", { ok: true }));
    const event = await pending;
    assert.equal(event.eventType, "late.arrival");
  });
});

describe("InMemoryEventBus retries and dead letters", () => {
  it("retries a flaky handler until it succeeds", async () => {
    const b = bus({ retry: retryPolicy({ maxAttempts: 4, initialDelayMs: 10 }) });
    const handler = flakyHandler(2);
    const sub = b.subscribe("flaky.**", handler, { name: "flaky" });

    await b.publish(testEvent("flaky.event", {}));
    await b.drain();

    assert.equal(handler.calls, 3);
    assert.equal(sub.stats().delivered, 1);
    assert.equal(sub.stats().retried, 2);
    assert.equal(b.deadLetters.size, 0);
  });

  it("exposes attempt numbers to the handler", async () => {
    const b = bus({ retry: retryPolicy({ maxAttempts: 3, initialDelayMs: 1 }) });
    const attempts: { attempt: number; redelivery: boolean }[] = [];
    b.subscribe("ctx.**", (_event, context) => {
      attempts.push({ attempt: context.attempt, redelivery: context.isRedelivery });
      if (context.attempt < 3) throw new Error("retry me");
    });

    await b.publish(testEvent("ctx.event", {}));
    await b.drain();

    assert.deepEqual(attempts, [
      { attempt: 1, redelivery: false },
      { attempt: 2, redelivery: true },
      { attempt: 3, redelivery: true },
    ]);
  });

  it("waits the backoff delay between attempts", async () => {
    const scheduler = new ManualScheduler();
    const b = new InMemoryEventBus({
      scheduler,
      retry: retryPolicy({ maxAttempts: 3, initialDelayMs: 100, multiplier: 4 }),
    });
    const handler = flakyHandler(2);
    b.subscribe("slow.**", handler);

    await b.publish(testEvent("slow.event", {}));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(handler.calls, 1, "first attempt runs immediately");
    assert.deepEqual(scheduler.pendingDelays(), [100]);

    await scheduler.advanceBy(100);
    assert.equal(handler.calls, 2);
    assert.deepEqual(scheduler.pendingDelays(), [400], "second retry uses the multiplier");

    await scheduler.advanceBy(400);
    await b.drain();
    assert.equal(handler.calls, 3);
  });

  it("dead-letters once the retry budget is spent", async () => {
    const dlq = new InMemoryDeadLetterQueue();
    const b = bus({ retry: retryPolicy({ maxAttempts: 2, initialDelayMs: 1 }), deadLetter: dlq });
    const sub = b.subscribe(
      "doomed.**",
      () => {
        throw new TypeError("cannot project payload");
      },
      { name: "projector" },
    );

    await b.publish(testEvent("doomed.event", { id: 7 }));
    await b.drain();

    assert.equal(dlq.size, 1);
    const [letter] = dlq.list();
    assert.equal(letter!.attempts, 2);
    assert.equal(letter!.errorName, "TypeError");
    assert.equal(letter!.error, "cannot project payload");
    assert.equal(letter!.subscriptionName, "projector");
    assert.equal(letter!.event.eventType, "doomed.event");
    assert.equal(sub.stats().deadLettered, 1);
  });

  it("uses a per-subscription dead-letter sink when provided", async () => {
    const own = new InMemoryDeadLetterQueue();
    const b = bus({ retry: retryPolicy({ maxAttempts: 1 }) });
    b.subscribe(
      "own.**",
      () => {
        throw new Error("nope");
      },
      { name: "own-sink", deadLetter: own },
    );

    await b.publish(testEvent("own.event", {}));
    await b.drain();

    assert.equal(own.size, 1);
    assert.equal(b.deadLetters.size, 0);
  });

  it("replays a dead letter after taking it out of the queue", async () => {
    const b = bus({ retry: retryPolicy({ maxAttempts: 1 }) });
    let failNext = true;
    b.subscribe("replay.**", () => {
      if (failNext) throw new Error("transient outage");
    });

    await b.publish(testEvent("replay.event", {}));
    await b.drain();
    assert.equal(b.deadLetters.size, 1);

    const letter = b.deadLetters.take(b.deadLetters.list()[0]!.id)!;
    failNext = false;
    await b.publish(letter.event);
    await b.drain();

    assert.equal(b.deadLetters.size, 0);
  });

  it("filters and purges the dead-letter queue", async () => {
    const dlq = new InMemoryDeadLetterQueue();
    const b = bus({ retry: retryPolicy({ maxAttempts: 1 }), deadLetter: dlq });
    b.subscribe("purge.**", () => {
      throw new Error("x");
    });

    await b.publish(testEvent("purge.a", {}, { tenantId: "t1" }));
    await b.publish(testEvent("purge.b", {}, { tenantId: "t2" }));
    await b.drain();

    assert.equal(dlq.list({ eventType: "purge.a" }).length, 1);
    assert.equal(dlq.list({ tenantId: brand<string, "TenantId">("t2") as TenantId }).length, 1);
    assert.equal(dlq.purge({ eventType: "purge.a" }), 1);
    assert.equal(dlq.size, 1);
  });
});

describe("InMemoryEventBus middleware and metrics", () => {
  it("runs middleware in registration order and can veto a publish", async () => {
    const order: string[] = [];
    const b = bus({
      middleware: [
        tapMiddleware(() => order.push("first")),
        filterMiddleware((event) => event.eventType !== "blocked.event"),
        tapMiddleware(() => order.push("second")),
      ],
    });
    const c = collect(b, "**");

    await b.publish(testEvent("allowed.event", {}));
    await b.publish(testEvent("blocked.event", {}));
    await b.drain();

    assert.deepEqual(order, ["first", "second", "first"]);
    assert.deepEqual(c.types(), ["allowed.event"]);
  });

  it("bypasses middleware when asked (replay path)", async () => {
    const b = bus({ middleware: [filterMiddleware(() => false)] });
    const c = collect(b, "**");
    await b.publish(testEvent("forced.event", {}), { bypassMiddleware: true });
    await b.drain();
    assert.deepEqual(c.types(), ["forced.event"]);
  });

  it("counts publishes, deliveries, retries and dead letters", async () => {
    const b = bus({ retry: retryPolicy({ maxAttempts: 2, initialDelayMs: 1 }) });
    collect(b, "m.**", "ok");
    b.subscribe(
      "m.**",
      () => {
        throw new Error("fail");
      },
      { name: "bad" },
    );

    await b.publish(testEvent("m.one", {}));
    await b.publish(testEvent("m.one", {}));
    await b.drain();

    const metrics = b.metrics();
    assert.equal(metrics.published, 2);
    assert.equal(metrics.publishedByType["m.one"], 2);
    assert.equal(metrics.delivered, 2);
    assert.equal(metrics.deliveredBySubscription["ok"], 2);
    assert.equal(metrics.failedAttempts, 4);
    assert.equal(metrics.retried, 2);
    assert.equal(metrics.deadLettered, 2);
    assert.equal(metrics.subscriptions, 2);
  });

  it("refuses to publish or subscribe after close", async () => {
    const b = bus();
    await b.close();
    await assert.rejects(() => b.publish(testEvent("late.event", {})), /closed event bus/);
    assert.throws(() => b.subscribe("late.**", () => {}), /closed event bus/);
  });
});

function collect2(
  b: InMemoryEventBus,
  options: Parameters<InMemoryEventBus["subscribe"]>[2],
): { events: EventEnvelope[] } {
  const events: EventEnvelope[] = [];
  b.subscribe(
    "orders.**",
    (event) => {
      events.push(event as EventEnvelope);
    },
    options,
  );
  return { events };
}
