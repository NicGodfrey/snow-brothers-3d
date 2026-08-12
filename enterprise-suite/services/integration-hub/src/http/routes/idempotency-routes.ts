import type { IdempotencyService } from "../../application/idempotency-service.js";
import type { Router } from "../router.js";
import { asObject, optionalNumber, requireNumber, requireString } from "../validation.js";

/**
 * Idempotency is normally used *inside* a service via
 * `IdempotencyService.execute`. These endpoints expose the same state machine
 * so a caller in another runtime (or an operator debugging a stuck key) can
 * drive it explicitly: reserve, then complete or fail.
 */
export function registerIdempotencyRoutes(router: Router, idempotency: IdempotencyService): void {
  router.post("/idempotency/begin", async ({ ctx, body, headers }) => {
    const obj = asObject(body);
    const key = obj["key"] === undefined ? (headers["idempotency-key"] ?? "") : requireString(obj, "key");
    if (!key) {
      return {
        status: 400,
        body: { error: { code: "VALIDATION", message: "'key' or an Idempotency-Key header is required" } },
      };
    }
    const result = await idempotency.begin(ctx, {
      key,
      scope: requireString(obj, "scope"),
      request: obj["request"],
      ttlMs: optionalNumber(obj, "ttlMs"),
    });
    if (result.replay) {
      return {
        status: 200,
        body: { replayed: true, response: result.replay, record: result.record.toJSON() },
      };
    }
    return { status: 201, body: { replayed: false, record: result.record.toJSON() } };
  });

  router.post("/idempotency/complete", async ({ ctx, body }) => {
    const obj = asObject(body);
    const response = asObject(obj["response"], "response");
    const record = await idempotency.complete(ctx, {
      key: requireString(obj, "key"),
      scope: requireString(obj, "scope"),
      response: { status: requireNumber(response, "status"), body: response["body"] },
    });
    return { body: record.toJSON() };
  });

  router.post("/idempotency/fail", async ({ ctx, body }) => {
    const obj = asObject(body);
    const record = await idempotency.fail(ctx, {
      key: requireString(obj, "key"),
      scope: requireString(obj, "scope"),
      error: requireString(obj, "error"),
    });
    return { body: record.toJSON() };
  });

  router.get("/idempotency", async ({ ctx, query }) => {
    const items = await idempotency.list(ctx, { scope: query.get("scope") ?? undefined });
    return { body: { items: items.map((record) => record.toJSON()), total: items.length } };
  });

  router.get("/idempotency/:scope/:key", async ({ ctx, params }) => {
    const record = await idempotency.get(ctx, params["scope"]!, params["key"]!);
    return { body: record.toJSON() };
  });

  router.post("/idempotency/purge-expired", async ({ ctx }) => ({
    body: { purged: await idempotency.purgeExpired(ctx) },
  }));
}
