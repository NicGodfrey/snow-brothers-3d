import { json, type Router } from "@enterprise-suite/api-gateway";
import { tenantId as toTenantId } from "@enterprise-suite/shared-kernel";
import {
  CONDITION_OPERATORS,
  type EvaluationContext,
  type TargetingCondition,
  type TargetingRuleInput,
} from "../../domain/feature-flag.js";
import { ValidationError } from "../../domain/errors.js";
import type { AdminContainer } from "../../infrastructure/container.js";
import { commandContext } from "../context.js";
import {
  asArray,
  asRecord,
  booleanFromQuery,
  flagValue,
  optionalBoolean,
  optionalNumber,
  optionalString,
  optionalStringArray,
  requiredEnum,
  requiredString,
  requiredStringArray,
} from "../validate.js";

/**
 * Feature flag administration and evaluation.
 *
 * `/feature-flags/evaluate` is the hot path every other service calls, so it
 * is a single POST that returns the whole flag set for a subject rather than
 * one request per flag.
 */
export function registerFeatureFlagRoutes(router: Router, container: AdminContainer): void {
  const service = container.services.featureFlag;
  const tenantOf = (req: { ctx: { tenantId: unknown } }) => toTenantId(String(req.ctx.tenantId));

  router.get(
    "/feature-flags",
    (req) =>
      json(200, {
        items: service
          .list(tenantOf(req), {
            enabled: booleanFromQuery(req.query, "enabled"),
            tag: req.query.get("tag") ?? undefined,
            archived: booleanFromQuery(req.query, "archived") ?? false,
          })
          .map((flag) => flag.toJSON()),
      }),
    "feature-flags.list",
  );

  router.post(
    "/feature-flags",
    async (req) => {
      const body = asRecord(req.body);
      const created = await service.create(commandContext(req), {
        key: requiredString(body, "key"),
        name: requiredString(body, "name"),
        description: optionalString(body, "description"),
        valueType: optionalString(body, "valueType") as "boolean" | "string" | "number" | undefined,
        defaultValue: flagValue(body, "defaultValue"),
        onValue: flagValue(body, "onValue"),
        offValue: flagValue(body, "offValue"),
        enabled: optionalBoolean(body, "enabled"),
        rolloutPercentage: optionalNumber(body, "rolloutPercentage"),
        tags: optionalStringArray(body, "tags"),
        rules: body["rules"] === undefined ? undefined : parseRules(body["rules"]),
      });
      return json(201, created.toJSON());
    },
    "feature-flags.create",
  );

  /**
   * Declared before `/feature-flags/:flagKey` for readability only — the
   * router orders by specificity, so the static segment wins regardless.
   */
  router.post(
    "/feature-flags/evaluate",
    (req) => {
      const body = req.body === undefined ? {} : asRecord(req.body);
      const context = parseEvaluationContext(body, String(req.ctx.userId));
      const keys = optionalStringArray(body, "keys");
      const tenant = tenantOf(req);
      if (!keys) return json(200, service.evaluateAll(tenant, context));

      const detail = keys.map((key) => service.evaluate(tenant, key, context));
      return json(200, {
        subject: context.subject,
        evaluatedAt: container.clock.now(),
        flags: Object.fromEntries(detail.map((entry) => [entry.key, entry.value])),
        detail,
      });
    },
    "feature-flags.evaluate",
  );

  router.get(
    "/feature-flags/:flagKey",
    (req) => json(200, service.require(tenantOf(req), req.params["flagKey"]!).toJSON()),
    "feature-flags.get",
  );

  router.patch(
    "/feature-flags/:flagKey",
    async (req) => {
      const body = asRecord(req.body);
      const key = req.params["flagKey"]!;
      const enabled = optionalBoolean(body, "enabled");
      if (enabled !== undefined) await service.toggle(commandContext(req), key, enabled);
      const updated = await service.update(commandContext(req), key, {
        name: optionalString(body, "name"),
        description: optionalString(body, "description"),
        defaultValue: flagValue(body, "defaultValue"),
        onValue: flagValue(body, "onValue"),
        offValue: flagValue(body, "offValue"),
        rolloutPercentage: optionalNumber(body, "rolloutPercentage"),
        tags: optionalStringArray(body, "tags"),
      });
      return json(200, updated.toJSON());
    },
    "feature-flags.update",
  );

  router.delete(
    "/feature-flags/:flagKey",
    async (req) =>
      json(200, (await service.archive(commandContext(req), req.params["flagKey"]!)).toJSON()),
    "feature-flags.delete",
  );

  router.post(
    "/feature-flags/:flagKey/rules",
    async (req) => {
      const rule = await service.upsertRule(
        commandContext(req),
        req.params["flagKey"]!,
        parseRule(asRecord(req.body)),
      );
      return json(201, rule);
    },
    "feature-flags.upsert-rule",
  );

  router.delete(
    "/feature-flags/:flagKey/rules/:ruleId",
    async (req) => {
      const flag = await service.removeRule(
        commandContext(req),
        req.params["flagKey"]!,
        req.params["ruleId"]!,
      );
      return json(200, flag.toJSON());
    },
    "feature-flags.remove-rule",
  );

  /** "What would this subject get, and why" — used by the rollout preview. */
  router.post(
    "/feature-flags/:flagKey/explain",
    (req) => {
      const body = req.body === undefined ? {} : asRecord(req.body);
      return json(
        200,
        service.explain(
          tenantOf(req),
          req.params["flagKey"]!,
          parseEvaluationContext(body, String(req.ctx.userId)),
        ),
      );
    },
    "feature-flags.explain",
  );

  router.post(
    "/feature-flags/:flagKey/simulate",
    (req) => {
      const body = asRecord(req.body);
      return json(
        200,
        service.simulate(tenantOf(req), req.params["flagKey"]!, requiredStringArray(body, "subjects")),
      );
    },
    "feature-flags.simulate",
  );
}

function parseEvaluationContext(
  body: Record<string, unknown>,
  fallbackSubject: string,
): EvaluationContext {
  const attributes = body["attributes"];
  if (attributes !== undefined && (typeof attributes !== "object" || Array.isArray(attributes))) {
    throw ValidationError.single("attributes", "must be an object");
  }
  return {
    subject: optionalString(body, "subject") ?? fallbackSubject,
    attributes: (attributes ?? {}) as Record<string, string | number | boolean>,
  };
}

function parseRules(value: unknown): TargetingRuleInput[] {
  return asArray(value, "rules").map((rule, index) => parseRule(asRecord(rule, `rules[${index}]`)));
}

function parseRule(body: Record<string, unknown>): TargetingRuleInput {
  const value = flagValue(body, "value");
  if (value === undefined) throw ValidationError.single("value", "is required");
  return {
    id: optionalString(body, "id"),
    description: optionalString(body, "description"),
    priority: optionalNumber(body, "priority"),
    enabled: optionalBoolean(body, "enabled"),
    value,
    conditions: asArray(body["conditions"], "conditions").map((condition, index) =>
      parseCondition(asRecord(condition, `conditions[${index}]`)),
    ),
  };
}

function parseCondition(body: Record<string, unknown>): TargetingCondition {
  const operator = requiredEnum(body, "operator", CONDITION_OPERATORS);
  return {
    attribute: requiredString(body, "attribute"),
    operator,
    values: operator === "exists" ? [] : requiredStringArray(body, "values"),
  };
}
