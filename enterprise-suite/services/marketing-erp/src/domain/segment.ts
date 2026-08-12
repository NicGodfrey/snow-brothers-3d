import {
  AggregateRoot,
  ConflictError,
  DomainError,
  envelope,
  type EntityProps,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { MarketingEvents, type SegmentRulesUpdatedPayload } from "./events.js";
import type { LeadView } from "./lead.js";

// ---------------------------------------------------------------------------
// Rule AST — a small predicate language over lead attributes, serializable
// to JSON so segments can be stored, audited, and evaluated server-side.
// ---------------------------------------------------------------------------

export const SEGMENT_FIELDS = [
  "email",
  "company",
  "jobTitle",
  "industry",
  "companySize",
  "country",
  "source",
  "stage",
  "grade",
  "score",
  "tags",
  "consentEmail",
  "consentSms",
] as const;
export type SegmentField = (typeof SEGMENT_FIELDS)[number];

export const CONDITION_OPS = [
  "eq",
  "neq",
  "in",
  "contains",
  "gte",
  "lte",
  "exists",
  "has",
] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];

export interface FieldCondition {
  readonly kind: "condition";
  readonly field: SegmentField;
  readonly op: ConditionOp;
  readonly value?: string | number | boolean | readonly (string | number)[];
}

export type SegmentRule =
  | { readonly kind: "and"; readonly rules: readonly SegmentRule[] }
  | { readonly kind: "or"; readonly rules: readonly SegmentRule[] }
  | { readonly kind: "not"; readonly rule: SegmentRule }
  | FieldCondition;

const MAX_RULE_DEPTH = 6;

/** Ops that require a scalar/array value versus none. */
const OPS_WITHOUT_VALUE: readonly ConditionOp[] = ["exists"];
const NUMERIC_OPS: readonly ConditionOp[] = ["gte", "lte"];

export function validateSegmentRule(rule: SegmentRule, depth = 1): void {
  if (depth > MAX_RULE_DEPTH) {
    throw new DomainError(`Segment rule exceeds max depth ${MAX_RULE_DEPTH}`, "SEGMENT_RULE_TOO_DEEP");
  }
  switch (rule.kind) {
    case "and":
    case "or":
      if (rule.rules.length === 0) {
        throw new DomainError(`'${rule.kind}' group must contain at least one rule`, "SEGMENT_RULE_EMPTY_GROUP");
      }
      for (const child of rule.rules) validateSegmentRule(child, depth + 1);
      return;
    case "not":
      validateSegmentRule(rule.rule, depth + 1);
      return;
    case "condition": {
      if (!(SEGMENT_FIELDS as readonly string[]).includes(rule.field)) {
        throw new DomainError(`Unknown segment field: ${rule.field}`, "SEGMENT_RULE_UNKNOWN_FIELD");
      }
      if (!(CONDITION_OPS as readonly string[]).includes(rule.op)) {
        throw new DomainError(`Unknown condition op: ${rule.op}`, "SEGMENT_RULE_UNKNOWN_OP");
      }
      if (OPS_WITHOUT_VALUE.includes(rule.op)) return;
      if (rule.value === undefined) {
        throw new DomainError(`Op '${rule.op}' requires a value`, "SEGMENT_RULE_MISSING_VALUE");
      }
      if (rule.op === "in" && !Array.isArray(rule.value)) {
        throw new DomainError("Op 'in' requires an array value", "SEGMENT_RULE_BAD_VALUE");
      }
      if (NUMERIC_OPS.includes(rule.op) && typeof rule.value !== "number") {
        throw new DomainError(`Op '${rule.op}' requires a numeric value`, "SEGMENT_RULE_BAD_VALUE");
      }
      if (rule.op === "has" && rule.field !== "tags") {
        throw new DomainError("Op 'has' only applies to 'tags'", "SEGMENT_RULE_BAD_VALUE");
      }
      return;
    }
    default: {
      const exhaustive: never = rule;
      throw new DomainError(`Unknown rule kind: ${JSON.stringify(exhaustive)}`, "SEGMENT_RULE_UNKNOWN_KIND");
    }
  }
}

function fieldValue(lead: LeadView, field: SegmentField): unknown {
  switch (field) {
    case "consentEmail":
      return lead.consent.email;
    case "consentSms":
      return lead.consent.sms;
    case "tags":
      return lead.tags;
    default:
      return lead[field];
  }
}

function compareCondition(cond: FieldCondition, lead: LeadView): boolean {
  const actual = fieldValue(lead, cond.field);
  switch (cond.op) {
    case "exists":
      return actual !== undefined && actual !== null && actual !== "";
    case "eq":
      if (typeof actual === "boolean") return actual === cond.value;
      return String(actual ?? "").toLowerCase() === String(cond.value).toLowerCase();
    case "neq":
      if (typeof actual === "boolean") return actual !== cond.value;
      return String(actual ?? "").toLowerCase() !== String(cond.value).toLowerCase();
    case "in":
      return (
        Array.isArray(cond.value) &&
        cond.value.some((v) => String(v).toLowerCase() === String(actual ?? "").toLowerCase())
      );
    case "contains":
      return String(actual ?? "").toLowerCase().includes(String(cond.value).toLowerCase());
    case "gte":
      return typeof actual === "number" && actual >= Number(cond.value);
    case "lte":
      return typeof actual === "number" && actual <= Number(cond.value);
    case "has":
      return Array.isArray(actual) && actual.includes(String(cond.value).toLowerCase());
    default:
      return false;
  }
}

export function evaluateSegmentRule(rule: SegmentRule, lead: LeadView): boolean {
  switch (rule.kind) {
    case "and":
      return rule.rules.every((r) => evaluateSegmentRule(r, lead));
    case "or":
      return rule.rules.some((r) => evaluateSegmentRule(r, lead));
    case "not":
      return !evaluateSegmentRule(rule.rule, lead);
    case "condition":
      return compareCondition(rule, lead);
  }
}

/** Human-readable one-line rendering of a rule tree, used in events and audit logs. */
export function describeSegmentRule(rule: SegmentRule): string {
  switch (rule.kind) {
    case "and":
      return `(${rule.rules.map(describeSegmentRule).join(" AND ")})`;
    case "or":
      return `(${rule.rules.map(describeSegmentRule).join(" OR ")})`;
    case "not":
      return `NOT ${describeSegmentRule(rule.rule)}`;
    case "condition":
      return rule.op === "exists"
        ? `${rule.field} exists`
        : `${rule.field} ${rule.op} ${JSON.stringify(rule.value)}`;
  }
}

// ---------------------------------------------------------------------------
// Segment aggregate
// ---------------------------------------------------------------------------

export type SegmentType = "dynamic" | "static";

export interface SegmentProps {
  name: string;
  type: SegmentType;
  /** Present for dynamic segments; evaluated against leads at audience build time. */
  rule?: SegmentRule;
  /** Present for static segments; explicit curated membership. */
  staticMemberIds: Ulid[];
  description?: string;
  archived: boolean;
}

export class Segment extends AggregateRoot<SegmentProps> {
  private constructor(tenantId: TenantId, props: SegmentProps, existing?: Partial<EntityProps>) {
    super(tenantId, props, existing);
  }

  static createDynamic(input: {
    tenantId: TenantId;
    name: string;
    rule: SegmentRule;
    description?: string;
  }): Segment {
    validateSegmentRule(input.rule);
    const segment = new Segment(input.tenantId, {
      name: input.name.trim(),
      type: "dynamic",
      rule: input.rule,
      staticMemberIds: [],
      description: input.description,
      archived: false,
    });
    segment.raise(
      envelope({
        eventType: MarketingEvents.SegmentCreated,
        aggregateType: "Segment",
        aggregateId: segment.id,
        tenantId: segment.tenantId,
        payload: { segmentId: segment.id, type: "dynamic", name: segment.name },
      }),
    );
    return segment;
  }

  static createStatic(input: {
    tenantId: TenantId;
    name: string;
    memberIds?: Ulid[];
    description?: string;
  }): Segment {
    const segment = new Segment(input.tenantId, {
      name: input.name.trim(),
      type: "static",
      staticMemberIds: [...new Set(input.memberIds ?? [])],
      description: input.description,
      archived: false,
    });
    segment.raise(
      envelope({
        eventType: MarketingEvents.SegmentCreated,
        aggregateType: "Segment",
        aggregateId: segment.id,
        tenantId: segment.tenantId,
        payload: { segmentId: segment.id, type: "static", name: segment.name },
      }),
    );
    return segment;
  }

  get name(): string {
    return this.props.name;
  }

  get type(): SegmentType {
    return this.props.type;
  }

  get rule(): SegmentRule | undefined {
    return this.props.rule;
  }

  get staticMemberIds(): readonly Ulid[] {
    return this.props.staticMemberIds;
  }

  get archived(): boolean {
    return this.props.archived;
  }

  updateRule(rule: SegmentRule): void {
    if (this.props.type !== "dynamic") {
      throw new ConflictError("Only dynamic segments have rules");
    }
    if (this.props.archived) {
      throw new ConflictError("Cannot update an archived segment");
    }
    validateSegmentRule(rule);
    this.props.rule = rule;
    this.raise(
      envelope<SegmentRulesUpdatedPayload>({
        eventType: MarketingEvents.SegmentRulesUpdated,
        aggregateType: "Segment",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { segmentId: this.id, ruleSummary: describeSegmentRule(rule) },
      }),
    );
  }

  addStaticMember(leadId: Ulid): void {
    if (this.props.type !== "static") {
      throw new ConflictError("Only static segments have explicit members");
    }
    if (!this.props.staticMemberIds.includes(leadId)) {
      this.props.staticMemberIds.push(leadId);
      this.touch();
    }
  }

  removeStaticMember(leadId: Ulid): void {
    const idx = this.props.staticMemberIds.indexOf(leadId);
    if (idx !== -1) {
      this.props.staticMemberIds.splice(idx, 1);
      this.touch();
    }
  }

  /** Whether this segment includes the given lead. */
  matches(lead: LeadView): boolean {
    if (this.props.archived) return false;
    if (this.props.type === "static") {
      return this.props.staticMemberIds.includes(lead.id);
    }
    return this.props.rule ? evaluateSegmentRule(this.props.rule, lead) : false;
  }

  archive(): void {
    if (this.props.archived) {
      throw new ConflictError("Segment already archived");
    }
    this.props.archived = true;
    this.raise(
      envelope({
        eventType: MarketingEvents.SegmentArchived,
        aggregateType: "Segment",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { segmentId: this.id },
      }),
    );
  }
}
