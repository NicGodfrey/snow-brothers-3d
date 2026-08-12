import { MethodNotAllowedError, RouteConflictError, RouteNotFoundError } from "./errors.js";
import {
  compareSpecificity,
  matchPattern,
  patternsIntersect,
  splitPath,
  validateRoute,
  type CompiledPattern,
  type HttpMethod,
  type RouteDefinition,
} from "./route.js";

export interface CompiledRoute {
  readonly definition: RouteDefinition;
  readonly compiled: CompiledPattern;
}

export interface RouteMatch {
  readonly route: RouteDefinition;
  readonly params: Readonly<Record<string, string>>;
}

export interface RouteFilter {
  readonly upstream?: string;
  readonly method?: HttpMethod;
  readonly tag?: string;
  readonly pathPrefix?: string;
  readonly includeDeprecated?: boolean;
}

/**
 * The gateway's route table.
 *
 * Routes are kept sorted by descending specificity, so `match` returns the
 * most specific pattern regardless of registration order. Registering two
 * routes with the same method and normalized pattern is a hard error — a
 * silent shadow is far worse to debug than a boot-time failure.
 */
export class RouteTable {
  private readonly routes: CompiledRoute[] = [];
  private readonly bySignature = new Map<string, RouteDefinition>();
  private readonly byId = new Map<string, RouteDefinition>();
  private sorted = true;

  constructor(definitions: readonly RouteDefinition[] = []) {
    this.addAll(definitions);
  }

  add(definition: RouteDefinition): this {
    const compiled = validateRoute(definition);
    const signature = `${definition.method} ${compiled.signature}`;
    const existing = this.bySignature.get(signature);
    if (existing) {
      throw new RouteConflictError(existing.id, definition.id, signature);
    }
    const duplicateId = this.byId.get(definition.id);
    if (duplicateId) {
      throw new RouteConflictError(duplicateId.id, definition.id, `duplicate route id`);
    }
    this.bySignature.set(signature, definition);
    this.byId.set(definition.id, definition);
    this.routes.push({ definition, compiled });
    this.sorted = false;
    return this;
  }

  addAll(definitions: readonly RouteDefinition[]): this {
    for (const definition of definitions) this.add(definition);
    return this;
  }

  get size(): number {
    return this.routes.length;
  }

  get(id: string): RouteDefinition | undefined {
    return this.byId.get(id);
  }

  /** Most specific match, or undefined. Never throws. */
  match(method: string, path: string): RouteMatch | undefined {
    const parts = splitPath(path);
    for (const entry of this.ordered()) {
      if (entry.definition.method !== method) continue;
      const params = matchPattern(entry.compiled, parts);
      if (params) return { route: entry.definition, params };
    }
    return undefined;
  }

  /** Methods registered for a path, used to answer 405s and OPTIONS. */
  allowedMethods(path: string): HttpMethod[] {
    const parts = splitPath(path);
    const methods = new Set<HttpMethod>();
    for (const entry of this.routes) {
      if (matchPattern(entry.compiled, parts)) methods.add(entry.definition.method);
    }
    return [...methods].sort();
  }

  /** Match or throw the precise 404/405 the caller deserves. */
  resolve(method: string, path: string): RouteMatch {
    const found = this.match(method, path);
    if (found) return found;
    const allowed = this.allowedMethods(path);
    if (allowed.length > 0) throw new MethodNotAllowedError(method, path, allowed);
    throw new RouteNotFoundError(method, path);
  }

  list(filter: RouteFilter = {}): RouteDefinition[] {
    return this.ordered()
      .map((entry) => entry.definition)
      .filter((route) => {
        if (filter.upstream && route.upstream !== filter.upstream) return false;
        if (filter.method && route.method !== filter.method) return false;
        if (filter.tag && !(route.tags ?? []).includes(filter.tag)) return false;
        if (filter.pathPrefix && !route.pattern.startsWith(filter.pathPrefix)) return false;
        if (route.deprecated && filter.includeDeprecated === false) return false;
        return true;
      });
  }

  byUpstream(): Map<string, RouteDefinition[]> {
    const grouped = new Map<string, RouteDefinition[]>();
    for (const entry of this.ordered()) {
      const bucket = grouped.get(entry.definition.upstream) ?? [];
      bucket.push(entry.definition);
      grouped.set(entry.definition.upstream, bucket);
    }
    return grouped;
  }

  /** Stable, serializable description for `/__gateway/routes`. */
  describe(filter: RouteFilter = {}): Array<{
    id: string;
    method: HttpMethod;
    pattern: string;
    upstream: string;
    auth: RouteDefinition["auth"];
    rateLimit?: RouteDefinition["rateLimit"];
    tags: readonly string[];
    deprecated: boolean;
    summary?: string;
  }> {
    return this.list(filter).map((route) => ({
      id: route.id,
      method: route.method,
      pattern: route.pattern,
      upstream: route.upstream,
      auth: route.auth,
      rateLimit: route.rateLimit,
      tags: route.tags ?? [],
      deprecated: route.deprecated ?? false,
      summary: route.summary,
    }));
  }

  /**
   * Configuration lint: routes pointing at services the catalog does not know,
   * anonymous routes that mutate state, and patterns shadowed by a wildcard.
   */
  audit(knownUpstreams: ReadonlySet<string>): string[] {
    const findings: string[] = [];
    const wildcards = this.ordered().filter((e) => e.compiled.hasWildcard);
    for (const entry of this.ordered()) {
      const route = entry.definition;
      if (!knownUpstreams.has(route.upstream)) {
        findings.push(`${route.id}: unknown upstream "${route.upstream}"`);
      }
      if (route.auth.mode === "anonymous" && route.method !== "GET" && route.method !== "HEAD") {
        findings.push(`${route.id}: anonymous ${route.method} route mutates state`);
      }
      for (const wildcard of wildcards) {
        if (wildcard.definition.id === route.id) continue;
        if (wildcard.definition.method !== route.method) continue;
        // Only a wildcard that sorts first can swallow the more specific route.
        if (compareSpecificity(wildcard.compiled, entry.compiled) >= 0) continue;
        if (patternsIntersect(wildcard.compiled, entry.compiled)) {
          findings.push(`${route.id}: shadowed by wildcard route ${wildcard.definition.id}`);
        }
      }
    }
    return findings;
  }

  private ordered(): readonly CompiledRoute[] {
    if (!this.sorted) {
      this.routes.sort((a, b) => compareSpecificity(a.compiled, b.compiled));
      this.sorted = true;
    }
    return this.routes;
  }
}
