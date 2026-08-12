import { NotFoundError, type TenantContext, type Ulid } from "@enterprise-suite/shared-kernel";
import { ComplianceBlockedError } from "../domain/errors.js";
import {
  SupplierRiskProfile,
  type ComplianceHold,
  type HoldType,
  type PlaceHoldInput,
  type RaiseFlagInput,
  type RiskFlag,
  type RiskTier,
} from "../domain/risk.js";
import type { Supplier } from "../domain/supplier.js";
import type { Clock, OutboxPort, RiskProfileRepository, SupplierRepository } from "./ports.js";

export interface RiskHeatmapEntry {
  readonly supplierId: Ulid;
  readonly supplierCode: string;
  readonly tier: RiskTier;
  readonly score: number;
  readonly openFlags: number;
  readonly activeHolds: number;
  readonly topRisk?: string;
}

export interface ClearanceResult {
  readonly supplierId: Ulid;
  readonly supplierCode: string;
  readonly activity: HoldType;
  readonly cleared: boolean;
  readonly holds: readonly ComplianceHold[];
}

/**
 * Risk register and compliance holds.
 *
 * Holds are what other bounded contexts actually call into: procurement asks
 * `clear(supplier, "purchase_order")` before issuing a PO and finance asks the
 * same for "payment". `assertClear` turns a live hold into a 409 with the
 * hold ids attached, so the caller can show the buyer exactly which control
 * stopped them and who can lift it.
 */
export class RiskService {
  constructor(
    private readonly riskProfiles: RiskProfileRepository,
    private readonly suppliers: SupplierRepository,
    private readonly outbox: OutboxPort,
    private readonly clock: Clock,
  ) {}

  async profile(ctx: TenantContext, supplierId: Ulid): Promise<SupplierRiskProfile> {
    const existing = await this.riskProfiles.bySupplier(ctx.tenantId, supplierId);
    if (existing) return existing;
    const supplier = await this.requireSupplier(ctx, supplierId);
    const created = SupplierRiskProfile.create(ctx.tenantId, supplier.id, supplier.code);
    await this.riskProfiles.save(created);
    return created;
  }

  // --- risk flags ----------------------------------------------------------

  async raiseFlag(ctx: TenantContext, supplierId: Ulid, input: RaiseFlagInput): Promise<RiskFlag> {
    const profile = await this.profile(ctx, supplierId);
    const flag = profile.raiseFlag(input, this.clock.now());
    await this.commit(profile);
    return flag;
  }

  async mitigateFlag(
    ctx: TenantContext,
    supplierId: Ulid,
    flagId: Ulid,
    input: Parameters<SupplierRiskProfile["mitigateFlag"]>[1],
  ): Promise<RiskFlag> {
    const profile = await this.profile(ctx, supplierId);
    const flag = profile.mitigateFlag(flagId, input, this.clock.now());
    await this.commit(profile);
    return flag;
  }

  async acceptFlag(ctx: TenantContext, supplierId: Ulid, flagId: Ulid, reason: string): Promise<RiskFlag> {
    const profile = await this.profile(ctx, supplierId);
    const flag = profile.acceptFlag(flagId, ctx.userId, reason, this.clock.now());
    await this.commit(profile);
    return flag;
  }

  async closeFlag(ctx: TenantContext, supplierId: Ulid, flagId: Ulid, reason: string): Promise<RiskFlag> {
    const profile = await this.profile(ctx, supplierId);
    const flag = profile.closeFlag(flagId, reason, this.clock.today(), this.clock.now());
    await this.commit(profile);
    return flag;
  }

  /** Open flags whose review date has arrived, oldest first. */
  async reviewQueue(ctx: TenantContext): Promise<readonly { supplierCode: string; flag: RiskFlag }[]> {
    const asOf = this.clock.today();
    const queue: { supplierCode: string; flag: RiskFlag }[] = [];
    for (const profile of await this.riskProfiles.all(ctx.tenantId)) {
      for (const flag of profile.flagsDueForReview(asOf)) {
        queue.push({ supplierCode: profile.supplierCode, flag });
      }
    }
    return queue.sort((a, b) => (a.flag.reviewDueOn ?? "").localeCompare(b.flag.reviewDueOn ?? ""));
  }

  // --- compliance holds ----------------------------------------------------

  async placeHold(ctx: TenantContext, supplierId: Ulid, input: Omit<PlaceHoldInput, "placedOn">): Promise<ComplianceHold> {
    const profile = await this.profile(ctx, supplierId);
    const hold = profile.placeHold({ ...input, placedOn: this.clock.today() }, ctx.userId, this.clock.now());
    await this.commit(profile);
    return hold;
  }

  async releaseHold(ctx: TenantContext, supplierId: Ulid, holdId: Ulid, reason: string): Promise<ComplianceHold> {
    const profile = await this.profile(ctx, supplierId);
    const hold = profile.releaseHold(holdId, ctx.userId, ctx.roles, reason, this.clock.today());
    await this.commit(profile);
    return hold;
  }

  async holds(ctx: TenantContext, supplierId: Ulid): Promise<readonly ComplianceHold[]> {
    return (await this.profile(ctx, supplierId)).holds;
  }

  /** Non-throwing check other contexts can render in a UI. */
  async clearance(
    ctx: TenantContext,
    supplierId: Ulid,
    activity: HoldType,
    scope: { categoryId?: Ulid; siteId?: Ulid } = {},
  ): Promise<ClearanceResult> {
    const profile = await this.profile(ctx, supplierId);
    const holds = profile.blockingHolds(activity, scope);
    return {
      supplierId: profile.supplierId,
      supplierCode: profile.supplierCode,
      activity,
      cleared: holds.length === 0,
      holds,
    };
  }

  /** Throwing variant for command paths: raises a 409 with the hold ids. */
  async assertClear(
    ctx: TenantContext,
    supplierId: Ulid,
    activity: HoldType,
    scope: { categoryId?: Ulid; siteId?: Ulid } = {},
  ): Promise<void> {
    const result = await this.clearance(ctx, supplierId, activity, scope);
    if (!result.cleared) {
      throw new ComplianceBlockedError(
        `${result.supplierCode} is on ${activity} hold`,
        result.holds.map((hold) => hold.id),
        { reasonCodes: result.holds.map((hold) => hold.reasonCode) },
      );
    }
  }

  // --- portfolio view ------------------------------------------------------

  async heatmap(ctx: TenantContext, minimumTier: RiskTier = "low"): Promise<readonly RiskHeatmapEntry[]> {
    const order: readonly RiskTier[] = ["low", "medium", "high", "critical"];
    const floor = order.indexOf(minimumTier);
    const profiles = await this.riskProfiles.all(ctx.tenantId);
    return profiles
      .filter((profile) => order.indexOf(profile.tier) >= floor)
      .map((profile) => {
        const worst = [...profile.openFlags()].sort(
          (a, b) => (b.residualScore ?? b.inherentScore) - (a.residualScore ?? a.inherentScore),
        )[0];
        return {
          supplierId: profile.supplierId,
          supplierCode: profile.supplierCode,
          tier: profile.tier,
          score: profile.score,
          openFlags: profile.openFlags().length,
          activeHolds: profile.activeHolds().length,
          topRisk: worst?.title,
        };
      })
      .sort((a, b) => b.score - a.score || a.supplierCode.localeCompare(b.supplierCode));
  }

  private async requireSupplier(ctx: TenantContext, supplierId: Ulid): Promise<Supplier> {
    const supplier = await this.suppliers.byId(ctx.tenantId, supplierId);
    if (!supplier) throw new NotFoundError("Supplier", supplierId);
    return supplier;
  }

  private async commit(profile: SupplierRiskProfile): Promise<void> {
    await this.riskProfiles.save(profile);
    await this.outbox.publish(profile.pullEvents());
  }
}
