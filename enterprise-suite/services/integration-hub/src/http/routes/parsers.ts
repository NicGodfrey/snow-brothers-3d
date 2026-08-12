/**
 * Parsers for the composite shapes the hub accepts: event envelopes, filter
 * expressions, transform specs and route destinations.
 */
import {
  brand,
  DomainError,
  envelope,
  type EventEnvelope,
  type TenantContext,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import type { FilterExpression, FilterCondition, FilterOperator } from "../../domain/filter.js";
import { validateFilterExpression } from "../../domain/filter.js";
import type { RouteDestination } from "../../domain/routing.js";
import { validateTransformSpec, type TransformSpec } from "../../domain/transform.js";
import {
  asObject,
  optionalNumber,
  optionalRecord,
  optionalString,
  requireString,
  requireUlid,
} from "../validation.js";

/**
 * Accepts a full envelope from a peer service, or the short form
 * `{ eventType, aggregateId, payload }` for hand-written calls. The tenant
 * always comes from the request context, never from the body.
 */
export function parseEventEnvelope(ctx: TenantContext, raw: unknown, name = "event"): EventEnvelope {
  const obj = asObject(raw, name);
  const eventType = requireString(obj, "eventType");
  const payload = obj["payload"] === undefined ? {} : obj["payload"];
  const aggregateType = optionalString(obj, "aggregateType") ?? eventType.split(".")[1] ?? "unknown";
  const aggregateId = optionalString(obj, "aggregateId") ?? `agg_${eventType.replace(/\./g, "_")}`;
  const bodyTenant = optionalString(obj, "tenantId");
  if (bodyTenant && bodyTenant !== String(ctx.tenantId)) {
    throw new DomainError(
      `${name}.tenantId '${bodyTenant}' does not match the request tenant`,
      "TENANT_MISMATCH",
      403,
    );
  }

  const base = envelope({
    eventType,
    aggregateType,
    aggregateId: brand<string, "Ulid">(aggregateId),
    tenantId: ctx.tenantId as TenantId,
    payload,
    schemaVersion: optionalNumber(obj, "schemaVersion"),
    correlationId: optionalUlidValue(obj, "correlationId"),
    causationId: optionalUlidValue(obj, "causationId"),
  });

  // Preserve the producer's ids when they supplied them; that is what makes
  // outbox ingestion idempotent across a retry from the source service.
  const eventId = optionalString(obj, "eventId");
  const occurredAt = optionalString(obj, "occurredAt");
  return {
    ...base,
    eventId: eventId ? brand<string, "Ulid">(eventId) : base.eventId,
    occurredAt: occurredAt ? brand<string, "IsoDateTime">(occurredAt) : base.occurredAt,
  };
}

function optionalUlidValue(obj: Record<string, unknown>, key: string): Ulid | undefined {
  const value = optionalString(obj, key);
  return value === undefined ? undefined : brand<string, "Ulid">(value);
}

export function parseFilterExpression(raw: unknown, name = "filter"): FilterExpression {
  const obj = asObject(raw, name);
  const group = (key: "all" | "any" | "none"): FilterCondition[] | undefined => {
    const value = obj[key];
    if (value === undefined || value === null) return undefined;
    if (!Array.isArray(value)) {
      throw new DomainError(`'${name}.${key}' must be an array of conditions`, "VALIDATION");
    }
    return value.map((entry, index) => {
      const condition = asObject(entry, `${name}.${key}[${index}]`);
      return {
        path: requireString(condition, "path"),
        op: requireString(condition, "op") as FilterOperator,
        value: condition["value"],
      };
    });
  };
  return validateFilterExpression({ all: group("all"), any: group("any"), none: group("none") });
}

export function parseTransformSpec(raw: unknown, name = "transform"): TransformSpec {
  const obj = asObject(raw, name);
  const fields = obj["fields"];
  if (fields === undefined) {
    throw new DomainError(`'${name}.fields' is required`, "VALIDATION");
  }
  return validateTransformSpec({ fields: asObject(fields, `${name}.fields`) } as TransformSpec);
}

export function parseDestination(raw: unknown, name = "destination"): RouteDestination {
  const obj = asObject(raw, name);
  const type = requireString(obj, "type");
  switch (type) {
    case "webhook":
      return { type: "webhook", subscriptionId: requireUlid(obj, "subscriptionId") };
    case "adapter":
      return { type: "adapter", adapterId: requireUlid(obj, "adapterId") };
    case "bus":
      return { type: "bus", topic: requireString(obj, "topic") };
    default:
      throw new DomainError(`'${name}.type' must be webhook, adapter or bus`, "VALIDATION");
  }
}

export function parseAdapterMessages(raw: unknown, name = "messages"): {
  key: string;
  eventType: string;
  payload: unknown;
  headers?: Record<string, string>;
}[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new DomainError(`'${name}' must be a non-empty array`, "VALIDATION");
  }
  return raw.map((entry, index) => {
    const message = asObject(entry, `${name}[${index}]`);
    const headers = optionalRecord(message, "headers");
    return {
      key: requireString(message, "key"),
      eventType: requireString(message, "eventType"),
      payload: message["payload"],
      headers: headers as Record<string, string> | undefined,
    };
  });
}
