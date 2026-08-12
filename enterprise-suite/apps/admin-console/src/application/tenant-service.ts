import {
  NotFoundError,
  normalizePage,
  type Page,
  type PageRequest,
  type TenantId,
} from "@enterprise-suite/shared-kernel";
import { DuplicateError, InvalidStateError, ValidationError } from "../domain/errors.js";
import { Role, SYSTEM_ROLES } from "../domain/role.js";
import {
  PLAN_QUOTAS,
  Tenant,
  type CreateTenantInput,
  type QuotaResource,
  type TenantContact,
  type TenantPlan,
  type TenantQuotas,
  type TenantSettings,
} from "../domain/tenant.js";
import type { AuditService } from "./audit-service.js";
import type {
  Clock,
  CommandContext,
  FeatureFlagRepository,
  Outbox,
  ReferenceDataRepository,
  RoleRepository,
  TenantRepository,
  UserRepository,
  WebhookRepository,
} from "./ports.js";

/**
 * Tenant provisioning and lifecycle.
 *
 * Provisioning is not just an insert: a new tenant is seeded with the system
 * roles so its first administrator has something to be granted. Plan changes
 * are checked against live usage — a downgrade that would strand existing
 * users is refused rather than silently leaving the tenant over quota.
 */

export interface TenantUsage {
  readonly users: number;
  readonly roles: number;
  readonly referenceSets: number;
  readonly webhooks: number;
  readonly featureFlags: number;
}

export class TenantService {
  constructor(
    private readonly tenants: TenantRepository,
    private readonly roles: RoleRepository,
    private readonly users: UserRepository,
    private readonly referenceData: ReferenceDataRepository,
    private readonly webhooks: WebhookRepository,
    private readonly flags: FeatureFlagRepository,
    private readonly outbox: Outbox,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  async provision(ctx: CommandContext, input: CreateTenantInput): Promise<Tenant> {
    if (this.tenants.byKey(input.key.trim().toLowerCase())) {
      throw new DuplicateError("Tenant", "key", input.key);
    }
    const tenant = Tenant.create(input);
    this.tenants.save(tenant);
    this.seedSystemRoles(tenant);

    await this.outbox.publish(tenant.pullEvents());
    this.audit.record(ctx, {
      action: "tenant.provision",
      resourceType: "Tenant",
      resourceId: tenant.key,
      after: tenant.toJSON(),
    });
    return tenant;
  }

  require(key: string): Tenant {
    const tenant = this.tenants.byKey(key.trim().toLowerCase());
    if (!tenant) throw new NotFoundError("Tenant", key);
    return tenant;
  }

  /** The tenant a request is acting inside, refusing suspended tenants. */
  requireOperational(tenantId: TenantId): Tenant {
    const tenant = this.require(String(tenantId));
    if (!tenant.isOperational) {
      throw new InvalidStateError(
        `Tenant ${tenant.key} is ${tenant.status} and cannot accept configuration changes`,
        { status: tenant.status },
      );
    }
    return tenant;
  }

  list(filter: { status?: string; plan?: string; search?: string } = {}): Tenant[] {
    return this.tenants.list(filter);
  }

  page(
    filter: { status?: string; plan?: string; search?: string },
    page?: Partial<PageRequest>,
  ): Page<Tenant> {
    const request: PageRequest = normalizePage(page);
    return this.tenants.page(filter, request);
  }

  async activate(ctx: CommandContext, key: string): Promise<Tenant> {
    const tenant = this.require(key);
    const before = tenant.toJSON();
    tenant.activate(this.clock.now());
    this.tenants.save(tenant);
    await this.outbox.publish(tenant.pullEvents());
    this.audit.record(ctx, {
      action: "tenant.activate",
      resourceType: "Tenant",
      resourceId: tenant.key,
      before,
      after: tenant.toJSON(),
    });
    return tenant;
  }

  async suspend(ctx: CommandContext, key: string, reason: string): Promise<Tenant> {
    const tenant = this.require(key);
    const before = tenant.toJSON();
    tenant.suspend(reason, this.clock.now());
    this.tenants.save(tenant);
    await this.outbox.publish(tenant.pullEvents());
    this.audit.record(ctx, {
      action: "tenant.suspend",
      resourceType: "Tenant",
      resourceId: tenant.key,
      before,
      after: tenant.toJSON(),
      reason,
    });
    return tenant;
  }

  async archive(ctx: CommandContext, key: string): Promise<Tenant> {
    const tenant = this.require(key);
    const before = tenant.toJSON();
    tenant.archive(this.clock.now());
    this.tenants.save(tenant);
    await this.outbox.publish(tenant.pullEvents());
    this.audit.record(ctx, {
      action: "tenant.archive",
      resourceType: "Tenant",
      resourceId: tenant.key,
      before,
      after: tenant.toJSON(),
    });
    return tenant;
  }

  async changePlan(
    ctx: CommandContext,
    key: string,
    plan: TenantPlan,
    overrides?: Partial<TenantQuotas>,
  ): Promise<Tenant> {
    const tenant = this.require(key);
    const before = tenant.toJSON();
    const usage = this.usage(tenant.tenantId);
    const nextQuotas: TenantQuotas = { ...PLAN_QUOTAS[plan], ...overrides };

    const breaches = (Object.keys(usage) as (keyof TenantUsage)[])
      .filter((resource) => usage[resource] > nextQuotas[resource as QuotaResource])
      .map((resource) => ({
        field: `quotas.${resource}`,
        message: `current usage ${usage[resource]} exceeds the ${plan} limit of ${nextQuotas[resource as QuotaResource]}`,
      }));
    if (breaches.length > 0) throw ValidationError.from(breaches);

    tenant.changePlan(plan, overrides);
    this.tenants.save(tenant);
    await this.outbox.publish(tenant.pullEvents());
    this.audit.record(ctx, {
      action: "tenant.change-plan",
      resourceType: "Tenant",
      resourceId: tenant.key,
      before,
      after: tenant.toJSON(),
    });
    return tenant;
  }

  async updateSettings(
    ctx: CommandContext,
    key: string,
    patch: Partial<TenantSettings>,
  ): Promise<Tenant> {
    const tenant = this.require(key);
    const before = tenant.toJSON();
    tenant.updateSettings(patch);
    this.tenants.save(tenant);
    await this.outbox.publish(tenant.pullEvents());
    this.audit.record(ctx, {
      action: "tenant.update-settings",
      resourceType: "Tenant",
      resourceId: tenant.key,
      before,
      after: tenant.toJSON(),
    });
    return tenant;
  }

  async rename(ctx: CommandContext, key: string, name: string): Promise<Tenant> {
    const tenant = this.require(key);
    const before = { name: tenant.name };
    tenant.rename(name);
    this.tenants.save(tenant);
    this.audit.record(ctx, {
      action: "tenant.rename",
      resourceType: "Tenant",
      resourceId: tenant.key,
      before,
      after: { name: tenant.name },
    });
    return tenant;
  }

  async setContact(ctx: CommandContext, key: string, contact: TenantContact): Promise<Tenant> {
    const tenant = this.require(key);
    tenant.setContact(contact);
    this.tenants.save(tenant);
    this.audit.record(ctx, {
      action: "tenant.set-contact",
      resourceType: "Tenant",
      resourceId: tenant.key,
      after: { contact },
    });
    return tenant;
  }

  usage(tenantId: TenantId): TenantUsage {
    return {
      users: this.users.count(tenantId),
      roles: this.roles.list(tenantId).filter((role) => !role.isSystem).length,
      referenceSets: this.referenceData.count(tenantId),
      webhooks: this.webhooks.count(tenantId),
      featureFlags: this.flags.count(tenantId),
    };
  }

  /** Quota headroom for the console dashboard. */
  quotaReport(key: string): {
    tenant: string;
    plan: TenantPlan;
    entries: { resource: QuotaResource; used: number; limit: number; percent: number }[];
  } {
    const tenant = this.require(key);
    const usage = this.usage(tenant.tenantId);
    const entries = (Object.keys(usage) as (keyof TenantUsage)[]).map((resource) => {
      const limit = tenant.quotas[resource as QuotaResource];
      const used = usage[resource];
      return {
        resource: resource as QuotaResource,
        used,
        limit,
        percent: limit === 0 ? 100 : Math.round((used / limit) * 100),
      };
    });
    return { tenant: tenant.key, plan: tenant.plan, entries };
  }

  /** Checks a quota before a dependent service creates a record. */
  assertQuota(tenantId: TenantId, resource: QuotaResource, current: number): void {
    this.require(String(tenantId)).assertWithinQuota(resource, current);
  }

  private seedSystemRoles(tenant: Tenant): void {
    for (const definition of SYSTEM_ROLES) {
      const role = Role.create(tenant.tenantId, definition);
      role.pullEvents();
      this.roles.save(role);
    }
  }
}
