import {
  NotFoundError,
  brand,
  type IsoDateTime,
  type RoleCode,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { AuditEntry } from "../domain/audit.js";
import { IDENTITY_ERROR, IdentityError } from "../domain/errors.js";
import { roleCodeOf } from "../domain/role.js";
import { RoleBinding } from "../domain/role-binding.js";
import { ROOT_SCOPE, scopeCovers, scopePath, type ScopePath } from "../domain/scope.js";
import { subjectKey, type SubjectRef } from "../domain/subject.js";
import type {
  ApiKeyRepository,
  AuditRepository,
  Clock,
  EventPublisher,
  GroupRepository,
  PolicyVersionStore,
  RoleBindingRepository,
  RoleRepository,
  UserRepository,
} from "./ports.js";

export interface GrantRoleInput {
  readonly subject: SubjectRef;
  readonly roleCode: string;
  readonly scope?: string;
  readonly validFrom?: IsoDateTime;
  readonly validUntil?: IsoDateTime;
  readonly grantedBy?: Ulid;
  readonly reason?: string;
  readonly delegable?: boolean;
}

export interface BindingFilter {
  readonly subject?: SubjectRef;
  readonly roleCode?: RoleCode;
  readonly scopePrefix?: string;
  readonly activeOnly?: boolean;
}

export class RoleBindingService {
  constructor(
    private readonly bindings: RoleBindingRepository,
    private readonly roles: RoleRepository,
    private readonly users: UserRepository,
    private readonly groups: GroupRepository,
    private readonly apiKeys: ApiKeyRepository,
    private readonly audit: AuditRepository,
    private readonly policyVersions: PolicyVersionStore,
    private readonly clock: Clock,
    private readonly publisher: EventPublisher,
  ) {}

  grant(tenantId: TenantId, input: GrantRoleInput): RoleBinding {
    const code = roleCodeOf(input.roleCode);
    const role = this.roles.byCode(tenantId, code);
    if (!role) throw new NotFoundError("Role", code);
    if (!role.isAssignable) {
      throw new IdentityError(
        `Role ${code} exists only to be inherited and cannot be bound directly`,
        IDENTITY_ERROR.roleNotAssignable,
        422,
      );
    }
    this.assertSubjectExists(tenantId, input.subject);

    const scope = input.scope ? scopePath(input.scope) : ROOT_SCOPE;
    const now = this.clock.now();
    const duplicate = this.bindings
      .bySubject(tenantId, input.subject)
      .find(
        (binding) =>
          binding.isActiveAt(now) && binding.roleCode === code && binding.scope === scope,
      );
    if (duplicate) {
      throw new IdentityError(
        `${subjectKey(input.subject)} already holds ${code} at ${scope}`,
        IDENTITY_ERROR.bindingDuplicate,
        409,
      );
    }

    const binding = RoleBinding.grant({
      tenantId,
      subject: input.subject,
      roleCode: code,
      scope,
      validFrom: input.validFrom ?? now,
      validUntil: input.validUntil,
      grantedBy: input.grantedBy,
      reason: input.reason,
      delegable: input.delegable,
    });
    this.persist(tenantId, binding);
    this.recordAdmin(tenantId, "admin.role_binding.granted", binding, input.grantedBy);
    return binding;
  }

  /**
   * Delegated grant: the actor may only pass on a role they themselves hold as delegable,
   * and only at their own scope or narrower. This is what keeps "admin of EMEA" from
   * minting a tenant-wide admin.
   */
  delegate(
    tenantId: TenantId,
    actor: SubjectRef,
    input: GrantRoleInput,
  ): RoleBinding {
    const now = this.clock.now();
    const scope = input.scope ? scopePath(input.scope) : ROOT_SCOPE;
    const code = roleCodeOf(input.roleCode);
    const held = this.bindings
      .bySubject(tenantId, actor)
      .filter((binding) => binding.isActiveAt(now) && binding.delegable && binding.roleCode === code);
    const authorized = held.some((binding) => scopeCovers(binding.scope, scope));
    if (!authorized) {
      throw new IdentityError(
        `${subjectKey(actor)} cannot delegate ${code} at ${scope}`,
        IDENTITY_ERROR.roleNotAssignable,
        403,
      );
    }
    return this.grant(tenantId, { ...input, grantedBy: actor.id, delegable: false });
  }

  get(tenantId: TenantId, bindingId: Ulid): RoleBinding {
    const binding = this.bindings.byId(tenantId, bindingId);
    if (!binding) throw new NotFoundError("RoleBinding", bindingId);
    return binding;
  }

  list(tenantId: TenantId, filter: BindingFilter = {}): readonly RoleBinding[] {
    const now = this.clock.now();
    const source = filter.subject
      ? this.bindings.bySubject(tenantId, filter.subject)
      : this.bindings.list(tenantId);
    return source
      .filter((binding) => (filter.roleCode ? binding.roleCode === filter.roleCode : true))
      .filter((binding) =>
        filter.scopePrefix ? binding.scope.startsWith(filter.scopePrefix) : true,
      )
      .filter((binding) => (filter.activeOnly ? binding.isActiveAt(now) : true))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Bindings that apply to a subject including the ones it inherits from its groups. */
  effectiveFor(tenantId: TenantId, subject: SubjectRef): readonly RoleBinding[] {
    const subjects: SubjectRef[] = [subject];
    if (subject.type === "user") {
      for (const group of this.groups.forUser(tenantId, subject.id)) {
        subjects.push({ type: "group", id: group.id });
      }
    }
    return this.bindings.bySubjects(tenantId, subjects);
  }

  revoke(
    tenantId: TenantId,
    bindingId: Ulid,
    options: { by?: Ulid; reason?: string } = {},
  ): RoleBinding {
    const binding = this.get(tenantId, bindingId);
    binding.revoke({ at: this.clock.now(), by: options.by, reason: options.reason });
    this.persist(tenantId, binding);
    this.recordAdmin(tenantId, "admin.role_binding.revoked", binding, options.by, options.reason);
    return binding;
  }

  /** Revokes every active binding for a subject; used when disabling an account or key. */
  revokeAllFor(
    tenantId: TenantId,
    subject: SubjectRef,
    options: { by?: Ulid; reason?: string } = {},
  ): number {
    const now = this.clock.now();
    let count = 0;
    for (const binding of this.bindings.bySubject(tenantId, subject)) {
      if (!binding.isActiveAt(now)) continue;
      binding.revoke({ at: now, by: options.by, reason: options.reason ?? "subject_disabled" });
      this.persist(tenantId, binding);
      count += 1;
    }
    return count;
  }

  extend(tenantId: TenantId, bindingId: Ulid, validUntil?: IsoDateTime): RoleBinding {
    const binding = this.get(tenantId, bindingId);
    binding.extend(validUntil);
    this.persist(tenantId, binding);
    return binding;
  }

  /** Grants a role for a fixed number of hours — the usual shape of break-glass access. */
  grantTemporary(
    tenantId: TenantId,
    input: Omit<GrantRoleInput, "validUntil"> & { hours: number },
  ): RoleBinding {
    const from = input.validFrom ?? this.clock.now();
    const until = brand<string, "IsoDateTime">(
      new Date(Date.parse(from) + input.hours * 3_600_000).toISOString(),
    );
    return this.grant(tenantId, { ...input, validFrom: from, validUntil: until });
  }

  /** Bindings that lapse within the window, so operators can renew before access drops. */
  expiringWithin(tenantId: TenantId, hours: number): readonly RoleBinding[] {
    const now = this.clock.now();
    const horizon = Date.parse(now) + hours * 3_600_000;
    return this.bindings
      .list(tenantId)
      .filter((binding) => {
        const until = binding.validUntil;
        return (
          binding.isActiveAt(now) && until !== undefined && Date.parse(until) <= horizon
        );
      })
      .sort((a, b) => (a.validUntil ?? "").localeCompare(b.validUntil ?? ""));
  }

  /** Marks lapsed bindings as revoked so listings stop showing them as active. */
  sweepExpired(tenantId: TenantId): number {
    const now = this.clock.now();
    let swept = 0;
    for (const binding of this.bindings.list(tenantId)) {
      if (!binding.isExpiredAt(now)) continue;
      binding.revoke({ at: now, reason: "expired" });
      this.persist(tenantId, binding);
      swept += 1;
    }
    return swept;
  }

  /** Every subject holding a role at or above the given scope. */
  subjectsWithRole(
    tenantId: TenantId,
    roleCode: RoleCode,
    scope: ScopePath = ROOT_SCOPE,
  ): readonly SubjectRef[] {
    const now = this.clock.now();
    const seen = new Map<string, SubjectRef>();
    for (const binding of this.bindings.byRole(tenantId, roleCode)) {
      if (!binding.isActiveAt(now) || !binding.covers(scope)) continue;
      seen.set(subjectKey(binding.subject), binding.subject);
    }
    return [...seen.values()];
  }

  private assertSubjectExists(tenantId: TenantId, subject: SubjectRef): void {
    switch (subject.type) {
      case "user":
        this.users.require(tenantId, subject.id);
        return;
      case "group":
        this.groups.require(tenantId, subject.id);
        return;
      case "api_key":
        this.apiKeys.require(tenantId, subject.id);
        return;
      case "service":
        // Service principals are external to this context (other bounded contexts call
        // in with their own identity), so there is nothing local to verify.
        return;
    }
  }

  private recordAdmin(
    tenantId: TenantId,
    action: string,
    binding: RoleBinding,
    actorId?: Ulid,
    reason?: string,
  ): void {
    this.audit.append(
      AuditEntry.record({
        tenantId,
        at: this.clock.now(),
        category: "admin",
        action,
        outcome: "success",
        subject: binding.subject,
        scope: binding.scope,
        resourceType: "role_binding",
        resourceId: binding.id,
        actorId,
        reason,
        metadata: { roleCode: binding.roleCode, validUntil: binding.validUntil },
      }),
    );
  }

  private persist(tenantId: TenantId, binding: RoleBinding): void {
    this.bindings.save(binding);
    this.policyVersions.bump(tenantId);
    this.publisher.publish(binding.pullEvents());
  }
}
