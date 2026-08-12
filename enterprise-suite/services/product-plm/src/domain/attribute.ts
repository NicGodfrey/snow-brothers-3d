import type { IsoDateTime, TenantId, Ulid } from "@enterprise-suite/shared-kernel";
import type { ValidationIssue } from "./errors.js";
import type { UomCode } from "./uom.js";

/**
 * Attributes and attribute sets.
 *
 * An AttributeDefinition is a tenant-wide, reusable field description
 * ("color", "voltage", "grip-tape-material"). An AttributeSet composes
 * definitions into the schema a product conforms to, and flags which
 * attributes act as *variant axes* — the dimensions along which SKUs are
 * generated (e.g. color x size). Axis attributes must be single-select so the
 * variant space stays enumerable.
 */

export type AttributeType = "text" | "number" | "boolean" | "select" | "multiselect" | "date";

export const ATTRIBUTE_TYPES: readonly AttributeType[] = [
  "text",
  "number",
  "boolean",
  "select",
  "multiselect",
  "date",
];

export type AttributeValue = string | number | boolean | readonly string[];

export interface AttributeOption {
  readonly code: string;
  readonly label: string;
}

export interface AttributeDefinitionRecord {
  readonly id: Ulid;
  readonly tenantId: TenantId;
  /** Stable machine identifier, e.g. "color". Unique per tenant. */
  readonly code: string;
  readonly name: string;
  readonly type: AttributeType;
  /** Required for select/multiselect. */
  readonly options?: readonly AttributeOption[];
  /** Numeric bounds, only meaningful for type "number". */
  readonly min?: number;
  readonly max?: number;
  /** Regex source applied to "text" values. */
  readonly pattern?: string;
  /** Unit the numeric value is expressed in, e.g. "MM". Informational. */
  readonly uom?: UomCode;
  readonly description?: string;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

export interface AttributeSetMember {
  /** References AttributeDefinitionRecord.code. */
  readonly code: string;
  readonly required: boolean;
  /** Axis attributes drive variant combinations. */
  readonly isVariantAxis: boolean;
}

export interface AttributeSetRecord {
  readonly id: Ulid;
  readonly tenantId: TenantId;
  readonly name: string;
  readonly members: readonly AttributeSetMember[];
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

export function axisMembers(set: AttributeSetRecord): readonly AttributeSetMember[] {
  return set.members.filter((m) => m.isVariantAxis);
}

export const ATTRIBUTE_CODE_PATTERN = /^[a-z][a-z0-9_]{0,47}$/;

function issue(field: string, message: string): ValidationIssue {
  return { field, message };
}

function checkValueType(
  def: AttributeDefinitionRecord,
  value: AttributeValue,
  field: string,
): ValidationIssue[] {
  switch (def.type) {
    case "text": {
      if (typeof value !== "string") return [issue(field, "expected a string")];
      if (def.pattern && !new RegExp(def.pattern).test(value)) {
        return [issue(field, `does not match pattern ${def.pattern}`)];
      }
      return [];
    }
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return [issue(field, "expected a finite number")];
      }
      const out: ValidationIssue[] = [];
      if (def.min !== undefined && value < def.min) out.push(issue(field, `must be >= ${def.min}`));
      if (def.max !== undefined && value > def.max) out.push(issue(field, `must be <= ${def.max}`));
      return out;
    }
    case "boolean":
      return typeof value === "boolean" ? [] : [issue(field, "expected a boolean")];
    case "date": {
      if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
        return [issue(field, "expected an ISO date string")];
      }
      return [];
    }
    case "select": {
      if (typeof value !== "string") return [issue(field, "expected an option code")];
      const codes = (def.options ?? []).map((o) => o.code);
      return codes.includes(value)
        ? []
        : [issue(field, `"${value}" is not one of [${codes.join(", ")}]`)];
    }
    case "multiselect": {
      if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
        return [issue(field, "expected an array of option codes")];
      }
      const codes = new Set((def.options ?? []).map((o) => o.code));
      const bad = (value as readonly string[]).filter((v) => !codes.has(v));
      return bad.length === 0 ? [] : [issue(field, `unknown options: ${bad.join(", ")}`)];
    }
  }
}

/**
 * Validates a value map against an attribute set. Returns issues instead of
 * throwing so callers can aggregate errors from multiple sources.
 */
export function validateAttributeValues(
  set: AttributeSetRecord,
  definitions: ReadonlyMap<string, AttributeDefinitionRecord>,
  values: Readonly<Record<string, AttributeValue>>,
  opts: { readonly enforceRequired?: boolean } = {},
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const memberByCode = new Map(set.members.map((m) => [m.code, m]));

  for (const [code, value] of Object.entries(values)) {
    const member = memberByCode.get(code);
    if (!member) {
      issues.push(issue(code, `attribute is not part of set "${set.name}"`));
      continue;
    }
    const def = definitions.get(code);
    if (!def) {
      issues.push(issue(code, "attribute definition missing"));
      continue;
    }
    issues.push(...checkValueType(def, value, code));
  }

  if (opts.enforceRequired ?? true) {
    for (const member of set.members) {
      if (member.required && !(member.code in values)) {
        issues.push(issue(member.code, "required attribute is missing"));
      }
    }
  }
  return issues;
}

/**
 * Validates the axis-value map of a variant: every axis must be present, no
 * extra keys, and each value must be a legal option of the axis attribute.
 */
export function validateAxisValues(
  set: AttributeSetRecord,
  definitions: ReadonlyMap<string, AttributeDefinitionRecord>,
  axisValues: Readonly<Record<string, string>>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const axes = axisMembers(set);
  if (axes.length === 0) {
    issues.push(issue("axisValues", `attribute set "${set.name}" defines no variant axes`));
    return issues;
  }
  for (const axis of axes) {
    const value = axisValues[axis.code];
    if (value === undefined) {
      issues.push(issue(axis.code, "axis value is required"));
      continue;
    }
    const def = definitions.get(axis.code);
    if (!def) {
      issues.push(issue(axis.code, "attribute definition missing"));
      continue;
    }
    issues.push(...checkValueType(def, value, axis.code));
  }
  const axisCodes = new Set(axes.map((a) => a.code));
  for (const code of Object.keys(axisValues)) {
    if (!axisCodes.has(code)) issues.push(issue(code, "not a variant axis of this set"));
  }
  return issues;
}

/** Canonical key for an axis combination, used to enforce uniqueness. */
export function axisKey(axisValues: Readonly<Record<string, string>>): string {
  return Object.entries(axisValues)
    .map(([k, v]) => [k.toLowerCase(), v.toLowerCase()] as const)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("|");
}
