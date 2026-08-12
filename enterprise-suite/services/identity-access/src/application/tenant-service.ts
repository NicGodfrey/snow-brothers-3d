import {
  ConflictError,
  NotFoundError,
  tenantId as toTenantId,
  type TenantId,
} from "@enterprise-suite/shared-kernel";
import { IDENTITY_ERROR, IdentityError } from "../domain/errors.js";
import { slug as toSlug } from "../domain/ids.js";
import {
  Tenant,
  type TenantSettings,
  type TenantSettingsPatch,
  type TenantStatus,
} from "../domain/tenant.js";
import type { Clock, EventPublisher, PolicyVersionStore, TenantRepository } from "./ports.js";

export interface ProvisionTenantInput {
  readonly tenantId?: string;
  readonly slug: string;
  readonly name: string;
  readonly settings?: TenantSettingsPatch;
  /** Provisioning and activation in one step, for self-service signup flows. */
  readonly activate?: boolean;
}

export class TenantService {
  constructor(
    private readonly tenants: TenantRepository,
    private readonly policyVersions: PolicyVersionStore,
    private readonly clock: Clock,
    private readonly publisher: EventPublisher,
  ) {}

  provision(input: ProvisionTenantInput): Tenant {
    const normalizedSlug = toSlug(input.slug);
    if (this.tenants.bySlug(normalizedSlug)) {
      throw new IdentityError(
        `Tenant slug "${normalizedSlug}" is already taken`,
        IDENTITY_ERROR.tenantSlugTaken,
        409,
      );
    }
    const id = toTenantId(input.tenantId ?? `ten_${normalizedSlug}`);
    if (this.tenants.byId(id)) {
      throw new ConflictError(`Tenant ${id} already exists`);
    }
    const tenant = Tenant.provision({
      tenantId: id,
      slug: normalizedSlug,
      name: input.name,
      settings: input.settings,
      now: this.clock.now(),
    });
    if (input.activate) tenant.activate(this.clock.now());
    this.persist(tenant);
    return tenant;
  }

  get(tenantId: TenantId): Tenant {
    const tenant = this.tenants.byId(tenantId);
    if (!tenant) throw new NotFoundError("Tenant", tenantId);
    return tenant;
  }

  getBySlug(slug: string): Tenant {
    const tenant = this.tenants.bySlug(slug);
    if (!tenant) throw new NotFoundError("Tenant", slug);
    return tenant;
  }

  list(status?: TenantStatus): readonly Tenant[] {
    const all = this.tenants.list();
    return status ? all.filter((tenant) => tenant.status === status) : all;
  }

  activate(tenantId: TenantId): Tenant {
    const tenant = this.get(tenantId);
    tenant.activate(this.clock.now());
    this.persist(tenant);
    return tenant;
  }

  suspend(tenantId: TenantId, reason: string): Tenant {
    const tenant = this.get(tenantId);
    tenant.suspend(reason);
    this.persist(tenant);
    return tenant;
  }

  archive(tenantId: TenantId): Tenant {
    const tenant = this.get(tenantId);
    tenant.archive(this.clock.now());
    this.persist(tenant);
    return tenant;
  }

  rename(tenantId: TenantId, name: string): Tenant {
    const tenant = this.get(tenantId);
    tenant.rename(name);
    this.persist(tenant);
    return tenant;
  }

  updateSettings(tenantId: TenantId, patch: TenantSettingsPatch): Tenant {
    const tenant = this.get(tenantId);
    tenant.updateSettings(patch);
    this.persist(tenant);
    return tenant;
  }

  settings(tenantId: TenantId): TenantSettings {
    return this.get(tenantId).settings;
  }

  /** Throws unless the tenant exists and is active; used as a guard by other services. */
  requireActive(tenantId: TenantId): Tenant {
    const tenant = this.get(tenantId);
    tenant.assertActive();
    return tenant;
  }

  private persist(tenant: Tenant): void {
    this.tenants.save(tenant);
    // Tenant status and settings feed every authorization decision, so a change here
    // must invalidate cached decisions just as a role edit does.
    this.policyVersions.bump(tenant.tenantId);
    this.publisher.publish(tenant.pullEvents());
  }
}
