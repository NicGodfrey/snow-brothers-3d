import type { TenantId } from "@enterprise-suite/shared-kernel";
import { ApiKeyService } from "../application/api-key-service.js";
import { AuditService } from "../application/audit-service.js";
import { AuthenticationService } from "../application/authentication-service.js";
import {
  AuthorizationService,
  type AuthorizationServiceOptions,
} from "../application/authorization-service.js";
import { GroupService } from "../application/group-service.js";
import type {
  Clock,
  IdentityRepositories,
  PasswordHasher,
  SecretHasher,
  TokenGenerator,
} from "../application/ports.js";
import { RoleBindingService } from "../application/role-binding-service.js";
import { RoleService } from "../application/role-service.js";
import { SessionService } from "../application/session-service.js";
import { TenantService } from "../application/tenant-service.js";
import { UserService } from "../application/user-service.js";
import type { PermissionCatalog, PermissionDefinition } from "../domain/permission.js";
import { createPermissionCatalog } from "./bootstrap/system-permissions.js";
import { buildSystemRoles } from "./bootstrap/system-roles.js";
import { SystemClock } from "./clock.js";
import { Pbkdf2PasswordHasher, RandomTokenGenerator, Sha256SecretHasher } from "./crypto/hashing.js";
import { InMemoryOutbox } from "./memory/outbox.js";
import {
  InMemoryApiKeyRepository,
  InMemoryAuditRepository,
  InMemoryGroupRepository,
  InMemoryPolicyVersionStore,
  InMemoryRoleBindingRepository,
  InMemoryRoleRepository,
  InMemorySessionRepository,
  InMemoryTenantRepository,
  InMemoryUserRepository,
} from "./memory/repositories.js";

export interface IdentityModuleOptions {
  readonly clock?: Clock;
  readonly passwordHasher?: PasswordHasher;
  readonly secretHasher?: SecretHasher;
  readonly tokens?: TokenGenerator;
  readonly outbox?: InMemoryOutbox;
  readonly catalog?: PermissionCatalog;
  readonly extraPermissions?: readonly PermissionDefinition[];
  readonly authorization?: AuthorizationServiceOptions;
}

export interface IdentityModule {
  readonly repositories: IdentityRepositories;
  readonly outbox: InMemoryOutbox;
  readonly clock: Clock;
  readonly catalog: PermissionCatalog;
  readonly passwordHasher: PasswordHasher;
  readonly secretHasher: SecretHasher;
  readonly tokens: TokenGenerator;
  readonly tenants: TenantService;
  readonly users: UserService;
  readonly groups: GroupService;
  readonly roles: RoleService;
  readonly bindings: RoleBindingService;
  readonly apiKeys: ApiKeyService;
  readonly sessions: SessionService;
  readonly authentication: AuthenticationService;
  readonly authorization: AuthorizationService;
  readonly audit: AuditService;
  /** Installs the system role set into a freshly provisioned tenant. */
  installSystemRoles(tenantId: TenantId): void;
}

/**
 * Composition root. Everything is constructed by hand: the wiring is explicit, the
 * dependency direction is visible, and tests can swap the clock or hasher without a
 * framework.
 */
export function createIdentityModule(options: IdentityModuleOptions = {}): IdentityModule {
  const clock = options.clock ?? new SystemClock();
  const outbox = options.outbox ?? new InMemoryOutbox();
  const passwordHasher = options.passwordHasher ?? new Pbkdf2PasswordHasher();
  const secretHasher = options.secretHasher ?? new Sha256SecretHasher();
  const tokens = options.tokens ?? new RandomTokenGenerator();
  const catalog = options.catalog ?? createPermissionCatalog(options.extraPermissions);

  const repositories: IdentityRepositories = {
    tenants: new InMemoryTenantRepository(),
    users: new InMemoryUserRepository(),
    roles: new InMemoryRoleRepository(),
    groups: new InMemoryGroupRepository(),
    bindings: new InMemoryRoleBindingRepository(),
    apiKeys: new InMemoryApiKeyRepository(),
    sessions: new InMemorySessionRepository(),
    audit: new InMemoryAuditRepository(),
    policyVersions: new InMemoryPolicyVersionStore(),
  };

  const tenantService = new TenantService(
    repositories.tenants,
    repositories.policyVersions,
    clock,
    outbox,
  );
  const userService = new UserService(
    repositories.users,
    tenantService,
    repositories.sessions,
    repositories.audit,
    repositories.policyVersions,
    passwordHasher,
    secretHasher,
    clock,
    outbox,
  );
  const roleService = new RoleService(
    repositories.roles,
    repositories.bindings,
    catalog,
    repositories.policyVersions,
    clock,
    outbox,
  );
  const groupService = new GroupService(
    repositories.groups,
    repositories.users,
    repositories.bindings,
    repositories.policyVersions,
    clock,
    outbox,
  );
  const bindingService = new RoleBindingService(
    repositories.bindings,
    repositories.roles,
    repositories.users,
    repositories.groups,
    repositories.apiKeys,
    repositories.audit,
    repositories.policyVersions,
    clock,
    outbox,
  );
  const sessionService = new SessionService(
    repositories.sessions,
    repositories.users,
    tenantService,
    repositories.audit,
    secretHasher,
    tokens,
    clock,
    outbox,
  );
  const apiKeyService = new ApiKeyService(
    repositories.apiKeys,
    tenantService,
    bindingService,
    repositories.audit,
    repositories.policyVersions,
    secretHasher,
    tokens,
    clock,
    outbox,
  );
  const authenticationService = new AuthenticationService(
    repositories.users,
    tenantService,
    sessionService,
    apiKeyService,
    repositories.audit,
    passwordHasher,
    clock,
    outbox,
  );
  const authorizationService = new AuthorizationService(
    repositories.tenants,
    repositories.users,
    repositories.groups,
    repositories.roles,
    repositories.bindings,
    repositories.apiKeys,
    repositories.audit,
    catalog,
    repositories.policyVersions,
    clock,
    options.authorization,
  );
  const auditService = new AuditService(repositories.audit, clock);

  return {
    repositories,
    outbox,
    clock,
    catalog,
    passwordHasher,
    secretHasher,
    tokens,
    tenants: tenantService,
    users: userService,
    groups: groupService,
    roles: roleService,
    bindings: bindingService,
    apiKeys: apiKeyService,
    sessions: sessionService,
    authentication: authenticationService,
    authorization: authorizationService,
    audit: auditService,
    installSystemRoles(tenantId: TenantId): void {
      for (const role of buildSystemRoles(tenantId)) {
        if (repositories.roles.byCode(tenantId, role.code)) continue;
        repositories.roles.save(role);
        outbox.publish(role.pullEvents());
      }
      repositories.policyVersions.bump(tenantId);
    },
  };
}
