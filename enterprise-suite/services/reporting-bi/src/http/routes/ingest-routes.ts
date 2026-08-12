/**
 * Ingest endpoints.
 *
 * POST /ingest accepts a batch of upstream domain events as raw JSON
 * envelopes. It always answers 200 with a per-event tally rather than failing
 * the batch: the caller is a relay that must be able to acknowledge what went
 * in and retry only what did not, and one malformed payload out of a thousand
 * is a dead-letter row, not a transport error.
 */
import type { IngestService } from "../../application/ingest-service.js";
import { parseSourceEvent } from "../../domain/ingest.js";
import type { Router } from "../router.js";
import { parseEventBatch, pathParam, queryInt } from "../validation.js";

export function registerIngestRoutes(router: Router, ingest: IngestService): void {
  router.post("/ingest", async ({ ctx, body }) => {
    const raw = parseEventBatch(body);
    const events = raw.map((event) => parseSourceEvent(event, ctx.tenantId));
    const result = await ingest.ingest(ctx, events);
    return {
      body: {
        received: result.received,
        ingested: result.ingested,
        factsWritten: result.factsWritten,
        duplicates: result.duplicates,
        ignored: result.ignored,
        rejected: result.rejected,
        cubes: result.cubes,
        watermarks: result.watermarks,
        deadLetters: result.deadLetters.map((record) => ({
          eventId: record.eventId,
          eventType: record.eventType,
          reason: record.reason,
          message: record.message,
        })),
      },
    };
  });

  /** Freshness per source context — "sales data as of 09:42". */
  router.get("/ingest/watermarks", async ({ ctx }) => ({
    body: { items: await ingest.listWatermarks(ctx) },
  }));

  router.get("/ingest/dead-letters", async ({ ctx, query }) => ({
    body: {
      items: await ingest.listDeadLetters(ctx, {
        reason: query.get("reason") ?? undefined,
        eventType: query.get("eventType") ?? undefined,
        limit: queryInt(query, "limit"),
      }),
    },
  }));

  /** The event types this deployment knows how to project. */
  router.get("/ingest/mappings", () => ({
    body: { eventTypes: ingest.supportedEventTypes() },
  }));

  /** Applies a cube's retention window; a scheduler calls this. */
  router.post("/cubes/:name/retention", async ({ ctx, params }) => {
    const cube = pathParam(params, "name");
    return { body: { cube, purged: await ingest.applyRetention(ctx, cube) } };
  });
}
