import { json, type Router } from "@enterprise-suite/api-gateway";
import { tenantId as toTenantId } from "@enterprise-suite/shared-kernel";
import { ALL_EVENT_TYPES, EVENT_NAMESPACES } from "../../domain/events.js";
import type { AdminContainer } from "../../infrastructure/container.js";
import { commandContext } from "../context.js";
import {
  asRecord,
  optionalNumber,
  optionalString,
  optionalStringArray,
  optionalStringMap,
  requiredString,
  requiredStringArray,
} from "../validate.js";

/**
 * Webhook subscription management and delivery inspection.
 *
 * Secrets are returned only by the two commands that mint them (register and
 * rotate); everywhere else the subscription shows a hint like `abcd…yz`.
 */
export function registerWebhookRoutes(router: Router, container: AdminContainer): void {
  const service = container.services.webhook;
  const tenantOf = (req: { ctx: { tenantId: unknown } }) => toTenantId(String(req.ctx.tenantId));

  router.get(
    "/webhooks",
    (req) =>
      json(200, {
        items: service
          .list(tenantOf(req), { status: req.query.get("status") ?? undefined })
          .map((webhook) => webhook.toPublicJSON()),
        eventTypes: ALL_EVENT_TYPES,
        namespaces: EVENT_NAMESPACES.map((namespace) => `${namespace}.*`),
      }),
    "webhooks.list",
  );

  router.post(
    "/webhooks",
    async (req) => {
      const body = asRecord(req.body);
      const result = await service.register(commandContext(req), {
        name: requiredString(body, "name"),
        url: requiredString(body, "url"),
        secret: optionalString(body, "secret"),
        eventFilters: requiredStringArray(body, "eventFilters"),
        headers: optionalStringMap(body, "headers"),
        retryPolicy: parseRetryPolicy(body["retryPolicy"]),
      });
      return json(201, { webhook: result.webhook.toPublicJSON(), secret: result.secret });
    },
    "webhooks.create",
  );

  router.get(
    "/webhooks/:webhookId",
    (req) => {
      const tenant = tenantOf(req);
      const webhook = service.require(tenant, req.params["webhookId"]!);
      return json(200, {
        ...webhook.toPublicJSON(),
        deliveries: service
          .deliveriesFor(tenant, req.params["webhookId"]!, 20)
          .map((delivery) => delivery.toJSON()),
      });
    },
    "webhooks.get",
  );

  router.patch(
    "/webhooks/:webhookId",
    async (req) => {
      const body = asRecord(req.body);
      const updated = await service.update(commandContext(req), req.params["webhookId"]!, {
        name: optionalString(body, "name"),
        url: optionalString(body, "url"),
        eventFilters: optionalStringArray(body, "eventFilters"),
        headers: optionalStringMap(body, "headers"),
        retryPolicy: parseRetryPolicy(body["retryPolicy"]),
      });
      return json(200, updated.toPublicJSON());
    },
    "webhooks.update",
  );

  router.delete(
    "/webhooks/:webhookId",
    async (req) =>
      json(200, (await service.disable(commandContext(req), req.params["webhookId"]!)).toPublicJSON()),
    "webhooks.delete",
  );

  router.post(
    "/webhooks/:webhookId/pause",
    async (req) => {
      const body = req.body === undefined ? {} : asRecord(req.body);
      const paused = await service.pause(
        commandContext(req),
        req.params["webhookId"]!,
        optionalString(body, "reason") ?? "paused by operator",
      );
      return json(200, paused.toPublicJSON());
    },
    "webhooks.pause",
  );

  router.post(
    "/webhooks/:webhookId/resume",
    async (req) =>
      json(200, (await service.resume(commandContext(req), req.params["webhookId"]!)).toPublicJSON()),
    "webhooks.resume",
  );

  router.post(
    "/webhooks/:webhookId/rotate-secret",
    async (req) => json(200, await service.rotateSecret(commandContext(req), req.params["webhookId"]!)),
    "webhooks.rotate-secret",
  );

  router.post(
    "/webhooks/:webhookId/test",
    async (req) => {
      const result = await service.test(commandContext(req), req.params["webhookId"]!);
      return json(result.delivered ? 200 : 502, {
        delivered: result.delivered,
        delivery: result.delivery.toJSON(),
      });
    },
    "webhooks.test",
  );

  router.get(
    "/webhooks/:webhookId/deliveries",
    (req) =>
      json(200, {
        items: service
          .deliveriesFor(
            tenantOf(req),
            req.params["webhookId"]!,
            Number(req.query.get("limit") ?? 50),
          )
          .map((delivery) => delivery.toJSON()),
      }),
    "webhooks.deliveries",
  );

  /** Runs the due deliveries now; the deployed worker calls the same code. */
  router.post(
    "/webhooks/drain",
    async (req) => json(200, await service.drain(Number(req.query.get("limit") ?? 50))),
    "webhooks.drain",
  );

  router.get(
    "/webhooks-dead-letters",
    (req) =>
      json(200, {
        items: service.deadLetters(tenantOf(req)).map((delivery) => delivery.toJSON()),
      }),
    "webhooks.dead-letters",
  );
}

function parseRetryPolicy(value: unknown): Record<string, number> | undefined {
  if (value === undefined || value === null) return undefined;
  const body = asRecord(value, "retryPolicy");
  const parsed = {
    maxAttempts: optionalNumber(body, "maxAttempts"),
    initialBackoffMs: optionalNumber(body, "initialBackoffMs"),
    backoffFactor: optionalNumber(body, "backoffFactor"),
    maxBackoffMs: optionalNumber(body, "maxBackoffMs"),
  };
  return Object.fromEntries(
    Object.entries(parsed).filter(([, entry]) => entry !== undefined),
  ) as Record<string, number>;
}
