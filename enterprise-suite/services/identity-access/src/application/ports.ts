import type {
  EventEnvelope,
  IsoDateTime,
  Page,
  PageRequest,
  RoleCode,
  TenantId,
  Ulid,
} from "@enterprise-suite/shared-kernel";
import type { ApiKey } from "../domain/api-key.js";
import type { AuditEntry, AuditQuery } from "../domain/audit.js";
import type { PasswordHash, SecretHash } from "../domain/credential.js";
import type { Group } from "../domain/group.js";
import type { Role } from "../domain/role.js";
import type { RoleBinding } from "../domain/role-binding.js";
import type { Session } from "../domain/session.js";
import type { SubjectRef } from "../domain/subject.js";
import type { Tenant } from "../domain/tenant.js";
import type { User, UserStatus } from "../domain/user.js";

export interface Clock {
  now(): IsoDateTime;
  /** Milliseconds since epoch for the same instant as `now()`. */
  epochMs(): number;
}

export interface PasswordHasher {
  hash(plaintext: string, now: IsoDateTime): PasswordHash;
  verify(plaintext: string, hash: PasswordHash): boolean;
}

export interface SecretHasher {
  hash(plaintext: string): SecretHash;
  verify(plaintext: string, hash: SecretHash): boolean;
}

export interface TokenGenerator {
  /** URL-safe random secret used as the bearer half of a token. */
  secret(bytes?: number): string;
  /** Short public identifier stored in clear, e.g. an API key prefix. */
  prefix(length?: number): string;
}

export interface EventPublisher {
  publish(events: readonly EventEnvelope[]): void;
}

/** Transactional outbox; the in-memory implementation keeps the same contract. */
export interface Outbox extends EventPublisher {
  pending(): readonly EventEnvelope[];
  drain(): readonly EventEnvelope[];
  size(): number;
}

export interface TenantRepository {
  save(tenant: Tenant): void;
  byId(tenantId: TenantId): Tenant | undefined;
  bySlug(slug: string): Tenant | undefined;
  require(tenantId: TenantId): Tenant;
  list(): readonly Tenant[];
}

export interface UserFilter {
  readonly status?: UserStatus;
  readonly search?: string;
  readonly groupId?: Ulid;
  readonly lockedOnly?: boolean;
}

export interface UserRepository {
  save(user: User): void;
  byId(tenantId: TenantId, id: Ulid): User | undefined;
  require(tenantId: TenantId, id: Ulid): User;
  byEmail(tenantId: TenantId, email: string): User | undefined;
  list(tenantId: TenantId, filter?: UserFilter): readonly User[];
  page(tenantId: TenantId, request: PageRequest, filter?: UserFilter): Page<User>;
  count(tenantId: TenantId, filter?: UserFilter): number;
}

export interface RoleRepository {
  save(role: Role): void;
  byId(tenantId: TenantId, id: Ulid): Role | undefined;
  byCode(tenantId: TenantId, code: RoleCode): Role | undefined;
  require(tenantId: TenantId, code: RoleCode): Role;
  list(tenantId: TenantId): readonly Role[];
  /** Code-keyed map used by the evaluator to resolve inheritance without N lookups. */
  map(tenantId: TenantId): ReadonlyMap<RoleCode, Role>;
  count(tenantId: TenantId): number;
  delete(tenantId: TenantId, id: Ulid): void;
}

export interface GroupRepository {
  save(group: Group): void;
  byId(tenantId: TenantId, id: Ulid): Group | undefined;
  require(tenantId: TenantId, id: Ulid): Group;
  byName(tenantId: TenantId, name: string): Group | undefined;
  list(tenantId: TenantId): readonly Group[];
  forUser(tenantId: TenantId, userId: Ulid): readonly Group[];
  delete(tenantId: TenantId, id: Ulid): void;
}

export interface RoleBindingRepository {
  save(binding: RoleBinding): void;
  byId(tenantId: TenantId, id: Ulid): RoleBinding | undefined;
  require(tenantId: TenantId, id: Ulid): RoleBinding;
  bySubject(tenantId: TenantId, subject: SubjectRef): readonly RoleBinding[];
  bySubjects(tenantId: TenantId, subjects: readonly SubjectRef[]): readonly RoleBinding[];
  byRole(tenantId: TenantId, roleCode: RoleCode): readonly RoleBinding[];
  list(tenantId: TenantId): readonly RoleBinding[];
  count(tenantId: TenantId): number;
}

export interface ApiKeyRepository {
  save(key: ApiKey): void;
  byId(tenantId: TenantId, id: Ulid): ApiKey | undefined;
  require(tenantId: TenantId, id: Ulid): ApiKey;
  /** Prefix lookup is global: the presented token does not carry a tenant. */
  byPrefix(prefix: string): ApiKey | undefined;
  list(tenantId: TenantId): readonly ApiKey[];
  activeCount(tenantId: TenantId, now: IsoDateTime): number;
}

export interface SessionRepository {
  save(session: Session): void;
  byId(tenantId: TenantId, id: Ulid): Session | undefined;
  /** Global by id because a presented session token does not carry a tenant. */
  byIdAnyTenant(id: Ulid): Session | undefined;
  byUser(tenantId: TenantId, userId: Ulid): readonly Session[];
  activeForUser(tenantId: TenantId, userId: Ulid, now: IsoDateTime): readonly Session[];
  list(tenantId: TenantId): readonly Session[];
}

export interface AuditRepository {
  append(entry: AuditEntry): void;
  list(tenantId: TenantId, query?: AuditQuery): readonly AuditEntry[];
  page(tenantId: TenantId, request: PageRequest, query?: AuditQuery): Page<AuditEntry>;
  count(tenantId: TenantId, query?: AuditQuery): number;
}

/**
 * Monotonic counter bumped whenever roles, bindings or group membership change.
 * The authorization cache keys on it, so a policy edit invalidates cached decisions
 * for the tenant without tracking individual dependencies.
 */
export interface PolicyVersionStore {
  current(tenantId: TenantId): number;
  bump(tenantId: TenantId): number;
}

export interface IdentityRepositories {
  readonly tenants: TenantRepository;
  readonly users: UserRepository;
  readonly roles: RoleRepository;
  readonly groups: GroupRepository;
  readonly bindings: RoleBindingRepository;
  readonly apiKeys: ApiKeyRepository;
  readonly sessions: SessionRepository;
  readonly audit: AuditRepository;
  readonly policyVersions: PolicyVersionStore;
}
