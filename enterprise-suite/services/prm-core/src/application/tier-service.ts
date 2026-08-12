import {
  ConflictError,
  NotFoundError,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { summarizeCertifications } from "../domain/certification.js";
import { TRADING_CONTRACT_TYPES } from "../domain/contract.js";
import { monthsBetween } from "../domain/dates.js";
import { InvalidStateError, TierEligibilityError, ValidationError } from "../domain/errors.js";
import type { Partner } from "../domain/partner.js";
import { trailingPerformance } from "../domain/performance.js";
import {
  STANDARD_TIERS,
  createTierDefinition,
  evaluateTier,
  type CreateTierInput,
  type TierBenefits,
  type TierDefinition,
  type TierEvaluation,
  type TierEvaluationInput,
} from "../domain/tier.js";
import type {
  CertificationRepository,
  Clock,
  ContractRepository,
  OutboxPort,
  PartnerRepository,
  PerformanceRepository,
  TierDefinitionRepository,
} from "./ports.js";

export interface AssignTierCommand {
  readonly tierCode: string;
  readonly reason: string;
  /** Grant a tier the partner has not earned (strategic exception). */
  readonly override?: boolean;
}

export interface TierReview {
  readonly partnerId: Ulid;
  readonly partnerNumber: string;
  readonly evaluation: TierEvaluation;
  readonly applied: boolean;
  readonly appliedTierCode?: string;
  readonly skippedReason?: string;
}

/**
 * Tier program administration and evaluation.
 *
 * Evaluation gathers facts from three other contexts — trailing performance,
 * live certifications, contract state — and runs them through the pure tier
 * engine. Assignment then either respects that verdict or records an explicit,
 * reasoned override, so every tier a partner holds is traceable to either
 * measured facts or a named human decision.
 */
export class TierService {
  constructor(
    private readonly tiers: TierDefinitionRepository,
    private readonly partners: PartnerRepository,
    private readonly contracts: ContractRepository,
    private readonly performance: PerformanceRepository,
    private readonly certifications: CertificationRepository,
    private readonly outbox: OutboxPort,
    private readonly clock: Clock,
  ) {}

  async createTier(ctx: TenantContext, input: CreateTierInput): Promise<TierDefinition> {
    const existing = await this.tiers.byCode(ctx.tenantId, input.code);
    if (existing) throw new ConflictError(`Tier "${existing.code}" already exists`);
    const sameRank = await this.tiers.byRank(ctx.tenantId, input.rank);
    if (sameRank) {
      throw new ConflictError(`Rank ${input.rank} is already used by tier "${sameRank.code}"`);
    }
    const definition = createTierDefinition(ctx.tenantId, input);
    await this.tiers.save(definition);
    return definition;
  }

  /** Installs the reference program; already-present tiers are left alone. */
  async installStandardProgram(ctx: TenantContext): Promise<readonly TierDefinition[]> {
    const installed: TierDefinition[] = [];
    for (const input of STANDARD_TIERS) {
      const existing = await this.tiers.byCode(ctx.tenantId, input.code);
      if (existing) {
        installed.push(existing);
        continue;
      }
      const definition = createTierDefinition(ctx.tenantId, input);
      await this.tiers.save(definition);
      installed.push(definition);
    }
    return installed;
  }

  async list(ctx: TenantContext): Promise<readonly TierDefinition[]> {
    return [...(await this.tiers.all(ctx.tenantId))].sort((a, b) => a.rank - b.rank);
  }

  async getByCode(ctx: TenantContext, code: string): Promise<TierDefinition> {
    const definition = await this.tiers.byCode(ctx.tenantId, code);
    if (!definition) throw new NotFoundError("TierDefinition", code);
    return definition;
  }

  /** Collects the measured facts a tier decision is based on. */
  async facts(ctx: TenantContext, partnerId: Ulid): Promise<TierEvaluationInput> {
    const partner = await this.requirePartner(ctx, partnerId);
    const now = this.clock.now();
    const snapshots = await this.performance.byPartner(ctx.tenantId, partner.id);
    const trailing = trailingPerformance(snapshots, now, partner.currency, 12);
    const certificationSummary = summarizeCertifications(
      partner.id,
      await this.certifications.byPartner(ctx.tenantId, partner.id),
      now,
    );
    const contracts = await this.contracts.byPartner(ctx.tenantId, partner.id);
    return {
      trailingRevenue: trailing.bookedRevenue,
      certifiedIndividuals: certificationSummary.certifiedIndividuals,
      heldCertificationCodes: certificationSummary.activeCertificationCodes,
      dealsWon: trailing.dealsWon,
      monthsActive: partner.activatedAt ? Math.max(0, monthsBetween(partner.activatedAt, now)) : 0,
      hasActiveContract: contracts.some(
        (c) => TRADING_CONTRACT_TYPES.includes(c.type) && c.isEffectiveAt(now),
      ),
      currentTierCode: partner.tierCode,
    };
  }

  async evaluate(ctx: TenantContext, partnerId: Ulid): Promise<TierEvaluation> {
    const definitions = await this.tiers.all(ctx.tenantId);
    if (definitions.length === 0) {
      throw new InvalidStateError("No tier program is configured for this tenant");
    }
    return evaluateTier(definitions, await this.facts(ctx, partnerId));
  }

  /**
   * Assigns a tier. Without `override` the partner must qualify; with it, the
   * reason is mandatory and the assignment is still recorded in tier history.
   */
  async assign(ctx: TenantContext, partnerId: Ulid, command: AssignTierCommand): Promise<Partner> {
    const partner = await this.requirePartner(ctx, partnerId);
    const definition = await this.getByCode(ctx, command.tierCode);
    if (!definition.active) throw new InvalidStateError(`Tier ${definition.code} is not active`);
    if (!command.override) {
      const evaluation = await this.evaluate(ctx, partnerId);
      const qualification = evaluation.qualifications.find((q) => q.tierCode === definition.code);
      if (!qualification || !qualification.qualifies) {
        throw new TierEligibilityError(definition.code, qualification?.gaps ?? []);
      }
    } else if (command.reason.trim().length < 10) {
      throw ValidationError.single("reason", "an override needs a substantive reason (10+ characters)");
    }
    partner.assignTier({
      tierCode: definition.code,
      rank: definition.rank,
      reason: command.override ? `[override] ${command.reason.trim()}` : command.reason,
      effectiveAt: this.clock.now(),
      assignedBy: ctx.userId,
    });
    await this.commit(partner);
    return partner;
  }

  /**
   * Moves a partner to the tier it currently qualifies for. Upgrades apply
   * automatically; downgrades only when explicitly allowed, because programs
   * usually demote at renewal rather than the moment a number dips.
   */
  async autoAssign(
    ctx: TenantContext,
    partnerId: Ulid,
    options: { readonly allowDowngrade?: boolean } = {},
  ): Promise<TierReview> {
    const partner = await this.requirePartner(ctx, partnerId);
    const evaluation = await this.evaluate(ctx, partnerId);
    const target = evaluation.eligibleTierCode;
    if (!target) {
      return {
        partnerId: partner.id,
        partnerNumber: partner.number,
        evaluation,
        applied: false,
        skippedReason: "partner does not qualify for any tier",
      };
    }
    if (target === partner.tierCode) {
      return {
        partnerId: partner.id,
        partnerNumber: partner.number,
        evaluation,
        applied: false,
        skippedReason: "already in the correct tier",
      };
    }
    if (evaluation.recommendation === "downgrade" && !options.allowDowngrade) {
      return {
        partnerId: partner.id,
        partnerNumber: partner.number,
        evaluation,
        applied: false,
        skippedReason: "downgrade suppressed",
      };
    }
    const definition = await this.getByCode(ctx, target);
    partner.assignTier({
      tierCode: definition.code,
      rank: definition.rank,
      reason: `automatic ${evaluation.recommendation} from the tier review`,
      effectiveAt: this.clock.now(),
      assignedBy: ctx.userId,
    });
    await this.commit(partner);
    return {
      partnerId: partner.id,
      partnerNumber: partner.number,
      evaluation,
      applied: true,
      appliedTierCode: definition.code,
    };
  }

  /** Program-wide review, e.g. the quarterly tiering job. */
  async reviewAll(
    ctx: TenantContext,
    options: { readonly allowDowngrade?: boolean } = {},
  ): Promise<readonly TierReview[]> {
    const partners = await this.partners.all(ctx.tenantId);
    const reviews: TierReview[] = [];
    for (const partner of partners) {
      if (partner.status !== "active") continue;
      reviews.push(await this.autoAssign(ctx, partner.id, options));
    }
    return reviews;
  }

  async benefitsFor(ctx: TenantContext, partnerId: Ulid): Promise<TierBenefits | undefined> {
    const partner = await this.requirePartner(ctx, partnerId);
    if (!partner.tierCode) return undefined;
    const definition = await this.tiers.byCode(ctx.tenantId, partner.tierCode);
    return definition?.benefits;
  }

  private async requirePartner(ctx: TenantContext, partnerId: Ulid): Promise<Partner> {
    const partner = await this.partners.byId(ctx.tenantId, partnerId);
    if (!partner) throw new NotFoundError("Partner", partnerId);
    return partner;
  }

  private async commit(partner: Partner): Promise<void> {
    await this.partners.save(partner);
    await this.outbox.publish(partner.pullEvents());
  }
}
