import {
  NotFoundError,
  paginate,
  type IsoDateTime,
  type Page,
  type PageRequest,
  type RoleCode,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import type {
  ApiKeyRepository,
  AuditRepository,
  GroupRepository,
  PolicyVersionStore,
  RoleBindingRepository,
  RoleRepository,
  SessionRepository,
  TenantRepository,
  UserFilter,
  UserRepository,
} from "../../application/ports.js";
import type { ApiKey } from "../../domain/api-key.js";
import { matchesAuditQuery, type AuditEntry, type AuditQuery } from "../../domain/audit.js";
import type { Group } from "../../domain/group.js";
import type { Role } from "../../domain/role.js";
import type { RoleBinding } from "../../domain/role-binding.js";
import type { Session } from "../../domain/session.js";
import { subjectKey, type SubjectRef } from "../../domain/subject.js";
import type { Tenant } from "../../domain/tenant.js";
import type { User } from "../../domain/user.js";
import { InMemoryRepository, sortBy } from "./in-memory-repository.js";

export class InMemoryTenantRepository implements TenantRepository {
  private readonly byIdMap = new Map<string, Tenant>();
  private readonly bySlugMap = new Map<string, Tenant>();

  save(tenant: Tenant): void {
    this.byIdMap.set(tenant.tenantId, tenant);
    this.bySlugMap.set(tenant.slug, tenant);
  }

  byId(tenantId: TenantId): Tenant | undefined {
    return this.byIdMap.get(tenantId);
  }

  bySlug(slug: string): Tenant | undefined {
    return this.bySlugMap.get(slug.trim().toLowerCase());
  }

  require(tenantId: TenantId): Tenant {
    const tenant = this.byId(tenantId);
    if (!tenant) throw new NotFoundError("Tenant", tenantId);
    return tenant;
  }

  list(): readonly Tenant[] {
    return sortBy([...this.byIdMap.values()], (tenant) => tenant.slug);
  }

  clear(): void {
    this.byIdMap.clear();
    this.bySlugMap.clear();
  }
}

export class InMemoryUserRepository extends InMemoryRepository<User> implements UserRepository {
  private readonly emailIndex = new Map<string, User>();

  constructor() {
    super("User");
  }

  protected override onSaved(user: User): void {
    this.emailIndex.set(this.emailKey(user.tenantId, user.email), user);
  }

  protected override onDeleted(user: User): void {
    this.emailIndex.delete(this.emailKey(user.tenantId, user.email));
  }

  byEmail(tenantId: TenantId, email: string): User | undefined {
    const found = this.emailIndex.get(this.emailKey(tenantId, email.trim().toLowerCase()));
    // The index can hold a stale key after `changeEmail`; fall back to a scan so a
    // renamed user is never invisible.
    if (found && found.email === email.trim().toLowerCase()) return found;
    return this.list(tenantId).find((user) => user.email === email.trim().toLowerCase());
  }

  override list(tenantId: TenantId, filter: UserFilter = {}): readonly User[] {
    const search = filter.search?.trim().toLowerCase();
    return sortBy(
      super.list(tenantId).filter((user) => {
        if (filter.status && user.status !== filter.status) return false;
        if (filter.lockedOnly && user.lockedUntil === undefined) return false;
        if (search) {
          const haystack = `${user.email} ${user.displayName}`.toLowerCase();
          if (!haystack.includes(search)) return false;
        }
        return true;
      }),
      (user) => user.email,
    );
  }

  page(tenantId: TenantId, request: PageRequest, filter?: UserFilter): Page<User> {
    return paginate(this.list(tenantId, filter), request);
  }

  override count(tenantId: TenantId, filter?: UserFilter): number {
    return this.list(tenantId, filter).length;
  }

  private emailKey(tenantId: TenantId, email: string): string {
    return `${tenantId}|${email}`;
  }
}

export class InMemoryRoleRepository extends InMemoryRepository<Role> implements RoleRepository {
  constructor() {
    super("Role");
  }

  byCode(tenantId: TenantId, code: RoleCode): Role | undefined {
    return this.list(tenantId).find((role) => role.code === code);
  }

  override require(tenantId: TenantId, code: RoleCode | Ulid): Role {
    const role = this.byCode(tenantId, code as RoleCode) ?? this.byId(tenantId, code as Ulid);
    if (!role) throw new NotFoundError("Role", code);
    return role;
  }

  map(tenantId: TenantId): ReadonlyMap<RoleCode, Role> {
    const map = new Map<RoleCode, Role>();
    for (const role of this.list(tenantId)) map.set(role.code, role);
    return map;
  }
}

export class InMemoryGroupRepository extends InMemoryRepository<Group> implements GroupRepository {
  constructor() {
    super("Group");
  }

  byName(tenantId: TenantId, name: string): Group | undefined {
    const needle = name.trim().toLowerCase();
    return this.list(tenantId).find((group) => group.name.toLowerCase() === needle);
  }

  forUser(tenantId: TenantId, userId: Ulid): readonly Group[] {
    return this.list(tenantId).filter((group) => group.hasMember(userId));
  }
}

export class InMemoryRoleBindingRepository
  extends InMemoryRepository<RoleBinding>
  implements RoleBindingRepository
{
  constructor() {
    super("RoleBinding");
  }

  bySubject(tenantId: TenantId, subject: SubjectRef): readonly RoleBinding[] {
    const key = subjectKey(subject);
    return this.list(tenantId).filter((binding) => subjectKey(binding.subject) === key);
  }

  bySubjects(tenantId: TenantId, subjects: readonly SubjectRef[]): readonly RoleBinding[] {
    const keys = new Set(subjects.map(subjectKey));
    return this.list(tenantId).filter((binding) => keys.has(subjectKey(binding.subject)));
  }

  byRole(tenantId: TenantId, roleCode: RoleCode): readonly RoleBinding[] {
    return this.list(tenantId).filter((binding) => binding.roleCode === roleCode);
  }
}

export class InMemoryApiKeyRepository extends InMemoryRepository<ApiKey> implements ApiKeyRepository {
  private readonly prefixIndex = new Map<string, ApiKey>();

  constructor() {
    super("ApiKey");
  }

  protected override onSaved(key: ApiKey): void {
    this.prefixIndex.set(key.prefix, key);
  }

  protected override onDeleted(key: ApiKey): void {
    this.prefixIndex.delete(key.prefix);
  }

  byPrefix(prefix: string): ApiKey | undefined {
    return this.prefixIndex.get(prefix);
  }

  activeCount(tenantId: TenantId, now: IsoDateTime): number {
    return this.list(tenantId).filter((key) => key.isUsableAt(now)).length;
  }
}

export class InMemorySessionRepository
  extends InMemoryRepository<Session>
  implements SessionRepository
{
  constructor() {
    super("Session");
  }

  byUser(tenantId: TenantId, userId: Ulid): readonly Session[] {
    return this.list(tenantId).filter((session) => session.userId === userId);
  }

  activeForUser(tenantId: TenantId, userId: Ulid, now: IsoDateTime): readonly Session[] {
    return this.byUser(tenantId, userId).filter((session) => session.isValidAt(now));
  }
}

/**
 * Append-only store. Entries are kept newest-first because every read path (recent
 * denials, audit pages) wants that order, and the write path is a single unshift.
 */
export class InMemoryAuditRepository implements AuditRepository {
  private readonly byTenant = new Map<string, AuditEntry[]>();

  append(entry: AuditEntry): void {
    const bucket = this.byTenant.get(entry.tenantId) ?? [];
    bucket.unshift(entry);
    this.byTenant.set(entry.tenantId, bucket);
  }

  list(tenantId: TenantId, query: AuditQuery = {}): readonly AuditEntry[] {
    const bucket = this.byTenant.get(tenantId) ?? [];
    return bucket.filter((entry) => matchesAuditQuery(entry, query));
  }

  page(tenantId: TenantId, request: PageRequest, query: AuditQuery = {}): Page<AuditEntry> {
    return paginate(this.list(tenantId, query), request);
  }

  count(tenantId: TenantId, query: AuditQuery = {}): number {
    return this.list(tenantId, query).length;
  }

  clear(): void {
    this.byTenant.clear();
  }
}

export class InMemoryPolicyVersionStore implements PolicyVersionStore {
  private readonly versions = new Map<string, number>();

  current(tenantId: TenantId): number {
    return this.versions.get(tenantId) ?? 1;
  }

  bump(tenantId: TenantId): number {
    const next = this.current(tenantId) + 1;
    this.versions.set(tenantId, next);
    return next;
  }
}
