import type { InboxService } from "../../application/inbox-service.js";
import type { InboxStatus } from "../../domain/inbox.js";
import type { Router } from "../router.js";
import {
  asObject,
  optionalNumber,
  optionalString,
  optionalStringRecord,
  queryEnum,
  queryNumber,
  requireString,
  ulidParam,
} from "../validation.js";

const STATUSES: readonly InboxStatus[] = [
  "received",
  "processing",
  "processed",
  "failed",
  "discarded",
];

export function registerInboxRoutes(router: Router, inbox: InboxService): void {
  /**
   * Ingestion endpoint for partners and peer services. Returns 200 (not 201)
   * for a duplicate so a retrying sender sees success rather than an error.
   */
  router.post("/inbox", async ({ ctx, body, headers }) => {
    const obj = asObject(body);
    const result = await inbox.receive(ctx, {
      source: requireString(obj, "source"),
      messageKey: optionalString(obj, "messageKey") ?? headers["idempotency-key"] ?? requireString(obj, "messageKey"),
      eventType: requireString(obj, "eventType"),
      payload: obj["payload"],
      headers: optionalStringRecord(obj, "headers"),
      maxAttempts: optionalNumber(obj, "maxAttempts"),
    });
    return {
      status: result.duplicate ? 200 : 202,
      body: { duplicate: result.duplicate, message: result.message.toJSON() },
    };
  });

  router.get("/inbox", async ({ ctx, query }) => {
    const items = await inbox.list(ctx, {
      status: queryEnum(query, "status", STATUSES),
      source: query.get("source") ?? undefined,
      eventType: query.get("eventType") ?? undefined,
    });
    return { body: { items: items.map((message) => message.toJSON()), total: items.length } };
  });

  router.get("/inbox/stats", async ({ ctx }) => ({ body: await inbox.stats(ctx) }));

  router.get("/inbox/:id", async ({ ctx, params }) => ({
    body: (await inbox.get(ctx, ulidParam(params, "id"))).toJSON(),
  }));

  router.post("/inbox/:id/process", async ({ ctx, params }) => ({
    body: (await inbox.process(ctx, ulidParam(params, "id"))).toJSON(),
  }));

  router.post("/inbox/process-due", async ({ ctx, query }) => ({
    body: await inbox.processDue(queryNumber(query, "limit", 50), { tenantId: ctx.tenantId }),
  }));

  router.post("/inbox/:id/discard", async ({ ctx, params, body }) => {
    const obj = asObject(body);
    const message = await inbox.discard(ctx, ulidParam(params, "id"), requireString(obj, "reason"));
    return { body: message.toJSON() };
  });

  router.post("/inbox/:id/replay", async ({ ctx, params, body }) => {
    const obj = body === undefined ? {} : asObject(body);
    const message = await inbox.replay(ctx, ulidParam(params, "id"), optionalNumber(obj, "extraAttempts"));
    return { body: message.toJSON() };
  });

  router.post("/inbox/replay-failed", async ({ ctx, body }) => {
    const obj = body === undefined ? {} : asObject(body);
    const replayed = await inbox.replayFailed(ctx, { source: optionalString(obj, "source") });
    return { body: { replayed } };
  });
}
