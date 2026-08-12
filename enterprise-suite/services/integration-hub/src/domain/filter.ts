/**
 * Declarative content filters for route rules and webhook subscriptions.
 *
 * Topic patterns select *which* event types flow somewhere; filters narrow it
 * further by content ("only orders above 10k", "only the EU warehouses").
 * Like transforms these are stored data, so the grammar is deliberately
 * closed: a fixed set of operators over dotted paths.
 */
import { DomainError } from "@enterprise-suite/shared-kernel";
import { getPath } from "./transform.js";

export type FilterOperator =
  | "eq"
  | "neq"
  | "in"
  | "nin"
  | "exists"
  | "missing"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "starts-with"
  | "matches";

export interface FilterCondition {
  readonly path: string;
  readonly op: FilterOperator;
  readonly value?: unknown;
}

export interface FilterExpression {
  /** Every condition must hold. */
  readonly all?: readonly FilterCondition[];
  /** At least one condition must hold. */
  readonly any?: readonly FilterCondition[];
  /** No condition may hold. */
  readonly none?: readonly FilterCondition[];
}

const OPERATORS: readonly FilterOperator[] = [
  "eq", "neq", "in", "nin", "exists", "missing",
  "gt", "gte", "lt", "lte", "contains", "starts-with", "matches",
];

const VALUE_FREE_OPERATORS = new Set<FilterOperator>(["exists", "missing"]);

export function validateFilterExpression(expression: FilterExpression): FilterExpression {
  if (!expression || typeof expression !== "object") {
    throw new DomainError("filter must be an object", "VALIDATION");
  }
  const groups: (readonly FilterCondition[] | undefined)[] = [
    expression.all,
    expression.any,
    expression.none,
  ];
  if (groups.every((group) => group === undefined)) {
    throw new DomainError("filter must define at least one of: all, any, none", "VALIDATION");
  }
  for (const group of groups) {
    for (const condition of group ?? []) {
      if (typeof condition?.path !== "string" || !condition.path.trim()) {
        throw new DomainError("filter condition requires a 'path'", "VALIDATION");
      }
      if (!OPERATORS.includes(condition.op)) {
        throw new DomainError(
          `unknown filter operator '${condition.op}'; expected one of ${OPERATORS.join(", ")}`,
          "VALIDATION",
        );
      }
      if (!VALUE_FREE_OPERATORS.has(condition.op) && condition.value === undefined) {
        throw new DomainError(`filter operator '${condition.op}' requires a 'value'`, "VALIDATION");
      }
      if ((condition.op === "in" || condition.op === "nin") && !Array.isArray(condition.value)) {
        throw new DomainError(`filter operator '${condition.op}' requires an array value`, "VALIDATION");
      }
      if (condition.op === "matches") {
        if (typeof condition.value !== "string") {
          throw new DomainError("filter operator 'matches' requires a string pattern", "VALIDATION");
        }
        try {
          new RegExp(condition.value);
        } catch {
          throw new DomainError(`filter pattern '${condition.value}' is not a valid regex`, "VALIDATION");
        }
      }
    }
  }
  return expression;
}

function compare(left: unknown, right: unknown): number | undefined {
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (typeof left === "string" && typeof right === "string") {
    return left < right ? -1 : left > right ? 1 : 0;
  }
  return undefined;
}

export function evaluateCondition(condition: FilterCondition, context: unknown): boolean {
  const actual = getPath(context, condition.path);
  switch (condition.op) {
    case "exists":
      return actual !== undefined && actual !== null;
    case "missing":
      return actual === undefined || actual === null;
    case "eq":
      return actual === condition.value;
    case "neq":
      return actual !== condition.value;
    case "in":
      return (condition.value as unknown[]).includes(actual);
    case "nin":
      return !(condition.value as unknown[]).includes(actual);
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const delta = compare(actual, condition.value);
      if (delta === undefined) return false;
      if (condition.op === "gt") return delta > 0;
      if (condition.op === "gte") return delta >= 0;
      if (condition.op === "lt") return delta < 0;
      return delta <= 0;
    }
    case "contains":
      if (Array.isArray(actual)) return actual.includes(condition.value);
      if (typeof actual === "string" && typeof condition.value === "string") {
        return actual.includes(condition.value);
      }
      return false;
    case "starts-with":
      return typeof actual === "string" && typeof condition.value === "string"
        ? actual.startsWith(condition.value)
        : false;
    case "matches":
      return typeof actual === "string" && new RegExp(condition.value as string).test(actual);
  }
}

/** An absent expression matches everything. */
export function evaluateFilter(expression: FilterExpression | undefined, context: unknown): boolean {
  if (!expression) return true;
  if (expression.all && !expression.all.every((c) => evaluateCondition(c, context))) return false;
  if (expression.any && expression.any.length > 0 && !expression.any.some((c) => evaluateCondition(c, context))) {
    return false;
  }
  if (expression.none && expression.none.some((c) => evaluateCondition(c, context))) return false;
  return true;
}

/** Human-readable rendering for API responses and audit logs. */
export function describeFilter(expression: FilterExpression | undefined): string {
  if (!expression) return "match all";
  const render = (conditions: readonly FilterCondition[], joiner: string): string =>
    conditions
      .map((c) =>
        VALUE_FREE_OPERATORS.has(c.op) ? `${c.path} ${c.op}` : `${c.path} ${c.op} ${JSON.stringify(c.value)}`,
      )
      .join(joiner);
  const parts: string[] = [];
  if (expression.all?.length) parts.push(render(expression.all, " AND "));
  if (expression.any?.length) parts.push(`(${render(expression.any, " OR ")})`);
  if (expression.none?.length) parts.push(`NOT (${render(expression.none, " OR ")})`);
  return parts.join(" AND ") || "match all";
}
