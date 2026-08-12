import type { RoutingService } from "../../application/routing-service.js";
import { describeFilter } from "../../domain/filter.js";
import type { RouteDestinationType } from "../../domain/routing.js";
import type { Router } from "../router.js";
import {
  asObject,
  optionalBoolean,
  optionalNumber,
  optionalString,
  optionalStringArray,
  queryEnum,
  requireString,
  requireStringArray,
  ulidParam,
} from "../validation.js";
import { parseDestination, parseEventEnvelope, parseFilterExpression, parseTransformSpec } from "./parsers.js";

const DESTINATION_TYPES: readonly RouteDestinationType[] = ["webhook", "adapter", "bus"];

export function registerRouteRuleRoutes(router: Router, routing: RoutingService): void {
  router.post("/routes", async ({ ctx, body }) => {
    const obj = asObject(body);
    const rule = await routing.create(ctx, {
      name: requireString(obj, "name"),
      description: optionalString(obj, "description"),
      eventPatterns: requireStringArray(obj, "eventPatterns"),
      destination: parseDestination(obj["destination"]),
      filter: obj["filter"] === undefined ? undefined : parseFilterExpression(obj["filter"]),
      transform: obj["transform"] === undefined ? undefined : parseTransformSpec(obj["transform"]),
      priority: optionalNumber(obj, "priority"),
      enabled: optionalBoolean(obj, "enabled"),
    });
    return { status: 201, body: rule.toJSON() };
  });

  router.get("/routes", async ({ ctx, query }) => {
    const enabled = query.get("enabled");
    const items = await routing.list(ctx, {
      enabled: enabled === null ? undefined : enabled === "true",
      destinationType: queryEnum(query, "destinationType", DESTINATION_TYPES),
    });
    return {
      body: {
        items: items.map((rule) => ({ ...rule.toJSON(), filterDescription: describeFilter(rule.filter) })),
        total: items.length,
      },
    };
  });

  router.get("/routes/:id", async ({ ctx, params }) => {
    const rule = await routing.get(ctx, ulidParam(params, "id"));
    return { body: { ...rule.toJSON(), filterDescription: describeFilter(rule.filter) } };
  });

  router.patch("/routes/:id", async ({ ctx, params, body }) => {
    const obj = asObject(body);
    const rule = await routing.update(ctx, ulidParam(params, "id"), {
      name: optionalString(obj, "name"),
      description: optionalString(obj, "description"),
      eventPatterns: optionalStringArray(obj, "eventPatterns"),
      filter:
        obj["filter"] === undefined ? undefined : obj["filter"] === null ? null : parseFilterExpression(obj["filter"]),
      transform:
        obj["transform"] === undefined
          ? undefined
          : obj["transform"] === null
            ? null
            : parseTransformSpec(obj["transform"]),
      priority: optionalNumber(obj, "priority"),
    });
    return { body: rule.toJSON() };
  });

  router.post("/routes/:id/enable", async ({ ctx, params }) => ({
    body: (await routing.enable(ctx, ulidParam(params, "id"))).toJSON(),
  }));

  router.post("/routes/:id/disable", async ({ ctx, params }) => ({
    body: (await routing.disable(ctx, ulidParam(params, "id"))).toJSON(),
  }));

  router.delete("/routes/:id", async ({ ctx, params }) => {
    await routing.delete(ctx, ulidParam(params, "id"));
    return { status: 204, body: null };
  });

  /**
   * Dry run: shows which rules an event would hit and what each destination
   * would receive, without touching statistics or sending anything.
   */
  router.post("/routes/preview", async ({ ctx, body }) => {
    const obj = asObject(body);
    const event = parseEventEnvelope(ctx, obj["event"]);
    const resolved = await routing.preview(ctx, event);
    return {
      body: {
        eventType: event.eventType,
        matches: resolved.map((entry) => ({
          ruleId: entry.rule.id,
          rule: entry.rule.name,
          priority: entry.rule.priority,
          destination: entry.destination,
          payload: entry.payload,
        })),
      },
    };
  });
}
