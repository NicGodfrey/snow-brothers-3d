import { NotFoundError, type TenantContext, type Ulid } from "@enterprise-suite/shared-kernel";
import { resolveCategoryPolicy } from "../domain/category.js";
import type { DateOnly } from "../domain/dates.js";
import { assessEligibility, type EligibilityAssessment } from "../domain/eligibility.js";
import type { Scorecard } from "../domain/scorecard.js";
import type { Supplier } from "../domain/supplier.js";
import type {
  CategoryRepository,
  CertificationRepository,
  Clock,
  ContractRepository,
  QualificationRepository,
  RiskProfileRepository,
  ScorecardRepository,
  SupplierRepository,
} from "./ports.js";

export interface SupplierOverview {
  readonly supplier: Supplier;
  readonly riskTier?: string;
  readonly riskScore?: number;
  readonly activeHolds: number;
  readonly validCertifications: number;
  readonly expiringCertifications: number;
  readonly latestScorecard?: { periodCode: string; score?: number; rating?: string };
  readonly activeContracts: number;
  readonly openQualifications: number;
}

/**
 * Read side that answers the two questions everything else in procurement
 * hangs off: "what do I know about this supplier?" and "can I award them this
 * work today?".
 *
 * The rules themselves live in `domain/eligibility`; this service is the
 * loader that gathers the facts each aggregate owns and, for a panel review,
 * runs the same assessment across every approved supplier in a category.
 */
export class EligibilityService {
  constructor(
    private readonly suppliers: SupplierRepository,
    private readonly categories: CategoryRepository,
    private readonly qualifications: QualificationRepository,
    private readonly certifications: CertificationRepository,
    private readonly contracts: ContractRepository,
    private readonly scorecards: ScorecardRepository,
    private readonly riskProfiles: RiskProfileRepository,
    private readonly clock: Clock,
  ) {}

  async assess(
    ctx: TenantContext,
    supplierId: Ulid,
    options: { categoryId?: Ulid; asOf?: DateOnly } = {},
  ): Promise<EligibilityAssessment> {
    const supplier = await this.requireSupplier(ctx, supplierId);
    const asOf = options.asOf ?? this.clock.today();
    const policy = options.categoryId ? await this.policyFor(ctx, options.categoryId) : undefined;
    return assessEligibility({
      asOf,
      supplier,
      categoryId: options.categoryId,
      policy,
      qualifications: await this.qualifications.bySupplier(ctx.tenantId, supplier.id),
      certifications: await this.certifications.bySupplier(ctx.tenantId, supplier.id),
      riskProfile: await this.riskProfiles.bySupplier(ctx.tenantId, supplier.id),
      contracts: await this.contracts.bySupplier(ctx.tenantId, supplier.id),
      latestScorecard: await this.latestScorecard(ctx, supplier.id),
    });
  }

  /** Panel review: every supplier assigned to a category, assessed at once. */
  async assessCategoryPanel(
    ctx: TenantContext,
    categoryId: Ulid,
    options: { asOf?: DateOnly; eligibleOnly?: boolean } = {},
  ): Promise<readonly EligibilityAssessment[]> {
    const suppliers = await this.suppliers.all(ctx.tenantId);
    const assessments: EligibilityAssessment[] = [];
    for (const supplier of suppliers) {
      if (!supplier.categoryAssignment(categoryId)) continue;
      const assessment = await this.assess(ctx, supplier.id, { categoryId, asOf: options.asOf });
      if (options.eligibleOnly && !assessment.eligible) continue;
      assessments.push(assessment);
    }
    return assessments.sort(
      (a, b) => Number(b.eligible) - Number(a.eligible) || a.supplierCode.localeCompare(b.supplierCode),
    );
  }

  /** Compact 360° view for a supplier detail screen. */
  async overview(ctx: TenantContext, supplierId: Ulid): Promise<SupplierOverview> {
    const supplier = await this.requireSupplier(ctx, supplierId);
    const asOf = this.clock.today();
    const certifications = await this.certifications.bySupplier(ctx.tenantId, supplier.id);
    const contracts = await this.contracts.bySupplier(ctx.tenantId, supplier.id);
    const qualifications = await this.qualifications.bySupplier(ctx.tenantId, supplier.id);
    const profile = await this.riskProfiles.bySupplier(ctx.tenantId, supplier.id);
    const latest = await this.latestScorecard(ctx, supplier.id);
    return {
      supplier,
      riskTier: profile?.tier,
      riskScore: profile?.score,
      activeHolds: profile?.activeHolds().length ?? 0,
      validCertifications: certifications.filter(
        (certification) => certification.status === "valid" && certification.isEffectiveOn(asOf),
      ).length,
      expiringCertifications: certifications.filter(
        (certification) => certification.status === "valid" && certification.expiryStateOn(asOf) === "expiring",
      ).length,
      latestScorecard: latest
        ? { periodCode: latest.periodCode, score: latest.score, rating: latest.rating }
        : undefined,
      activeContracts: contracts.filter((contract) => contract.isEffectiveOn(asOf)).length,
      openQualifications: qualifications.filter(
        (qualification) => qualification.status === "planned" || qualification.status === "in_progress",
      ).length,
    };
  }

  private async latestScorecard(ctx: TenantContext, supplierId: Ulid): Promise<Scorecard | undefined> {
    const all = await this.scorecards.bySupplier(ctx.tenantId, supplierId);
    return [...all]
      .filter((scorecard) => scorecard.status === "published" || scorecard.status === "closed")
      .sort((a, b) => b.periodCode.localeCompare(a.periodCode))[0];
  }

  private async policyFor(ctx: TenantContext, categoryId: Ulid) {
    const categories = await this.categories.all(ctx.tenantId);
    const policy = resolveCategoryPolicy(new Map(categories.map((entry) => [entry.id, entry])), categoryId);
    if (!policy) throw new NotFoundError("Category", categoryId);
    return policy;
  }

  private async requireSupplier(ctx: TenantContext, supplierId: Ulid): Promise<Supplier> {
    const supplier = await this.suppliers.byId(ctx.tenantId, supplierId);
    if (!supplier) throw new NotFoundError("Supplier", supplierId);
    return supplier;
  }
}
