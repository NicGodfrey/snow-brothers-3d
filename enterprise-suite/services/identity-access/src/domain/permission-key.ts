import { brand, type Brand } from "@enterprise-suite/shared-kernel";
import { IDENTITY_ERROR, ValidationError } from "./errors.js";

/**
 * A permission key names one capability as `<resource>:<action>`, where resource is a
 * dotted namespace path: `sales.order:approve`, `identity.api_key:issue`.
 *
 * A grant pattern is the same shape but may use wildcards:
 *   `*`  matches exactly one resource segment  — `sales.*:read`
 *   `**` matches one or more trailing segments — `sales.**:read`
 *   `*`  as the action matches any action      — `identity.user:*`
 *   `**:*` is the superuser pattern.
 */
export type PermissionKey = Brand<string, "PermissionKey">;
export type GrantPattern = Brand<string, "GrantPattern">;

const SEGMENT = /^[a-z][a-z0-9_]*$/;
const ACTION = /^[a-z][a-z0-9_]*$/;

export interface ParsedPermission {
  readonly resource: readonly string[];
  readonly action: string;
}

function split(value: string, what: string): { resource: string; action: string } {
  const parts = value.split(":");
  if (parts.length !== 2 || parts[0].length === 0 || parts[1].length === 0) {
    throw new ValidationError(
      `Invalid ${what} "${value}": expected "<resource>:<action>"`,
      IDENTITY_ERROR.invalidPermissionKey,
    );
  }
  return { resource: parts[0], action: parts[1] };
}

/** Parses and validates a concrete permission key (no wildcards allowed). */
export function permissionKey(value: string): PermissionKey {
  const normalized = value.trim().toLowerCase();
  const { resource, action } = split(normalized, "permission key");
  const segments = resource.split(".");
  for (const segment of segments) {
    if (!SEGMENT.test(segment)) {
      throw new ValidationError(
        `Invalid permission key "${value}": resource segment "${segment}" is not a bare identifier`,
        IDENTITY_ERROR.invalidPermissionKey,
      );
    }
  }
  if (!ACTION.test(action)) {
    throw new ValidationError(
      `Invalid permission key "${value}": action "${action}" is not a bare identifier`,
      IDENTITY_ERROR.invalidPermissionKey,
    );
  }
  return brand<string, "PermissionKey">(normalized);
}

/** Parses and validates a grant pattern, which may contain wildcards. */
export function grantPattern(value: string): GrantPattern {
  const normalized = value.trim().toLowerCase();
  const { resource, action } = split(normalized, "grant pattern");
  const segments = resource.split(".");
  segments.forEach((segment, index) => {
    if (segment === "*") return;
    if (segment === "**") {
      if (index !== segments.length - 1) {
        throw new ValidationError(
          `Invalid grant pattern "${value}": "**" is only allowed as the final resource segment`,
          IDENTITY_ERROR.invalidPermissionKey,
        );
      }
      return;
    }
    if (!SEGMENT.test(segment)) {
      throw new ValidationError(
        `Invalid grant pattern "${value}": resource segment "${segment}" is not a bare identifier`,
        IDENTITY_ERROR.invalidPermissionKey,
      );
    }
  });
  if (action !== "*" && !ACTION.test(action)) {
    throw new ValidationError(
      `Invalid grant pattern "${value}": action "${action}" is not a bare identifier`,
      IDENTITY_ERROR.invalidPermissionKey,
    );
  }
  return brand<string, "GrantPattern">(normalized);
}

export function parsePermission(value: PermissionKey | GrantPattern): ParsedPermission {
  const [resource, action] = value.split(":");
  return { resource: resource.split("."), action };
}

export function isWildcardPattern(pattern: GrantPattern): boolean {
  return pattern.includes("*");
}

function resourceMatches(patternSegments: readonly string[], keySegments: readonly string[]): boolean {
  for (let i = 0; i < patternSegments.length; i += 1) {
    const segment = patternSegments[i];
    if (segment === "**") {
      // "**" is terminal and must consume at least the current key segment.
      return keySegments.length > i;
    }
    if (i >= keySegments.length) return false;
    if (segment !== "*" && segment !== keySegments[i]) return false;
  }
  return patternSegments.length === keySegments.length;
}

/** True when `pattern` grants `key`. */
export function matchesPermission(pattern: GrantPattern, key: PermissionKey): boolean {
  const p = parsePermission(pattern);
  const k = parsePermission(key);
  if (p.action !== "*" && p.action !== k.action) return false;
  return resourceMatches(p.resource, k.resource);
}

/**
 * Higher is more specific. Used to pick the most relevant grant when explaining a
 * decision, and to order grants deterministically in API responses.
 */
export function patternSpecificity(pattern: GrantPattern): number {
  const { resource, action } = parsePermission(pattern);
  let score = 0;
  for (const segment of resource) {
    if (segment === "**") score += 1;
    else if (segment === "*") score += 3;
    else score += 10;
  }
  score += action === "*" ? 1 : 8;
  return score;
}

/** Sorts most specific first; ties broken lexically so output is stable. */
export function bySpecificityDesc(a: GrantPattern, b: GrantPattern): number {
  const diff = patternSpecificity(b) - patternSpecificity(a);
  return diff !== 0 ? diff : a.localeCompare(b);
}

/**
 * True when `outer` grants everything `inner` grants. Used to collapse redundant
 * grants when a role is edited, and to validate API key scope-down lists.
 */
export function patternCovers(outer: GrantPattern, inner: GrantPattern): boolean {
  if (outer === inner) return true;
  const o = parsePermission(outer);
  const i = parsePermission(inner);
  if (o.action !== "*" && o.action !== i.action) return false;
  for (let index = 0; index < o.resource.length; index += 1) {
    const segment = o.resource[index];
    if (segment === "**") return i.resource.length >= index + 1;
    if (index >= i.resource.length) return false;
    const innerSegment = i.resource[index];
    if (segment === "*") {
      if (innerSegment === "**") return false;
      continue;
    }
    if (segment !== innerSegment) return false;
  }
  return o.resource.length === i.resource.length && !i.resource.includes("**");
}

export function permissionResource(key: PermissionKey | GrantPattern): string {
  return key.split(":")[0];
}

export function permissionAction(key: PermissionKey | GrantPattern): string {
  return key.split(":")[1];
}
