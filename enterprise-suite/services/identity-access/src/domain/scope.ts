import { brand, type Brand } from "@enterprise-suite/shared-kernel";
import { IDENTITY_ERROR, ValidationError } from "./errors.js";

/**
 * Scopes are hierarchical paths rooted at `tenant`, with `type:key` segments:
 *
 *   tenant
 *   tenant/bu:emea
 *   tenant/bu:emea/site:hamburg
 *
 * A grant at `tenant/bu:emea` covers requests at `tenant/bu:emea/site:hamburg`
 * (coverage flows down the tree, never up). A grant segment key may be `*`, so
 * `tenant/bu:* /site:hamburg` matches the Hamburg site under any business unit.
 */
export type ScopePath = Brand<string, "ScopePath">;

export const ROOT_SCOPE = brand<string, "ScopePath">("tenant");

const TYPE = /^[a-z][a-z0-9_]*$/;
const KEY = /^[a-z0-9][a-z0-9._-]*$/;

export interface ScopeSegment {
  readonly type: string;
  readonly key: string;
}

export function scopePath(value: string): ScopePath {
  const normalized = value.trim().toLowerCase().replace(/\/+$/, "");
  if (normalized === "" || normalized === "tenant" || normalized === "*") return ROOT_SCOPE;
  const parts = normalized.split("/");
  if (parts[0] !== "tenant") {
    throw new ValidationError(
      `Invalid scope "${value}": must start at the "tenant" root`,
      IDENTITY_ERROR.invalidScope,
    );
  }
  for (const part of parts.slice(1)) {
    const [type, ...rest] = part.split(":");
    const key = rest.join(":");
    if (rest.length !== 1 || !TYPE.test(type) || (key !== "*" && !KEY.test(key))) {
      throw new ValidationError(
        `Invalid scope "${value}": segment "${part}" must look like "type:key"`,
        IDENTITY_ERROR.invalidScope,
      );
    }
  }
  return brand<string, "ScopePath">(parts.join("/"));
}

export function scopeSegments(scope: ScopePath): readonly ScopeSegment[] {
  return scope
    .split("/")
    .slice(1)
    .map((part) => {
      const index = part.indexOf(":");
      return { type: part.slice(0, index), key: part.slice(index + 1) };
    });
}

export function scopeDepth(scope: ScopePath): number {
  return scopeSegments(scope).length;
}

export function isRootScope(scope: ScopePath): boolean {
  return scope === ROOT_SCOPE;
}

export function parentScope(scope: ScopePath): ScopePath | undefined {
  if (isRootScope(scope)) return undefined;
  const parts = scope.split("/");
  return brand<string, "ScopePath">(parts.slice(0, -1).join("/"));
}

/** All scopes from the given scope up to the root, nearest first. */
export function scopeChain(scope: ScopePath): readonly ScopePath[] {
  const chain: ScopePath[] = [scope];
  let current = parentScope(scope);
  while (current) {
    chain.push(current);
    current = parentScope(current);
  }
  return chain;
}

export function childScope(parent: ScopePath, type: string, key: string): ScopePath {
  return scopePath(`${parent}/${type}:${key}`);
}

/** True when a grant held at `granted` applies to a request made at `requested`. */
export function scopeCovers(granted: ScopePath, requested: ScopePath): boolean {
  if (isRootScope(granted)) return true;
  const g = scopeSegments(granted);
  const r = scopeSegments(requested);
  if (g.length > r.length) return false;
  for (let i = 0; i < g.length; i += 1) {
    if (g[i].type !== r[i].type) return false;
    if (g[i].key !== "*" && g[i].key !== r[i].key) return false;
  }
  return true;
}

/** True when two scopes overlap in either direction — used to detect duplicate bindings. */
export function scopesIntersect(a: ScopePath, b: ScopePath): boolean {
  return scopeCovers(a, b) || scopeCovers(b, a);
}

/**
 * Narrowness ranking for decision explanation: a grant at a deeper scope is a more
 * deliberate act than one at the tenant root, so it wins ties.
 */
export function scopeSpecificity(scope: ScopePath): number {
  return scopeSegments(scope).reduce((total, segment) => total + (segment.key === "*" ? 1 : 5), 0);
}

export function formatScope(scope: ScopePath): string {
  return isRootScope(scope) ? "tenant (all resources)" : scope;
}
