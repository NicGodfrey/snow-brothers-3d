import {
  ConflictError,
  NotFoundError,
  normalizePage,
  type Page,
  type PageRequest,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { haversineKm, type AddressInput, type GeoPoint, type PostalAddress } from "../domain/address.js";
import { validateGln } from "../domain/identifiers.js";
import { InvalidStateError, ValidationError } from "../domain/errors.js";
import { Site, type CreateSiteInput, type SiteRole } from "../domain/site.js";
import type { CodeListService } from "./code-list-service.js";
import type { CustomerRepository, Clock, OutboxPort, SiteFilter, SiteRepository } from "./ports.js";

export interface CreateSiteCommand {
  readonly customerId: Ulid;
  readonly code: string;
  readonly name: string;
  readonly roles: readonly SiteRole[];
  readonly address: AddressInput;
  readonly effectiveFrom?: string;
  readonly timezone?: string;
  readonly taxJurisdictionCode?: string;
  readonly deliveryInstructions?: string;
  readonly gln?: string;
  readonly externalIds?: Readonly<Record<string, string>>;
  /** Makes the site the customer's default for these roles. */
  readonly primaryForRoles?: readonly SiteRole[];
}

export interface NearbySite {
  readonly site: Site;
  readonly distanceKm: number;
}

/**
 * Site use cases.
 *
 * Sites are per-customer, so uniqueness of the site code is scoped to the
 * customer rather than the tenant. The service also enforces the constraint
 * the aggregate cannot see: at most one primary site per role per customer,
 * which is what order entry relies on when it defaults a ship-to.
 */
export class SiteService {
  constructor(
    private readonly sites: SiteRepository,
    private readonly customers: CustomerRepository,
    private readonly codeLists: CodeListService,
    private readonly outbox: OutboxPort,
    private readonly clock: Clock,
  ) {}

  async create(ctx: TenantContext, command: CreateSiteCommand): Promise<Site> {
    const customer = await this.customers.byId(ctx.tenantId, command.customerId);
    if (!customer) throw new NotFoundError("Customer", command.customerId);
    if (customer.status === "merged") {
      throw new InvalidStateError(
        `Customer ${customer.number} was merged into ${customer.mergedIntoId}; add the site there`,
      );
    }
    const code = command.code.trim().toUpperCase();
    if (await this.sites.byCode(ctx.tenantId, command.customerId, code)) {
      throw new ConflictError(`Site ${code} already exists for customer ${customer.number}`);
    }
    if (command.gln) {
      const verdict = validateGln(command.gln);
      if (!verdict.valid) throw ValidationError.single("gln", verdict.reason ?? "invalid GLN");
    }
    if (command.taxJurisdictionCode) {
      await this.assertTaxJurisdiction(ctx, command.taxJurisdictionCode);
    }

    const input: CreateSiteInput = {
      ...command,
      code,
      effectiveFrom: (command.effectiveFrom ?? this.clock.now()) as CreateSiteInput["effectiveFrom"],
    };
    const site = Site.create(ctx.tenantId, input);
    await this.commit(site);

    for (const role of command.primaryForRoles ?? []) {
      await this.setPrimary(ctx, site.id, role);
    }
    return site;
  }

  async get(ctx: TenantContext, id: Ulid): Promise<Site> {
    const site = await this.sites.byId(ctx.tenantId, id);
    if (!site) throw new NotFoundError("Site", id);
    return site;
  }

  async list(
    ctx: TenantContext,
    filter: SiteFilter = {},
    page?: Partial<PageRequest>,
  ): Promise<Page<Site>> {
    return this.sites.list(ctx.tenantId, filter, normalizePage(page));
  }

  async forCustomer(ctx: TenantContext, customerId: Ulid): Promise<readonly Site[]> {
    return this.sites.forCustomer(ctx.tenantId, customerId);
  }

  async updateDetails(
    ctx: TenantContext,
    id: Ulid,
    patch: Parameters<Site["updateDetails"]>[0],
  ): Promise<Site> {
    const site = await this.get(ctx, id);
    if (patch.gln) {
      const verdict = validateGln(patch.gln);
      if (!verdict.valid) throw ValidationError.single("gln", verdict.reason ?? "invalid GLN");
    }
    if (patch.taxJurisdictionCode) {
      await this.assertTaxJurisdiction(ctx, patch.taxJurisdictionCode);
    }
    site.updateDetails(patch);
    await this.commit(site);
    return site;
  }

  async changeAddress(
    ctx: TenantContext,
    id: Ulid,
    address: AddressInput,
    effectiveFrom?: string,
    reason?: string,
  ): Promise<PostalAddress> {
    const site = await this.get(ctx, id);
    const updated = site.changeAddress(
      address,
      (effectiveFrom ?? this.clock.now()) as Parameters<Site["changeAddress"]>[1],
      reason,
    );
    await this.commit(site);
    return updated;
  }

  async setRoles(ctx: TenantContext, id: Ulid, roles: readonly SiteRole[]): Promise<Site> {
    const site = await this.get(ctx, id);
    site.setRoles(roles);
    await this.commit(site);
    return site;
  }

  /** Promotes a site to primary for a role, demoting the incumbent. */
  async setPrimary(ctx: TenantContext, id: Ulid, role: SiteRole): Promise<Site> {
    const site = await this.get(ctx, id);
    const siblings = await this.sites.forCustomer(ctx.tenantId, site.customerId);
    for (const sibling of siblings) {
      if (sibling.id !== site.id && sibling.isPrimaryFor(role)) {
        sibling.markPrimaryFor(role, false);
        await this.commit(sibling);
      }
    }
    site.markPrimaryFor(role, true);
    await this.commit(site);
    return site;
  }

  /** The customer's default site for a role, if one is designated. */
  async primaryFor(ctx: TenantContext, customerId: Ulid, role: SiteRole): Promise<Site | undefined> {
    const sites = await this.sites.forCustomer(ctx.tenantId, customerId);
    return sites.find((site) => site.active && site.isPrimaryFor(role));
  }

  /**
   * Resolves the site to use for a role: the designated primary, else the only
   * active candidate. Ambiguity is an error rather than an arbitrary pick.
   */
  async resolveForRole(ctx: TenantContext, customerId: Ulid, role: SiteRole): Promise<Site> {
    const primary = await this.primaryFor(ctx, customerId, role);
    if (primary) return primary;
    const candidates = (await this.sites.forCustomer(ctx.tenantId, customerId)).filter(
      (site) => site.active && site.hasRole(role),
    );
    if (candidates.length === 0) {
      throw new NotFoundError("Site", `${customerId}:${role}`);
    }
    if (candidates.length > 1) {
      throw new InvalidStateError(
        `Customer has ${candidates.length} active ${role} sites and no primary; designate one`,
      );
    }
    return candidates[0]!;
  }

  async deactivate(ctx: TenantContext, id: Ulid, reason: string): Promise<Site> {
    const site = await this.get(ctx, id);
    site.deactivate(reason);
    await this.commit(site);
    return site;
  }

  async reactivate(ctx: TenantContext, id: Ulid): Promise<Site> {
    const site = await this.get(ctx, id);
    site.reactivate();
    await this.commit(site);
    return site;
  }

  /** Active sites within a radius, nearest first; used for service routing. */
  async nearest(
    ctx: TenantContext,
    point: GeoPoint,
    options: { readonly radiusKm?: number; readonly role?: SiteRole; readonly limit?: number } = {},
  ): Promise<readonly NearbySite[]> {
    const radiusKm = options.radiusKm ?? 100;
    const limit = options.limit ?? 10;
    // Routing cares where the goods go today, so an announced relocation that
    // has not taken effect yet must not move a site on the map.
    const now = this.clock.now();
    return (await this.sites.all(ctx.tenantId))
      .filter((site) => site.active)
      .filter((site) => (options.role ? site.hasRole(options.role) : true))
      .flatMap((site) => {
        const coordinates = site.addressAt(now).coordinates;
        if (!coordinates) return [];
        const distanceKm = Math.round(haversineKm(point, coordinates) * 1000) / 1000;
        return distanceKm <= radiusKm ? [{ site, distanceKm }] : [];
      })
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, limit);
  }

  private async assertTaxJurisdiction(ctx: TenantContext, code: string): Promise<void> {
    try {
      await this.codeLists.validateCode(ctx, "tax_category", code);
    } catch (error) {
      if ((error as { code?: string }).code === "NOT_FOUND") return;
      throw error;
    }
  }

  private async commit(site: Site): Promise<void> {
    await this.sites.save(site);
    const events = site.pullEvents();
    if (events.length > 0) await this.outbox.publish(events);
  }
}
