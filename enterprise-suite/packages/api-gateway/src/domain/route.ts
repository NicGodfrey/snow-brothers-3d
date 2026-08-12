import { ValidationError } from "./errors.js";

/**
 * Route definitions and pattern matching.
 *
 * A pattern is a `/`-joined list of segments. Three segment kinds exist:
 *   - static     `products`
 *   - parameter  `:productId`
 *   - wildcard   `*rest` (only legal as the final segment, captures the tail)
 *
 * Matching is specificity-ordered rather than declaration-ordered so that
 * `/products/search` wins over `/products/:id` no matter how the table was
 * assembled from per-service route modules.
 */

export const HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
] as const;

export type HttpMethod = (typeof HTTP_METHODS)[number];

export function isHttpMethod(value: string): value is HttpMethod {
  return (HTTP_METHODS as readonly string[]).includes(value);
}

/** How the gateway authenticates/authorizes a route before forwarding. */
export interface RouteAuth {
  /**
   * `anonymous` — no tenant context needed (probes, docs).
   * `tenant`    — a tenant context must be present.
   * `roles`     — tenant context plus at least one of `anyOfRoles`.
   */
  readonly mode: "anonymous" | "tenant" | "roles";
  readonly anyOfRoles?: readonly string[];
  /** All listed permissions must resolve from the caller's roles. */
  readonly allOfPermissions?: readonly string[];
}

export type RateLimitKeyStrategy = "global" | "tenant" | "tenant-user" | "tenant-route";

export interface RateLimitPolicy {
  readonly limit: number;
  readonly windowMs: number;
  readonly key: RateLimitKeyStrategy;
}

export interface RouteDefinition {
  readonly id: string;
  readonly method: HttpMethod;
  /** Public path as seen by clients, e.g. `/api/plm/products/:productId`. */
  readonly pattern: string;
  /** Upstream service id from the {@link ServiceCatalog}. */
  readonly upstream: string;
  /**
   * Upstream path template. Supports `:param` placeholders bound from the
   * match. Defaults to the pattern with the service prefix stripped.
   */
  readonly rewrite?: string;
  readonly auth: RouteAuth;
  readonly rateLimit?: RateLimitPolicy;
  readonly timeoutMs?: number;
  readonly summary?: string;
  readonly tags?: readonly string[];
  readonly deprecated?: boolean;
  /** Excluded from the aggregated OpenAPI document when false. Defaults true. */
  readonly exposeInOpenApi?: boolean;
  /** Safe to retry on upstream connection failure. */
  readonly idempotent?: boolean;
}

export type SegmentKind = "static" | "param" | "wildcard";

export interface CompiledSegment {
  readonly kind: SegmentKind;
  readonly value: string;
}

export interface CompiledPattern {
  readonly source: string;
  readonly segments: readonly CompiledSegment[];
  /** Per-segment weights compared left-to-right; higher is more specific. */
  readonly weights: readonly number[];
  readonly hasWildcard: boolean;
  /** Method-independent identity used for conflict detection. */
  readonly signature: string;
}

const SEGMENT_WEIGHT: Record<SegmentKind, number> = { static: 3, param: 2, wildcard: 1 };
const SEGMENT_RE = /^[A-Za-z0-9._~%-]+$/;
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function compilePattern(pattern: string): CompiledPattern {
  if (!pattern.startsWith("/")) {
    throw ValidationError.single("pattern", `must start with "/" (got "${pattern}")`);
  }
  const raw = pattern.split("/").filter((s) => s.length > 0);
  const segments: CompiledSegment[] = [];
  const seenParams = new Set<string>();

  raw.forEach((segment, index) => {
    if (segment.startsWith(":")) {
      const name = segment.slice(1);
      if (!NAME_RE.test(name)) {
        throw ValidationError.single("pattern", `invalid parameter name ":${name}"`);
      }
      if (seenParams.has(name)) {
        throw ValidationError.single("pattern", `duplicate parameter ":${name}"`);
      }
      seenParams.add(name);
      segments.push({ kind: "param", value: name });
      return;
    }
    if (segment.startsWith("*")) {
      if (index !== raw.length - 1) {
        throw ValidationError.single("pattern", "wildcard must be the final segment");
      }
      const name = segment.slice(1) || "rest";
      if (!NAME_RE.test(name)) {
        throw ValidationError.single("pattern", `invalid wildcard name "*${name}"`);
      }
      segments.push({ kind: "wildcard", value: name });
      return;
    }
    if (!SEGMENT_RE.test(segment)) {
      throw ValidationError.single("pattern", `invalid path segment "${segment}"`);
    }
    segments.push({ kind: "static", value: segment });
  });

  const signature = segments
    .map((s) => (s.kind === "static" ? s.value : s.kind === "param" ? "{}" : "{*}"))
    .join("/");

  return {
    source: pattern,
    segments,
    weights: segments.map((s) => SEGMENT_WEIGHT[s.kind]),
    hasWildcard: segments.some((s) => s.kind === "wildcard"),
    signature: `/${signature}`,
  };
}

export function splitPath(path: string): string[] {
  const [withoutQuery] = path.split("?");
  return (withoutQuery ?? "")
    .split("/")
    .filter((s) => s.length > 0)
    .map(safeDecode);
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Returns captured params, or undefined when the path does not match. */
export function matchPattern(
  compiled: CompiledPattern,
  parts: readonly string[],
): Record<string, string> | undefined {
  const { segments } = compiled;
  if (!compiled.hasWildcard && segments.length !== parts.length) return undefined;
  if (compiled.hasWildcard && parts.length < segments.length - 1) return undefined;

  const params: Record<string, string> = {};
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i]!;
    if (segment.kind === "wildcard") {
      params[segment.value] = parts.slice(i).join("/");
      return params;
    }
    const part = parts[i];
    if (part === undefined) return undefined;
    if (segment.kind === "param") {
      params[segment.value] = part;
    } else if (segment.value !== part) {
      return undefined;
    }
  }
  return params;
}

/**
 * True when at least one concrete path matches both patterns. Used to detect
 * a wildcard that would swallow a more specific route for part of its range.
 */
export function patternsIntersect(a: CompiledPattern, b: CompiledPattern): boolean {
  const shared = Math.min(a.segments.length, b.segments.length);
  for (let i = 0; i < shared; i += 1) {
    const left = a.segments[i]!;
    const right = b.segments[i]!;
    if (left.kind === "wildcard" || right.kind === "wildcard") return true;
    if (left.kind === "static" && right.kind === "static" && left.value !== right.value) {
      return false;
    }
  }
  if (a.segments.length === b.segments.length) return true;
  // Differing lengths only overlap when the shorter pattern absorbs the tail.
  const shorter = a.segments.length < b.segments.length ? a : b;
  return shorter.hasWildcard;
}

/** Descending specificity: static beats param beats wildcard, left to right. */
export function compareSpecificity(a: CompiledPattern, b: CompiledPattern): number {
  const max = Math.max(a.weights.length, b.weights.length);
  for (let i = 0; i < max; i += 1) {
    const left = a.weights[i] ?? 0;
    const right = b.weights[i] ?? 0;
    if (left !== right) return right - left;
  }
  return a.source.localeCompare(b.source);
}

/**
 * Resolves the upstream path for a match. With no `rewrite` the service prefix
 * is stripped, which is the common `/api/<prefix>/...` → `/...` case.
 */
export function resolveUpstreamPath(
  route: RouteDefinition,
  params: Readonly<Record<string, string>>,
  prefix?: string,
): string {
  if (route.rewrite) return applyTemplate(route.rewrite, params);
  const path = substituteParams(route.pattern, params);
  if (!prefix) return path;
  const normalized = prefix.startsWith("/") ? prefix : `/${prefix}`;
  if (path === normalized) return "/";
  if (path.startsWith(`${normalized}/`)) return path.slice(normalized.length);
  return path;
}

function substituteParams(pattern: string, params: Readonly<Record<string, string>>): string {
  return applyTemplate(pattern, params);
}

function applyTemplate(template: string, params: Readonly<Record<string, string>>): string {
  const out = template
    .split("/")
    .filter((s) => s.length > 0)
    .map((segment) => {
      if (segment.startsWith(":")) {
        const value = params[segment.slice(1)];
        if (value === undefined) {
          throw ValidationError.single("rewrite", `no value bound for "${segment}"`);
        }
        return encodeURIComponent(value);
      }
      if (segment.startsWith("*")) {
        const value = params[segment.slice(1) || "rest"] ?? "";
        return value.split("/").map(encodeURIComponent).join("/");
      }
      return segment;
    })
    .filter((s) => s.length > 0)
    .join("/");
  return `/${out}`;
}

export function validateRoute(route: RouteDefinition): CompiledPattern {
  if (!route.id || route.id.trim().length === 0) {
    throw ValidationError.single("id", "must be a non-empty string");
  }
  if (!isHttpMethod(route.method)) {
    throw ValidationError.single("method", `must be one of [${HTTP_METHODS.join(", ")}]`);
  }
  if (!route.upstream || route.upstream.trim().length === 0) {
    throw ValidationError.single("upstream", "must reference a service id");
  }
  if (route.auth.mode === "roles" && (route.auth.anyOfRoles ?? []).length === 0) {
    throw ValidationError.single("auth.anyOfRoles", "must list at least one role");
  }
  if (route.auth.mode !== "roles" && (route.auth.anyOfRoles ?? []).length > 0) {
    throw ValidationError.single("auth.anyOfRoles", 'is only meaningful with mode "roles"');
  }
  if (route.rateLimit) {
    if (!Number.isInteger(route.rateLimit.limit) || route.rateLimit.limit <= 0) {
      throw ValidationError.single("rateLimit.limit", "must be a positive integer");
    }
    if (!Number.isInteger(route.rateLimit.windowMs) || route.rateLimit.windowMs <= 0) {
      throw ValidationError.single("rateLimit.windowMs", "must be a positive integer");
    }
  }
  if (route.timeoutMs !== undefined && (!Number.isFinite(route.timeoutMs) || route.timeoutMs <= 0)) {
    throw ValidationError.single("timeoutMs", "must be a positive number");
  }
  const compiled = compilePattern(route.pattern);
  if (route.rewrite) {
    const rewriteParams = compilePattern(route.rewrite).segments
      .filter((s) => s.kind === "param" || s.kind === "wildcard")
      .map((s) => s.value);
    const available = new Set(
      compiled.segments.filter((s) => s.kind !== "static").map((s) => s.value),
    );
    const missing = rewriteParams.filter((name) => !available.has(name));
    if (missing.length > 0) {
      throw ValidationError.single(
        "rewrite",
        `references parameters absent from the pattern: ${missing.join(", ")}`,
      );
    }
  }
  return compiled;
}
