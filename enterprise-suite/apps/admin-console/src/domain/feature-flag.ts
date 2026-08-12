import {
  AggregateRoot,
  envelope,
  newId,
  type EntityProps,
  type TenantId,
} from "@enterprise-suite/shared-kernel";
import { InvalidStateError, ValidationError } from "./errors.js";
import { AdminEventTypes } from "./events.js";

/**
 * Feature flags with targeting.
 *
 * Evaluation is deterministic and side-effect free: given the same flag and
 * the same evaluation context, every service in the suite reaches the same
 * answer without calling home. Order of resolution:
 *
 *   1. flag disabled            → `offValue`
 *   2. first matching rule      → that rule's value
 *   3. percentage rollout       → `onValue` for subjects inside the bucket
 *   4. otherwise                → `defaultValue`
 *
 * Bucketing hashes `<flagKey>:<subject>` into 0–9999, so a subject keeps its
 * bucket as the rollout widens and two flags never correlate.
 */

export const FLAG_KEY_PATTERN = /^[a-z][a-z0-9-]{1,62}[a-z0-9]$/;

export type FlagValue = boolean | string | number;
export type FlagValueType = "boolean" | "string" | "number";

export const CONDITION_OPERATORS = [
  "equals",
  "not-equals",
  "in",
  "not-in",
  "contains",
  "starts-with",
  "gt",
  "lt",
  "exists",
] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

export interface TargetingCondition {
  /** Attribute of the evaluation context, e.g. `plan`, `region`, `userId`. */
  readonly attribute: string;
  readonly operator: ConditionOperator;
  readonly values: readonly string[];
}

export interface TargetingRule {
  readonly id: string;
  readonly description?: string;
  /** Lower numbers are evaluated first. */
  readonly priority: number;
  /** All conditions must hold for the rule to match. */
  readonly conditions: readonly TargetingCondition[];
  readonly value: FlagValue;
  readonly enabled: boolean;
}

export interface TargetingRuleInput {
  readonly id?: string;
  readonly description?: string;
  readonly priority?: number;
  readonly conditions: readonly TargetingCondition[];
  readonly value: FlagValue;
  readonly enabled?: boolean;
}

export interface EvaluationContext {
  /** Stable identity used for percentage bucketing, usually the user id. */
  readonly subject: string;
  readonly attributes?: Readonly<Record<string, string | number | boolean>>;
}

export type EvaluationReason =
  | "flag-disabled"
  | "rule-match"
  | "percentage-rollout"
  | "percentage-excluded"
  | "default";

export interface Evaluation {
  readonly key: string;
  readonly value: FlagValue;
  readonly reason: EvaluationReason;
  readonly ruleId?: string;
  readonly bucket?: number;
}

export interface FeatureFlagProps {
  key: string;
  name: string;
  description?: string;
  valueType: FlagValueType;
  enabled: boolean;
  defaultValue: FlagValue;
  onValue: FlagValue;
  offValue: FlagValue;
  rules: TargetingRule[];
  rolloutPercentage: number;
  archived: boolean;
  tags: string[];
}

export interface CreateFlagInput {
  readonly key: string;
  readonly name: string;
  readonly description?: string;
  readonly valueType?: FlagValueType;
  readonly defaultValue?: FlagValue;
  readonly onValue?: FlagValue;
  readonly offValue?: FlagValue;
  readonly enabled?: boolean;
  readonly rolloutPercentage?: number;
  readonly rules?: readonly TargetingRuleInput[];
  readonly tags?: readonly string[];
}

export class FeatureFlag extends AggregateRoot<FeatureFlagProps> {
  static create(
    tenantId: TenantId,
    input: CreateFlagInput,
    existing?: Partial<EntityProps>,
  ): FeatureFlag {
    const key = input.key.trim().toLowerCase();
    if (!FLAG_KEY_PATTERN.test(key)) {
      throw ValidationError.single(
        "key",
        "must be 3-64 lowercase characters: letters, digits and dashes",
      );
    }
    if (input.name.trim().length === 0) throw ValidationError.single("name", "is required");

    const valueType = input.valueType ?? "boolean";
    const offValue = input.offValue ?? (valueType === "boolean" ? false : "");
    const onValue = input.onValue ?? (valueType === "boolean" ? true : "");
    const defaultValue = input.defaultValue ?? offValue;
    for (const [field, value] of [
      ["defaultValue", defaultValue],
      ["onValue", onValue],
      ["offValue", offValue],
    ] as const) {
      assertValueType(field, value, valueType);
    }

    const flag = new FeatureFlag(
      tenantId,
      {
        key,
        name: input.name.trim(),
        description: input.description?.trim() || undefined,
        valueType,
        enabled: input.enabled ?? false,
        defaultValue,
        onValue,
        offValue,
        rules: [],
        rolloutPercentage: assertPercentage(input.rolloutPercentage ?? 0),
        archived: false,
        tags: [...new Set(input.tags ?? [])].sort(),
      },
      existing,
    );
    for (const rule of input.rules ?? []) flag.upsertRule(rule, { silent: true });
    flag.raise(
      envelope({
        eventType: AdminEventTypes.featureFlagCreated,
        aggregateType: "FeatureFlag",
        aggregateId: flag.id,
        tenantId,
        payload: { key, name: flag.props.name, valueType, enabled: flag.props.enabled },
      }),
    );
    return flag;
  }

  get key(): string {
    return this.props.key;
  }
  get name(): string {
    return this.props.name;
  }
  get enabled(): boolean {
    return this.props.enabled;
  }
  get valueType(): FlagValueType {
    return this.props.valueType;
  }
  get rules(): readonly TargetingRule[] {
    return this.props.rules;
  }
  get rolloutPercentage(): number {
    return this.props.rolloutPercentage;
  }
  get archived(): boolean {
    return this.props.archived;
  }
  get tags(): readonly string[] {
    return this.props.tags;
  }

  toggle(enabled: boolean, actor: string): void {
    this.assertActive();
    if (this.props.enabled === enabled) return;
    this.props.enabled = enabled;
    this.raise(
      envelope({
        eventType: AdminEventTypes.featureFlagToggled,
        aggregateType: "FeatureFlag",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { key: this.props.key, enabled, actor },
      }),
    );
  }

  update(patch: {
    name?: string;
    description?: string;
    defaultValue?: FlagValue;
    onValue?: FlagValue;
    offValue?: FlagValue;
    rolloutPercentage?: number;
    tags?: readonly string[];
  }): void {
    this.assertActive();
    if (patch.name !== undefined) {
      if (patch.name.trim().length === 0) throw ValidationError.single("name", "is required");
      this.props.name = patch.name.trim();
    }
    if (patch.description !== undefined) {
      this.props.description = patch.description.trim() || undefined;
    }
    for (const field of ["defaultValue", "onValue", "offValue"] as const) {
      const value = patch[field];
      if (value === undefined) continue;
      assertValueType(field, value, this.props.valueType);
      this.props[field] = value;
    }
    if (patch.rolloutPercentage !== undefined) {
      this.props.rolloutPercentage = assertPercentage(patch.rolloutPercentage);
    }
    if (patch.tags !== undefined) this.props.tags = [...new Set(patch.tags)].sort();
    this.raise(
      envelope({
        eventType: AdminEventTypes.featureFlagUpdated,
        aggregateType: "FeatureFlag",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { key: this.props.key, rolloutPercentage: this.props.rolloutPercentage },
      }),
    );
  }

  upsertRule(input: TargetingRuleInput, options: { silent?: boolean } = {}): TargetingRule {
    this.assertActive();
    assertValueType("rule.value", input.value, this.props.valueType);
    if (input.conditions.length === 0) {
      throw ValidationError.single("rule.conditions", "at least one condition is required");
    }
    for (const condition of input.conditions) assertCondition(condition);

    const rule: TargetingRule = {
      id: input.id ?? newId("rule"),
      description: input.description?.trim() || undefined,
      priority: input.priority ?? (this.props.rules.length + 1) * 10,
      conditions: input.conditions.map((condition) => ({
        ...condition,
        values: [...condition.values],
      })),
      value: input.value,
      enabled: input.enabled ?? true,
    };
    const others = this.props.rules.filter((existing) => existing.id !== rule.id);
    this.props.rules = [...others, rule].sort((a, b) => a.priority - b.priority);

    if (!options.silent) {
      this.raise(
        envelope({
          eventType: AdminEventTypes.featureFlagRuleChanged,
          aggregateType: "FeatureFlag",
          aggregateId: this.id,
          tenantId: this.tenantId,
          payload: { key: this.props.key, ruleId: rule.id, priority: rule.priority },
        }),
      );
    }
    return rule;
  }

  removeRule(ruleId: string): void {
    this.assertActive();
    const before = this.props.rules.length;
    this.props.rules = this.props.rules.filter((rule) => rule.id !== ruleId);
    if (this.props.rules.length === before) {
      throw new InvalidStateError(`Rule ${ruleId} is not part of flag ${this.props.key}`);
    }
    this.raise(
      envelope({
        eventType: AdminEventTypes.featureFlagRuleChanged,
        aggregateType: "FeatureFlag",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { key: this.props.key, ruleId, removed: true },
      }),
    );
  }

  archive(): void {
    this.assertActive();
    this.props.archived = true;
    this.props.enabled = false;
    this.raise(
      envelope({
        eventType: AdminEventTypes.featureFlagArchived,
        aggregateType: "FeatureFlag",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { key: this.props.key },
      }),
    );
  }

  evaluate(context: EvaluationContext): Evaluation {
    if (!this.props.enabled) {
      return { key: this.props.key, value: this.props.offValue, reason: "flag-disabled" };
    }
    for (const rule of this.props.rules) {
      if (!rule.enabled) continue;
      if (rule.conditions.every((condition) => matchesCondition(condition, context))) {
        return { key: this.props.key, value: rule.value, reason: "rule-match", ruleId: rule.id };
      }
    }
    if (this.props.rolloutPercentage > 0) {
      const bucket = bucketFor(this.props.key, context.subject);
      const inRollout = bucket < this.props.rolloutPercentage * 100;
      return {
        key: this.props.key,
        value: inRollout ? this.props.onValue : this.props.defaultValue,
        reason: inRollout ? "percentage-rollout" : "percentage-excluded",
        bucket,
      };
    }
    return { key: this.props.key, value: this.props.defaultValue, reason: "default" };
  }

  private assertActive(): void {
    if (this.props.archived) {
      throw new InvalidStateError(`Flag ${this.props.key} is archived`);
    }
  }
}

/**
 * FNV-1a over `<flagKey>:<subject>`, folded into 0–9999. Cheap, stable across
 * processes and languages, and independent per flag.
 */
export function bucketFor(flagKey: string, subject: string): number {
  const input = `${flagKey}:${subject}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 10_000;
}

export function matchesCondition(
  condition: TargetingCondition,
  context: EvaluationContext,
): boolean {
  const raw =
    condition.attribute === "subject"
      ? context.subject
      : context.attributes?.[condition.attribute];
  const value = raw === undefined || raw === null ? undefined : String(raw);

  switch (condition.operator) {
    case "exists":
      return value !== undefined;
    case "equals":
      return value !== undefined && condition.values.includes(value);
    case "not-equals":
      return value === undefined || !condition.values.includes(value);
    case "in":
      return value !== undefined && condition.values.includes(value);
    case "not-in":
      return value === undefined || !condition.values.includes(value);
    case "contains":
      return value !== undefined && condition.values.some((needle) => value.includes(needle));
    case "starts-with":
      return value !== undefined && condition.values.some((prefix) => value.startsWith(prefix));
    case "gt":
      return compareNumeric(value, condition.values[0], (a, b) => a > b);
    case "lt":
      return compareNumeric(value, condition.values[0], (a, b) => a < b);
    default: {
      const exhaustive: never = condition.operator;
      return exhaustive;
    }
  }
}

function compareNumeric(
  value: string | undefined,
  bound: string | undefined,
  compare: (a: number, b: number) => boolean,
): boolean {
  if (value === undefined || bound === undefined) return false;
  const left = Number(value);
  const right = Number(bound);
  if (Number.isNaN(left) || Number.isNaN(right)) return false;
  return compare(left, right);
}

function assertCondition(condition: TargetingCondition): void {
  if (condition.attribute.trim().length === 0) {
    throw ValidationError.single("rule.conditions.attribute", "is required");
  }
  if (!CONDITION_OPERATORS.includes(condition.operator)) {
    throw ValidationError.single(
      "rule.conditions.operator",
      `must be one of [${CONDITION_OPERATORS.join(", ")}]`,
    );
  }
  if (condition.operator !== "exists" && condition.values.length === 0) {
    throw ValidationError.single(
      "rule.conditions.values",
      `operator "${condition.operator}" needs at least one value`,
    );
  }
}

function assertValueType(field: string, value: FlagValue, expected: FlagValueType): void {
  if (typeof value !== expected) {
    throw ValidationError.single(field, `must be a ${expected} for this flag`);
  }
}

function assertPercentage(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw ValidationError.single("rolloutPercentage", "must be between 0 and 100");
  }
  return value;
}
