import type { DeliveryService } from "../../application/delivery-service.js";
import type { DeliveryStatus } from "../../domain/delivery.js";
import type { Router } from "../router.js";
import {
  asObject,
  optionalNumber,
  queryEnum,
  queryNumber,
  queryUlid,
  requireString,
  ulidParam,
} from "../validation.js";

const STATUSES: readonly DeliveryStatus[] = [
  "pending",
  "in-flight",
  "delivered",
  "dead-lettered",
  "cancelled",
];

export function registerDeliveryRoutes(router: Router, deliveries: DeliveryService): void {
  router.get("/deliveries", async ({ ctx, query }) => {
    const items = await deliveries.list(ctx, {
      subscriptionId: queryUlid(query, "subscriptionId"),
      status: queryEnum(query, "status", STATUSES),
      eventType: query.get("eventType") ?? undefined,
    });
    return { body: { items: items.map((delivery) => delivery.toJSON()), total: items.length } };
  });

  router.get("/deliveries/stats", async ({ ctx, query }) => ({
    body: await deliveries.stats(ctx, queryUlid(query, "subscriptionId")),
  }));

  router.get("/deliveries/:id", async ({ ctx, params }) => ({
    body: (await deliveries.get(ctx, ulidParam(params, "id"))).toJSON(),
  }));

  /** Worker tick: attempts every delivery whose backoff has elapsed. */
  router.post("/deliveries/dispatch", async ({ ctx, query }) => ({
    body: await deliveries.dispatchDue(queryNumber(query, "limit", 50), {
      tenantId: ctx.tenantId,
      subscriptionId: queryUlid(query, "subscriptionId"),
    }),
  }));

  router.post("/deliveries/:id/retry", async ({ ctx, params, body }) => {
    const obj = body === undefined ? {} : asObject(body);
    const delivery = await deliveries.retry(ctx, ulidParam(params, "id"), optionalNumber(obj, "extraAttempts"));
    return { body: delivery.toJSON() };
  });

  router.post("/deliveries/:id/cancel", async ({ ctx, params, body }) => {
    const obj = asObject(body);
    const delivery = await deliveries.cancel(ctx, ulidParam(params, "id"), requireString(obj, "reason"));
    return { body: delivery.toJSON() };
  });

  router.post("/deliveries/retry-dead-letters", async ({ ctx, query }) => ({
    body: { requeued: await deliveries.retryDeadLetters(ctx, queryUlid(query, "subscriptionId")) },
  }));
}
