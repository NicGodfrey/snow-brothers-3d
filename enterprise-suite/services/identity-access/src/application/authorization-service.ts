import type { IsoDateTime, RoleCode, TenantId, Ulid } from "@enterprise-suite/shared-kernel";
import { AuditEntry } from "../domain/audit.js";
import {
  DECISION_REASON,
  type AuthorizationDecision,
  type AuthorizationRequest,
} from "../domain/decision.js";
import { AuthorizationDeniedError } from "../domain/errors.js";
import type { PermissionCatalog } from "../domain/permission.js";
import { permissionKey, type PermissionKey } from "../domain/permission-key.js";
import { ROOT_SCOPE, scopePath, type ScopePath } from "../domain/scope.js";
import { subjectKey, type SubjectRef } from "../domain/subject.js";
import type { Principal } from "./principal.js";
import { effectivePatterns, evaluate } from "./policy/evaluator.js";
import {
  expandSubjectChain,
  type ResolvedRole,
} from "./policy/effective-permissions.js";
import type {
  ApiKeyRepository,
  AuditRepository,
  Clock,
  GroupRepository,
  PolicyVersionStore,
  RoleBindingRepository,
  RoleRepository,
  TenantRepository,
  UserRepository,
} from "./ports.js";

export interface CheckOptions {
  readonly scope?: string | ScopePath;
  readonly resourceId?: string;
  readonly explain?: boolean;
  /** Skips the audit write; used by bulk "what can I do" screens. */
  readonly silent?: boolean;
  readonly correlationId?: Ulid;
}

interface CacheEntry {
  readonly policyVersion: number;
  readonly expiresAtMs: number;
  readonly decision: AuthorizationDecision;
}

export interface AuthorizationServiceOptions {
  /** How long an allow/deny may be reused before it is recomputed. */
  readonly cacheTtlMs?: number;
  readonly cacheEnabled?: boolean;
  readonly maxCacheEntries?: number;
}

/**
 * The read side of RBAC: turns a principal plus a permission into an allow/deny, records
 * the decision, and answers the introspection queries admin screens need.
 *
 * Decisions are cached per (tenant, subject, permission, scope) and invalidated by the
 * tenant policy version, which every mutation of roles, bindings or groups bumps.
 */
export class AuthorizationService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly cacheTtlMs: number;
  private readonly cacheEnabled: boolean;
  private readonly maxCacheEntries: number;
  private hits = 0;
  private misses = 0;

  constructor(
    private readonly tenants: TenantRepository,
    private readonly users: UserRepository,
    private readonly groups: GroupRepository,
    private readonly roles: RoleRepository,
    private readonly bindings: RoleBindingRepository,
    private readonly apiKeys: ApiKeyRepository,
    private readonly audit: AuditRepository,
    private readonly catalog: PermissionCatalog,
    private readonly policyVersions: PolicyVersionStore,
    private readonly clock: Clock,
    options: AuthorizationServiceOptions = {},
  ) {
    this.cacheTtlMs = options.cacheTtlMs ?? 5_000;
    this.cacheEnabled = options.cacheEnabled ?? true;
    this.maxCacheEntries = options.maxCacheEntries ?? 10_000;
  }

  /** Core entry point. Never throws on denial — it returns the decision. */
  check(principal: Principal, permission: string, options: CheckOptions = {}): AuthorizationDecision {
    const key = permissionKey(permission);
    const scope = options.scope ? scopePath(String(options.scope)) : ROOT_SCOPE;
    const request: AuthorizationRequest = { permission: key, scope, resourceId: options.resourceId };

    const cacheKey = this.cacheKey(principal, key, scope);
    const cached = this.readCache(principal.tenantId, cacheKey);
    if (cached && !options.explain) {
      this.hits += 1;
      if (!options.silent) this.recordDecision(principal, cached, options);
      return cached;
    }
    this.misses += 1;

    const decision = this.evaluateFresh(principal, request, options.explain ?? false);
    if (!options.explain) this.writeCache(principal.tenantId, cacheKey, decision);
    if (!options.silent) this.recordDecision(principal, decision, options);
    return decision;
  }

  /** Throws `AuthorizationDeniedError` (HTTP 403) unless the permission is granted. */
  require(principal: Principal, permission: string, options: CheckOptions = {}): AuthorizationDecision {
    const decision = this.check(principal, permission, options);
    if (!decision.allowed) {
      throw new AuthorizationDeniedError(decision.permission, decision.scope, decision.reason);
    }
    return decision;
  }

  can(principal: Principal, permission: string, options: CheckOptions = {}): boolean {
    return this.check(principal, permission, { ...options, silent: options.silent ?? true }).allowed;
  }

  /** True only when every permission is granted; short-circuits on the first denial. */
  canAll(principal: Principal, permissions: readonly string[], options: CheckOptions = {}): boolean {
    return permissions.every((permission) => this.can(principal, permission, options));
  }

  canAny(principal: Principal, permissions: readonly string[], options: CheckOptions = {}): boolean {
    return permissions.some((permission) => this.can(principal, permission, options));
  }

  requireAll(principal: Principal, permissions: readonly string[], options: CheckOptions = {}): void {
    for (const permission of permissions) this.require(principal, permission, options);
  }

  /** Evaluates many permissions at once, reusing one resolved role graph. */
  checkMany(
    principal: Principal,
    permissions: readonly string[],
    options: CheckOptions = {},
  ): readonly AuthorizationDecision[] {
    return permissions.map((permission) =>
      this.check(principal, permission, { ...options, silent: options.silent ?? true }),
    );
  }

  /** Full trace of how a decision was reached, for support and debugging screens. */
  explain(principal: Principal, permission: string, options: CheckOptions = {}): AuthorizationDecision {
    return this.check(principal, permission, { ...options, explain: true, silent: true });
  }

  /** Every permission pattern the subject can exercise at a scope. */
  effectivePermissions(
    tenantId: TenantId,
    subject: SubjectRef,
    scope: ScopePath = ROOT_SCOPE,
  ): ReturnType<typeof effectivePatterns> {
    return effectivePatterns({
      now: this.clock.now(),
      bindings: this.bindingsFor(tenantId, subject),
      roles: this.roles.map(tenantId),
      scope,
    });
  }

  /** Concrete catalog permissions the subject holds — the list a UI can render. */
  grantedPermissionKeys(
    tenantId: TenantId,
    subject: SubjectRef,
    scope: ScopePath = ROOT_SCOPE,
  ): readonly PermissionKey[] {
    const now = this.clock.now();
    const tenant = this.tenants.byId(tenantId);
    const bindings = this.bindingsFor(tenantId, subject);
    const roles = this.roles.map(tenantId);
    const roleCache = new Map<RoleCode, ResolvedRole>();
    return this.catalog
      .list()
      .filter(
        (definition) =>
          evaluate({
            now,
            subject,
            tenantStatus: tenant?.status ?? "pending",
            subjectEnabled: this.isSubjectEnabled(tenantId, subject, now),
            request: { permission: definition.key, scope },
            bindings,
            roles,
            roleCache,
          }).allowed,
      )
      .map((definition) => definition.key);
  }

  /** Reverse lookup: which subjects may exercise a permission at a scope. */
  subjectsWithPermission(
    tenantId: TenantId,
    permission: string,
    scope: ScopePath = ROOT_SCOPE,
  ): readonly SubjectRef[] {
    const key = permissionKey(permission);
    const now = this.clock.now();
    const tenant = this.tenants.byId(tenantId);
    const roles = this.roles.map(tenantId);
    const roleCache = new Map<RoleCode, ResolvedRole>();
    const found = new Map<string, SubjectRef>();
    for (const user of this.users.list(tenantId, { status: "active" })) {
      const subject: SubjectRef = { type: "user", id: user.id };
      const decision = evaluate({
        now,
        subject,
        tenantStatus: tenant?.status ?? "pending",
        subjectEnabled: user.isEnabledAt(now),
        request: { permission: key, scope },
        bindings: this.bindingsFor(tenantId, subject),
        roles,
        roleCache,
      });
      if (decision.allowed) found.set(subjectKey(subject), subject);
    }
    return [...found.values()];
  }

  /** Drops cached decisions for one tenant; mutations normally handle this implicitly. */
  invalidate(tenantId: TenantId): void {
    const prefix = `${tenantId}|`;
    for (const key of [...this.cache.keys()]) {
      if (key.startsWith(prefix)) this.cache.delete(key);
    }
  }

  cacheStats(): { size: number; hits: number; misses: number; hitRate: number } {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total === 0 ? 0 : this.hits / total,
    };
  }

  private evaluateFresh(
    principal: Principal,
    request: AuthorizationRequest,
    explain: boolean,
  ): AuthorizationDecision {
    const now = this.clock.now();
    const tenant = this.tenants.byId(principal.tenantId);
    if (!this.catalog.has(request.permission) && this.catalog.size > 0) {
      return {
        allowed: false,
        reason: DECISION_REASON.deniedUnknownPermission,
        permission: request.permission,
        scope: request.scope,
        subject: principal.subject,
        evaluatedAt: now,
        trace: explain ? [`permission ${request.permission} is not registered`] : undefined,
      };
    }
    return evaluate({
      now,
      subject: principal.subject,
      tenantStatus: tenant?.status ?? "pending",
      subjectEnabled: this.isSubjectEnabled(principal.tenantId, principal.subject, now),
      request,
      bindings: this.bindingsFor(principal.tenantId, principal.subject),
      roles: this.roles.map(principal.tenantId),
      restrictions: principal.restrictions,
      explain,
    });
  }

  private bindingsFor(tenantId: TenantId, subject: SubjectRef) {
    const chain = expandSubjectChain(
      subject,
      subject.type === "user" ? this.groups.list(tenantId) : [],
    );
    return this.bindings.bySubjects(tenantId, chain);
  }

  private isSubjectEnabled(tenantId: TenantId, subject: SubjectRef, now: IsoDateTime): boolean {
    switch (subject.type) {
      case "user": {
        const user = this.users.byId(tenantId, subject.id);
        return user ? user.isEnabledAt(now) : false;
      }
      case "api_key": {
        const key = this.apiKeys.byId(tenantId, subject.id);
        return key ? key.isUsableAt(now) : false;
      }
      case "group":
        return this.groups.byId(tenantId, subject.id) !== undefined;
      case "service":
        return true;
    }
  }

  private cacheKey(principal: Principal, permission: PermissionKey, scope: ScopePath): string {
    const restrictions = principal.restrictions?.join(",") ?? "";
    return `${principal.tenantId}|${subjectKey(principal.subject)}|${permission}|${scope}|${restrictions}`;
  }

  private readCache(tenantId: TenantId, key: string): AuthorizationDecision | undefined {
    if (!this.cacheEnabled) return undefined;
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (
      entry.policyVersion !== this.policyVersions.current(tenantId) ||
      entry.expiresAtMs <= this.clock.epochMs()
    ) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.decision;
  }

  private writeCache(tenantId: TenantId, key: string, decision: AuthorizationDecision): void {
    if (!this.cacheEnabled) return;
    if (this.cache.size >= this.maxCacheEntries) {
      // Cheap bounded eviction: drop the oldest insertion.
      const oldest = this.cache.keys().next();
      if (!oldest.done) this.cache.delete(oldest.value);
    }
    this.cache.set(key, {
      policyVersion: this.policyVersions.current(tenantId),
      expiresAtMs: this.clock.epochMs() + this.cacheTtlMs,
      decision,
    });
  }

  /**
   * Denials are always audited. Allows are audited only when the tenant opts in, because
   * a busy tenant produces far more allows than anyone will ever read.
   */
  private recordDecision(
    principal: Principal,
    decision: AuthorizationDecision,
    options: CheckOptions,
  ): void {
    const tenant = this.tenants.byId(principal.tenantId);
    const auditAll = tenant?.settings.auditAllDecisions ?? false;
    if (decision.allowed && !auditAll) return;
    this.audit.append(
      AuditEntry.record({
        tenantId: principal.tenantId,
        at: decision.evaluatedAt,
        category: "authz",
        action: "authz.check",
        outcome: decision.allowed ? "allow" : "deny",
        subject: principal.subject,
        permission: decision.permission,
        scope: decision.scope,
        reason: decision.reason,
        resourceId: options.resourceId,
        correlationId: options.correlationId ?? principal.correlationId,
        metadata: {
          matchedRole: decision.matched?.roleCode,
          matchedPermission: decision.matched?.permission,
          sessionId: principal.sessionId,
          apiKeyId: principal.apiKeyId,
          impersonatedBy: principal.impersonatedBy,
        },
      }),
    );
  }
}
