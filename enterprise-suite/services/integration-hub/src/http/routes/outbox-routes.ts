import type { OutboxService } from "../../application/outbox-service.js";
import type { RelayService } from "../../application/relay-service.js";
import type { OutboxStatus } from "../../domain/outbox.js";
import type { Router } from "../router.js";
import {
  asObject,
  optionalNumber,
  optionalString,
  queryEnum,
  queryNumber,
  requireString,
  ulidParam,
} from "../validation.js";
import { parseEventEnvelope } from "./parsers.js";

const STATUSES: readonly OutboxStatus[] = ["pending", "in-flight", "published", "dead-lettered"];

export function registerOutboxRoutes(
  router: Router,
  outbox: OutboxService,
  relay: RelayService,
): void {
  /** Single event ingestion from a domain service. */
  router.post("/outbox", async ({ ctx, body }) => {
    const obj = asObject(body);
    const result = await outbox.enqueue(ctx, {
      source: requireString(obj, "source"),
      event: parseEventEnvelope(ctx, obj["event"]),
      maxAttempts: optionalNumber(obj, "maxAttempts"),
      partitionKey: optionalString(obj, "partitionKey"),
    });
    return {
      status: result.duplicate ? 200 : 201,
      body: { duplicate: result.duplicate, message: result.message.toJSON() },
    };
  });

  /** Bulk ingestion: what a service posts after draining its local outbox. */
  router.post("/outbox/batch", async ({ ctx, body }) => {
    const obj = asObject(body);
    const events = obj["events"];
    if (!Array.isArray(events)) {
      return { status: 400, body: { error: { code: "VALIDATION", message: "'events' must be an array" } } };
    }
    const result = await outbox.enqueueBatch(ctx, {
      source: requireString(obj, "source"),
      events: events.map((event) => parseEventEnvelope(ctx, event)),
    });
    return {
      status: 202,
      body: {
        enqueued: result.enqueued,
        duplicates: result.duplicates,
        messageIds: result.messages.map((message) => message.id),
      },
    };
  });

  router.get("/outbox", async ({ ctx, query }) => {
    const items = await outbox.list(ctx, {
      status: queryEnum(query, "status", STATUSES),
      source: query.get("source") ?? undefined,
      eventType: query.get("eventType") ?? undefined,
    });
    return { body: { items: items.map((message) => message.toJSON()), total: items.length } };
  });

  router.get("/outbox/stats", async ({ ctx }) => ({ body: await outbox.stats(ctx) }));

  router.get("/outbox/:id", async ({ ctx, params }) => ({
    body: (await outbox.get(ctx, ulidParam(params, "id"))).toJSON(),
  }));

  router.post("/outbox/:id/dead-letter", async ({ ctx, params, body }) => {
    const obj = asObject(body);
    const message = await outbox.deadLetter(ctx, ulidParam(params, "id"), requireString(obj, "reason"));
    return { body: message.toJSON() };
  });

  router.post("/outbox/:id/replay", async ({ ctx, params, body }) => {
    const obj = body === undefined ? {} : asObject(body);
    const message = await outbox.replay(ctx, ulidParam(params, "id"), optionalNumber(obj, "extraAttempts"));
    return { body: message.toJSON() };
  });

  router.post("/outbox/replay-dead-letters", async ({ ctx, body }) => {
    const obj = body === undefined ? {} : asObject(body);
    const replayed = await outbox.replayDeadLetters(ctx, { source: optionalString(obj, "source") });
    return { body: { replayed } };
  });

  /** Runs the relay synchronously; the deployed service also runs it on a timer. */
  router.post("/relay/run", async ({ ctx, query }) => {
    const summary = await relay.runOnce({
      limit: queryNumber(query, "limit", 25),
      tenantId: ctx.tenantId,
      source: query.get("source") ?? undefined,
    });
    return { body: summary };
  });

  router.post("/relay/drain", async ({ ctx, query }) => {
    const summary = await relay.runUntilIdle({
      limit: queryNumber(query, "limit", 25),
      tenantId: ctx.tenantId,
      maxRounds: queryNumber(query, "maxRounds", 20),
    });
    return { body: summary };
  });
}
