import type { DeliveryService } from "../../application/delivery-service.js";
import type { WebhookService } from "../../application/webhook-service.js";
import type { DeliveryStatus } from "../../domain/delivery.js";
import type { WebhookStatus } from "../../domain/webhook.js";
import type { Router } from "../router.js";
import {
  asObject,
  optionalNumber,
  optionalString,
  optionalStringArray,
  optionalStringRecord,
  queryEnum,
  requireString,
  requireStringArray,
  ulidParam,
} from "../validation.js";

const STATUSES: readonly WebhookStatus[] = ["active", "paused", "disabled"];
const DELIVERY_STATUSES: readonly DeliveryStatus[] = [
  "pending",
  "in-flight",
  "delivered",
  "dead-lettered",
  "cancelled",
];

export function registerWebhookRoutes(
  router: Router,
  webhooks: WebhookService,
  deliveries: DeliveryService,
): void {
  router.post("/webhooks", async ({ ctx, body }) => {
    const obj = asObject(body);
    const { subscription, secret } = await webhooks.create(ctx, {
      name: requireString(obj, "name"),
      endpointUrl: requireString(obj, "endpointUrl"),
      eventPatterns: requireStringArray(obj, "eventPatterns"),
      description: optionalString(obj, "description"),
      headers: optionalStringRecord(obj, "headers"),
      secret: optionalString(obj, "secret"),
      timeoutMs: optionalNumber(obj, "timeoutMs"),
      maxAttempts: optionalNumber(obj, "maxAttempts"),
      autoDisableThreshold: optionalNumber(obj, "autoDisableThreshold"),
    });
    // The plaintext secret is returned exactly once, at creation.
    return { status: 201, body: { ...subscription.toPublicJSON(), secret } };
  });

  router.get("/webhooks", async ({ ctx, query }) => {
    const items = await webhooks.list(ctx, {
      status: queryEnum(query, "status", STATUSES),
      eventType: query.get("eventType") ?? undefined,
    });
    return { body: { items: items.map((item) => item.toPublicJSON()), total: items.length } };
  });

  router.get("/webhooks/:id", async ({ ctx, params }) => ({
    body: (await webhooks.get(ctx, ulidParam(params, "id"))).toPublicJSON(),
  }));

  router.patch("/webhooks/:id", async ({ ctx, params, body }) => {
    const obj = asObject(body);
    const subscription = await webhooks.update(ctx, ulidParam(params, "id"), {
      endpointUrl: optionalString(obj, "endpointUrl"),
      eventPatterns: optionalStringArray(obj, "eventPatterns"),
      headers: optionalStringRecord(obj, "headers"),
      timeoutMs: optionalNumber(obj, "timeoutMs"),
      maxAttempts: optionalNumber(obj, "maxAttempts"),
      autoDisableThreshold: optionalNumber(obj, "autoDisableThreshold"),
    });
    return { body: subscription.toPublicJSON() };
  });

  router.post("/webhooks/:id/pause", async ({ ctx, params }) => ({
    body: (await webhooks.pause(ctx, ulidParam(params, "id"))).toPublicJSON(),
  }));

  router.post("/webhooks/:id/resume", async ({ ctx, params }) => ({
    body: (await webhooks.resume(ctx, ulidParam(params, "id"))).toPublicJSON(),
  }));

  router.post("/webhooks/:id/disable", async ({ ctx, params, body }) => {
    const obj = asObject(body);
    const subscription = await webhooks.disable(ctx, ulidParam(params, "id"), requireString(obj, "reason"));
    return { body: subscription.toPublicJSON() };
  });

  router.post("/webhooks/:id/enable", async ({ ctx, params }) => ({
    body: (await webhooks.enable(ctx, ulidParam(params, "id"))).toPublicJSON(),
  }));

  router.post("/webhooks/:id/rotate-secret", async ({ ctx, params, body }) => {
    const obj = body === undefined ? {} : asObject(body);
    const { subscription, secret } = await webhooks.rotateSecret(ctx, ulidParam(params, "id"), {
      secret: optionalString(obj, "secret"),
      graceMs: optionalNumber(obj, "graceMs"),
    });
    return { body: { ...subscription.toPublicJSON(), secret } };
  });

  /** Sends a signed test payload and reports the outcome synchronously. */
  router.post("/webhooks/:id/ping", async ({ ctx, params }) => {
    const { delivery, outcome } = await deliveries.ping(ctx, ulidParam(params, "id"));
    return { body: { outcome, delivery: delivery.toJSON() } };
  });

  router.get("/webhooks/:id/deliveries", async ({ ctx, params, query }) => {
    const items = await deliveries.list(ctx, {
      subscriptionId: ulidParam(params, "id"),
      status: queryEnum(query, "status", DELIVERY_STATUSES),
    });
    return { body: { items: items.map((delivery) => delivery.toJSON()), total: items.length } };
  });

  router.get("/webhooks/:id/stats", async ({ ctx, params }) => ({
    body: await deliveries.stats(ctx, ulidParam(params, "id")),
  }));

  router.delete("/webhooks/:id", async ({ ctx, params }) => {
    await webhooks.delete(ctx, ulidParam(params, "id"));
    return { status: 204, body: null };
  });
}
