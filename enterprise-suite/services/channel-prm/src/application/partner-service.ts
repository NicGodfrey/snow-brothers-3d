import {
  ConflictError,
  NotFoundError,
  normalizePage,
  type Page,
  type PageRequest,
  type TenantContext,
  type Ulid,
  type UserId,
} from "@enterprise-suite/shared-kernel";
import {
  Partner,
  validateTierPolicy,
  type CreatePartnerInput,
  type PartnerTier,
  type TierPolicy,
} from "../domain/partner.js";
import { PolicyViolationError } from "../domain/errors.js";
import { normalizeProductLine } from "../domain/territory.js";
import type { Clock, OutboxPort, PartnerFilter, PartnerRepository, TierPolicyRepository } from "./ports.js";
import { Publisher } from "./unit-of-work.js";

/**
 * Partner profiles and the tier policies that drive every channel decision.
 * Also the single place that answers "is this partner allowed to register this
 * deal", so the rule cannot drift between the registration flow, the referral
 * flow and special pricing.
 */
export class PartnerService {
  private readonly publisher: Publisher;

  constructor(
    private readonly partners: PartnerRepository,
    private readonly policies: TierPolicyRepository,
    outbox: OutboxPort,
    private readonly clock: Clock,
  ) {
    this.publisher = new Publisher(outbox);
  }

  async create(ctx: TenantContext, input: Omit<CreatePartnerInput, "channelManagerId"> & { channelManagerId?: UserId }): Promise<Partner> {
    const existing = await this.partners.byCode(ctx.tenantId, input.code);
    if (existing) throw new ConflictError(`Partner code ${input.code.toUpperCase()} is already in use`);
    const partner = Partner.create(ctx.tenantId, input);
    await this.partners.save(partner);
    await this.publisher.publish(partner);
    return partner;
  }

  async get(ctx: TenantContext, id: Ulid): Promise<Partner> {
    const partner = await this.partners.byId(ctx.tenantId, id);
    if (!partner) throw new NotFoundError("Partner", id);
    return partner;
  }

  async getByCode(ctx: TenantContext, code: string): Promise<Partner> {
    const partner = await this.partners.byCode(ctx.tenantId, code);
    if (!partner) throw new NotFoundError("Partner", code);
    return partner;
  }

  /** Resolves either an id or a partner code, whichever the caller has. */
  async resolve(ctx: TenantContext, idOrCode: string): Promise<Partner> {
    const byId = await this.partners.byId(ctx.tenantId, idOrCode as Ulid);
    if (byId) return byId;
    return this.getByCode(ctx, idOrCode);
  }

  async list(ctx: TenantContext, filter: PartnerFilter, page?: Partial<PageRequest>): Promise<Page<Partner>> {
    return this.partners.list(ctx.tenantId, filter, normalizePage(page));
  }

  async activate(ctx: TenantContext, id: Ulid): Promise<Partner> {
    const partner = await this.get(ctx, id);
    partner.activate(this.clock.now());
    return this.commit(partner);
  }

  async suspend(ctx: TenantContext, id: Ulid, reason: string): Promise<Partner> {
    const partner = await this.get(ctx, id);
    partner.suspend(reason, this.clock.now());
    return this.commit(partner);
  }

  async terminate(ctx: TenantContext, id: Ulid, reason: string): Promise<Partner> {
    const partner = await this.get(ctx, id);
    partner.terminate(reason, this.clock.now());
    return this.commit(partner);
  }

  async changeTier(ctx: TenantContext, id: Ulid, tier: PartnerTier, reason?: string): Promise<Partner> {
    const partner = await this.get(ctx, id);
    partner.changeTier(tier, this.clock.now(), reason);
    return this.commit(partner);
  }

  async setAuthorizations(
    ctx: TenantContext,
    id: Ulid,
    input: { territories?: readonly string[]; productLines?: readonly string[] },
  ): Promise<Partner> {
    const partner = await this.get(ctx, id);
    partner.setAuthorizations(input);
    return this.commit(partner);
  }

  async assignChannelManager(ctx: TenantContext, id: Ulid, userId: UserId): Promise<Partner> {
    const partner = await this.get(ctx, id);
    partner.assignChannelManager(userId);
    await this.partners.save(partner);
    return partner;
  }

  async policyFor(ctx: TenantContext, tier: PartnerTier): Promise<TierPolicy> {
    return this.policies.get(ctx.tenantId, tier);
  }

  async listPolicies(ctx: TenantContext): Promise<readonly TierPolicy[]> {
    return this.policies.all(ctx.tenantId);
  }

  async setPolicy(ctx: TenantContext, policy: TierPolicy): Promise<TierPolicy> {
    validateTierPolicy(policy);
    await this.policies.save(ctx.tenantId, policy);
    return policy;
  }

  /**
   * Central eligibility check: active partner, territory granted, product
   * lines authorized. Throws a PolicyViolationError naming the exact rule so
   * the portal can tell the partner what to fix.
   */
  assertCanRegister(partner: Partner, input: { country: string; productLines: readonly string[]; action?: string }): void {
    const action = input.action ?? "register deals";
    partner.assertActive(action);
    if (!partner.coversTerritory(input.country)) {
      throw new PolicyViolationError(
        `Partner ${partner.code} is not authorized in ${input.country.toUpperCase()} (grants: ${partner.territories.join(", ")})`,
        "partner.territory",
        { country: input.country.toUpperCase(), territories: partner.territories },
      );
    }
    const unauthorized = partner.unauthorizedProductLines(input.productLines);
    if (unauthorized.length > 0) {
      throw new PolicyViolationError(
        `Partner ${partner.code} is not authorized for product line(s): ${unauthorized.join(", ")}`,
        "partner.productLine",
        { unauthorized, authorized: partner.productLines },
      );
    }
  }

  /** Non-throwing variant used by the portal's pre-check endpoint. */
  eligibility(
    partner: Partner,
    input: { country: string; productLines: readonly string[] },
  ): { eligible: boolean; reasons: string[] } {
    const reasons: string[] = [];
    if (partner.status !== "active") reasons.push(`partner is ${partner.status}`);
    if (!partner.coversTerritory(input.country)) {
      reasons.push(`no territory grant covering ${input.country.toUpperCase()}`);
    }
    const unauthorized = input.productLines
      .map(normalizeProductLine)
      .filter((line) => !partner.productLines.includes(line));
    if (unauthorized.length > 0) reasons.push(`not authorized for ${unauthorized.join(", ")}`);
    return { eligible: reasons.length === 0, reasons };
  }

  private async commit(partner: Partner): Promise<Partner> {
    await this.partners.save(partner);
    await this.publisher.publish(partner);
    return partner;
  }
}
