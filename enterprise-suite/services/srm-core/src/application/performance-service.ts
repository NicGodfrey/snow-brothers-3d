import {
  newId,
  NotFoundError,
  normalizePage,
  type Page,
  type PageRequest,
  type TenantContext,
  type Ulid,
  type UserId,
} from "@enterprise-suite/shared-kernel";
import { addMonths, type DateOnly } from "../domain/dates.js";
import { slug } from "../domain/common.js";
import { InvalidStateError, ValidationError } from "../domain/errors.js";
import {
  assertKpiBounds,
  KPI_CATEGORIES,
  KPI_SOURCES,
  KPI_UNITS,
  scoreKpi,
  STANDARD_KPIS,
  type KpiBand,
  type KpiCategory,
  type KpiDefinitionRecord,
  type KpiDirection,
  type KpiSource,
  type KpiUnit,
} from "../domain/kpi.js";
import { parsePeriod, previousPeriod, trailingPeriods, type PerformancePeriod } from "../domain/period.js";
import { SupplierRiskProfile } from "../domain/risk.js";
import {
  requiresImprovementPlan,
  Scorecard,
  type ImprovementAction,
  type ScorecardMeasurement,
  type SupplierRating,
} from "../domain/scorecard.js";
import { SLA_METRIC_SPECS, type SlaBreach } from "../domain/sla.js";
import type { Supplier } from "../domain/supplier.js";
import type {
  Clock,
  ContractRepository,
  KpiDefinitionRepository,
  OutboxPort,
  RiskProfileRepository,
  ScorecardFilter,
  ScorecardRepository,
  SupplierRepository,
} from "./ports.js";

export interface CreateKpiCommand {
  readonly code: string;
  readonly name: string;
  readonly category: KpiCategory;
  readonly unit: KpiUnit;
  readonly direction: KpiDirection;
  readonly target: number;
  readonly floor: number;
  readonly weight: number;
  readonly description?: string;
  readonly mandatory?: boolean;
  readonly source?: KpiSource;
  readonly greenScore?: number;
  readonly amberScore?: number;
}

export interface PublishResult {
  readonly scorecard: Scorecard;
  readonly score: number;
  readonly rating: SupplierRating;
  /** SLA breaches derived from the published measurements. */
  readonly slaBreaches: readonly SlaBreach[];
}

export interface TrendPoint {
  readonly periodCode: string;
  readonly score?: number;
  readonly rating?: SupplierRating;
  readonly status: string;
}

export interface RankingEntry {
  readonly supplierId: Ulid;
  readonly supplierCode: string;
  readonly score: number;
  readonly rating: SupplierRating;
  readonly delta?: number;
}

/**
 * Supplier performance management: KPI definitions, periodic scorecards,
 * trends and the automatic link into contractual service levels.
 *
 * Publishing a scorecard is the hinge. It freezes the period result, and then
 * the same measured numbers are pushed through the SLA commitments of the
 * supplier's active contracts — an on-time-delivery KPI of 91% against a
 * contractual 95% commitment produces a breach with a computed credit without
 * anyone re-keying it. A probation rating additionally raises a risk flag and
 * holds sourcing until the improvement plan is worked off.
 */
export class PerformanceService {
  constructor(
    private readonly scorecards: ScorecardRepository,
    private readonly kpis: KpiDefinitionRepository,
    private readonly suppliers: SupplierRepository,
    private readonly contracts: ContractRepository,
    private readonly riskProfiles: RiskProfileRepository,
    private readonly outbox: OutboxPort,
    private readonly clock: Clock,
  ) {}

  // --- KPI definitions -----------------------------------------------------

  async createKpi(ctx: TenantContext, command: CreateKpiCommand): Promise<KpiDefinitionRecord> {
    const code = slug(command.code, "code");
    if (await this.kpis.byCode(ctx.tenantId, code)) {
      throw new InvalidStateError(`KPI ${code} already exists`);
    }
    if (!KPI_CATEGORIES.includes(command.category)) {
      throw ValidationError.single("category", `must be one of [${KPI_CATEGORIES.join(", ")}]`);
    }
    if (!KPI_UNITS.includes(command.unit)) {
      throw ValidationError.single("unit", `must be one of [${KPI_UNITS.join(", ")}]`);
    }
    const source = command.source ?? "manual";
    if (!KPI_SOURCES.includes(source)) {
      throw ValidationError.single("source", `must be one of [${KPI_SOURCES.join(", ")}]`);
    }
    const now = this.clock.now();
    const record: KpiDefinitionRecord = {
      id: newId("kpi"),
      tenantId: ctx.tenantId,
      code,
      name: command.name.trim(),
      description: command.description?.trim() || undefined,
      category: command.category,
      unit: command.unit,
      direction: command.direction,
      target: command.target,
      floor: command.floor,
      weight: command.weight,
      mandatory: command.mandatory ?? false,
      source,
      greenScore: command.greenScore ?? 85,
      amberScore: command.amberScore ?? 70,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    assertKpiBounds(record);
    await this.kpis.save(record);
    return record;
  }

  async updateKpi(
    ctx: TenantContext,
    code: string,
    patch: Partial<Omit<CreateKpiCommand, "code">> & { isActive?: boolean },
  ): Promise<KpiDefinitionRecord> {
    const current = await this.requireKpi(ctx, code);
    const updated: KpiDefinitionRecord = {
      ...current,
      name: patch.name?.trim() ?? current.name,
      description: patch.description?.trim() ?? current.description,
      category: patch.category ?? current.category,
      unit: patch.unit ?? current.unit,
      direction: patch.direction ?? current.direction,
      target: patch.target ?? current.target,
      floor: patch.floor ?? current.floor,
      weight: patch.weight ?? current.weight,
      mandatory: patch.mandatory ?? current.mandatory,
      source: patch.source ?? current.source,
      greenScore: patch.greenScore ?? current.greenScore,
      amberScore: patch.amberScore ?? current.amberScore,
      isActive: patch.isActive ?? current.isActive,
      updatedAt: this.clock.now(),
    };
    assertKpiBounds(updated);
    await this.kpis.save(updated);
    return updated;
  }

  async listKpis(ctx: TenantContext): Promise<readonly KpiDefinitionRecord[]> {
    const all = await this.kpis.all(ctx.tenantId);
    return [...all].sort((a, b) => b.weight - a.weight || a.code.localeCompare(b.code));
  }

  /** Installs the standard KPI catalog for a fresh tenant. */
  async seedStandardKpis(ctx: TenantContext): Promise<readonly KpiDefinitionRecord[]> {
    const created: KpiDefinitionRecord[] = [];
    for (const standard of STANDARD_KPIS) {
      if (await this.kpis.byCode(ctx.tenantId, standard.code)) continue;
      created.push(await this.createKpi(ctx, standard));
    }
    return created;
  }

  // --- scorecards ----------------------------------------------------------

  async openScorecard(ctx: TenantContext, supplierId: Ulid, periodCode: string): Promise<Scorecard> {
    const supplier = await this.requireSupplier(ctx, supplierId);
    const period = parsePeriod(periodCode);
    const existing = await this.scorecards.bySupplierPeriod(ctx.tenantId, supplierId, period.code);
    if (existing) {
      throw new InvalidStateError(`Scorecard ${supplier.code}/${period.code} already exists`, {
        scorecardId: existing.id,
      });
    }
    const previous = await this.scorecards.bySupplierPeriod(ctx.tenantId, supplierId, previousPeriod(period).code);
    const scorecard = Scorecard.open(ctx.tenantId, {
      supplierId: supplier.id,
      supplierCode: supplier.code,
      period,
      previousScore: previous?.score,
    });
    await this.commit(scorecard);
    return scorecard;
  }

  async getScorecard(ctx: TenantContext, id: Ulid): Promise<Scorecard> {
    const scorecard = await this.scorecards.byId(ctx.tenantId, id);
    if (!scorecard) throw new NotFoundError("Scorecard", id);
    return scorecard;
  }

  async listScorecards(ctx: TenantContext, filter: ScorecardFilter, page?: Partial<PageRequest>): Promise<Page<Scorecard>> {
    return this.scorecards.list(ctx.tenantId, filter, normalizePage(page));
  }

  /**
   * Records a raw measurement. The KPI definition supplies the scoring
   * function, and its weight/target/band are snapshotted onto the measurement
   * so a later re-tuning of the definition cannot rewrite a published period.
   */
  async recordMeasurement(
    ctx: TenantContext,
    scorecardId: Ulid,
    input: { kpiCode: string; value: number; note?: string; source?: string },
  ): Promise<ScorecardMeasurement> {
    const scorecard = await this.getScorecard(ctx, scorecardId);
    const definition = await this.requireKpi(ctx, input.kpiCode);
    if (!definition.isActive) {
      throw new InvalidStateError(`KPI ${definition.code} is retired and cannot be measured`);
    }
    const scored = scoreKpi(definition, input.value);
    const measurement = scorecard.recordMeasurement(
      {
        kpiCode: definition.code,
        kpiName: definition.name,
        value: input.value,
        score: scored.score,
        band: scored.band,
        weight: definition.weight,
        target: definition.target,
        unit: definition.unit,
        mandatory: definition.mandatory,
        source: input.source ?? definition.source,
        note: input.note,
      },
      ctx.userId,
      this.clock.now(),
    );
    await this.commit(scorecard);
    return measurement;
  }

  async submitForReview(ctx: TenantContext, scorecardId: Ulid, note?: string): Promise<Scorecard> {
    const scorecard = await this.getScorecard(ctx, scorecardId);
    scorecard.submitForReview(note);
    await this.commit(scorecard);
    return scorecard;
  }

  async publish(ctx: TenantContext, scorecardId: Ulid): Promise<PublishResult> {
    const scorecard = await this.getScorecard(ctx, scorecardId);
    const definitions = await this.kpis.active(ctx.tenantId);
    const mandatory = definitions.filter((definition) => definition.mandatory).map((definition) => definition.code);
    const { score, rating } = scorecard.publish(ctx.userId, this.clock.now(), this.clock.today(), mandatory);
    await this.commit(scorecard);

    const slaBreaches = await this.evaluateContractualSlas(ctx, scorecard);
    if (requiresImprovementPlan(rating)) await this.escalatePoorPerformance(ctx, scorecard, rating);
    return { scorecard, score, rating, slaBreaches };
  }

  async raiseDispute(ctx: TenantContext, scorecardId: Ulid, reason: string): Promise<Scorecard> {
    const scorecard = await this.getScorecard(ctx, scorecardId);
    scorecard.raiseDispute(ctx.userId, reason, this.clock.now(), this.clock.today());
    await this.commit(scorecard);
    return scorecard;
  }

  /** Resolves a dispute, re-scoring any KPI whose raw value was corrected. */
  async resolveDispute(
    ctx: TenantContext,
    scorecardId: Ulid,
    resolution: string,
    corrections: readonly { kpiCode: string; value: number; reason: string }[] = [],
  ): Promise<Scorecard> {
    const scorecard = await this.getScorecard(ctx, scorecardId);
    const adjustments: { kpiCode: string; value: number; score: number; band: KpiBand; reason: string }[] = [];
    for (const correction of corrections) {
      const definition = await this.requireKpi(ctx, correction.kpiCode);
      const scored = scoreKpi(definition, correction.value);
      adjustments.push({
        kpiCode: definition.code,
        value: correction.value,
        score: scored.score,
        band: scored.band,
        reason: correction.reason,
      });
    }
    scorecard.resolveDispute(ctx.userId, this.clock.now(), resolution, adjustments);
    await this.commit(scorecard);
    return scorecard;
  }

  async addImprovementAction(
    ctx: TenantContext,
    scorecardId: Ulid,
    input: { title: string; dueOn: DateOnly; kpiCode?: string; ownerId?: UserId },
  ): Promise<ImprovementAction> {
    const scorecard = await this.getScorecard(ctx, scorecardId);
    const action = scorecard.addImprovementAction(
      {
        title: input.title,
        ownerId: input.ownerId ?? ctx.userId,
        dueOn: input.dueOn,
        kpiCode: input.kpiCode,
      },
      this.clock.now(),
    );
    await this.commit(scorecard);
    return action;
  }

  async completeImprovementAction(
    ctx: TenantContext,
    scorecardId: Ulid,
    actionId: Ulid,
    outcome: string,
  ): Promise<ImprovementAction> {
    const scorecard = await this.getScorecard(ctx, scorecardId);
    const action = scorecard.completeAction(actionId, this.clock.now(), outcome);
    await this.commit(scorecard);
    return action;
  }

  /** Closing the period lifts the probation hold it created, if any. */
  async closeScorecard(ctx: TenantContext, scorecardId: Ulid): Promise<Scorecard> {
    const scorecard = await this.getScorecard(ctx, scorecardId);
    scorecard.close(this.clock.now());
    await this.commit(scorecard);
    const profile = await this.riskProfiles.bySupplier(ctx.tenantId, scorecard.supplierId);
    if (profile) {
      const released = profile.releaseHoldsBySourceRef(
        `scorecard:${scorecard.id}`,
        ctx.userId,
        `Improvement plan for ${scorecard.periodCode} completed`,
        this.clock.today(),
      );
      if (released.length > 0) await this.commitProfile(profile);
    }
    return scorecard;
  }

  // --- analytics -----------------------------------------------------------

  async trend(ctx: TenantContext, supplierId: Ulid, periodCode: string, count = 4): Promise<readonly TrendPoint[]> {
    const period = parsePeriod(periodCode);
    const points: TrendPoint[] = [];
    for (const entry of trailingPeriods(period, count)) {
      const scorecard = await this.scorecards.bySupplierPeriod(ctx.tenantId, supplierId, entry.code);
      points.push({
        periodCode: entry.code,
        score: scorecard?.score,
        rating: scorecard?.rating,
        status: scorecard?.status ?? "missing",
      });
    }
    return points;
  }

  /** League table for a period, optionally limited to one category panel. */
  async ranking(ctx: TenantContext, periodCode: string, categoryId?: Ulid): Promise<readonly RankingEntry[]> {
    const period = parsePeriod(periodCode);
    const all = await this.scorecards.all(ctx.tenantId);
    const entries: RankingEntry[] = [];
    for (const scorecard of all) {
      if (scorecard.periodCode !== period.code) continue;
      if (scorecard.score === undefined || scorecard.rating === undefined) continue;
      if (categoryId) {
        const supplier = await this.suppliers.byId(ctx.tenantId, scorecard.supplierId);
        if (!supplier?.approvedCategoryIds().includes(categoryId)) continue;
      }
      entries.push({
        supplierId: scorecard.supplierId,
        supplierCode: scorecard.supplierCode,
        score: scorecard.score,
        rating: scorecard.rating,
        delta: scorecard.delta(),
      });
    }
    return entries.sort((a, b) => b.score - a.score || a.supplierCode.localeCompare(b.supplierCode));
  }

  /** Suppliers with no scorecard for a closed period — the reporting gap. */
  async missingScorecards(ctx: TenantContext, periodCode: string): Promise<readonly string[]> {
    const period: PerformancePeriod = parsePeriod(periodCode);
    const suppliers = await this.suppliers.all(ctx.tenantId);
    const missing: string[] = [];
    for (const supplier of suppliers) {
      if (supplier.status !== "active") continue;
      const scorecard = await this.scorecards.bySupplierPeriod(ctx.tenantId, supplier.id, period.code);
      if (!scorecard) missing.push(supplier.code);
    }
    return missing.sort();
  }

  // --- internals -----------------------------------------------------------

  /**
   * Feeds published KPI values into the SLA commitments of the supplier's
   * active contracts. Only commitments whose metric maps to a measured KPI
   * participate; a commitment already recorded for the period is skipped so
   * re-publishing after a dispute cannot double-charge credits.
   */
  private async evaluateContractualSlas(ctx: TenantContext, scorecard: Scorecard): Promise<readonly SlaBreach[]> {
    const contracts = await this.contracts.bySupplier(ctx.tenantId, scorecard.supplierId);
    const breaches: SlaBreach[] = [];
    for (const contract of contracts) {
      if (contract.status !== "active") continue;
      let touched = false;
      for (const commitment of contract.commitments) {
        if (!commitment.isActive) continue;
        const kpiCode = SLA_METRIC_SPECS[commitment.metric].kpiCode;
        if (!kpiCode) continue;
        const measurement = scorecard.measurement(kpiCode);
        if (!measurement) continue;
        if (contract.breaches.some((breach) => breach.commitmentId === commitment.id && breach.periodCode === scorecard.periodCode)) {
          continue;
        }
        const breach = contract.recordSlaResult({
          commitmentId: commitment.id,
          periodCode: scorecard.periodCode,
          measured: measurement.value,
          recordedOn: this.clock.today(),
          note: `Derived from scorecard ${scorecard.periodCode}`,
        });
        touched = true;
        if (breach) breaches.push(breach);
      }
      if (touched) {
        await this.contracts.save(contract);
        await this.outbox.publish(contract.pullEvents());
      }
    }
    return breaches;
  }

  /**
   * A probation rating stops new sourcing until the improvement plan is done;
   * a watch rating only raises the risk flag. Both are visible to the
   * eligibility check.
   */
  private async escalatePoorPerformance(
    ctx: TenantContext,
    scorecard: Scorecard,
    rating: SupplierRating,
  ): Promise<void> {
    const supplier = await this.suppliers.byId(ctx.tenantId, scorecard.supplierId);
    if (!supplier) return;
    const profile =
      (await this.riskProfiles.bySupplier(ctx.tenantId, supplier.id)) ??
      SupplierRiskProfile.create(ctx.tenantId, supplier.id, supplier.code);
    const sourceRef = `scorecard:${scorecard.id}`;
    if (!profile.flags.some((flag) => flag.sourceRef === sourceRef && flag.status !== "closed")) {
      profile.raiseFlag(
        {
          category: "delivery",
          title: `${scorecard.periodCode} scorecard rated ${rating} (${scorecard.score})`,
          description: `Red KPIs: ${scorecard.redKpis().join(", ") || "none"}`,
          source: "internal",
          likelihood: rating === "probation" ? 4 : 3,
          impact: rating === "probation" ? 4 : 3,
          detectedOn: this.clock.today(),
          reviewDueOn: addMonths(this.clock.today(), 3),
          ownerId: ctx.userId,
          sourceRef,
        },
        this.clock.now(),
      );
    }
    if (rating === "probation" && !profile.activeHolds().some((hold) => hold.sourceRef === sourceRef)) {
      profile.placeHold(
        {
          type: "sourcing",
          reasonCode: "performance_probation",
          placedOn: this.clock.today(),
          note: `Scorecard ${scorecard.periodCode} scored ${scorecard.score}`,
          releaseRoles: ["srm.category-manager", "srm.compliance"],
          sourceRef,
        },
        ctx.userId,
        this.clock.now(),
      );
    }
    await this.commitProfile(profile);
  }

  private async requireKpi(ctx: TenantContext, code: string): Promise<KpiDefinitionRecord> {
    const definition = await this.kpis.byCode(ctx.tenantId, code.trim().toLowerCase());
    if (!definition) throw new NotFoundError("KpiDefinition", code);
    return definition;
  }

  private async requireSupplier(ctx: TenantContext, supplierId: Ulid): Promise<Supplier> {
    const supplier = await this.suppliers.byId(ctx.tenantId, supplierId);
    if (!supplier) throw new NotFoundError("Supplier", supplierId);
    return supplier;
  }

  private async commit(scorecard: Scorecard): Promise<void> {
    await this.scorecards.save(scorecard);
    await this.outbox.publish(scorecard.pullEvents());
  }

  private async commitProfile(profile: SupplierRiskProfile): Promise<void> {
    await this.riskProfiles.save(profile);
    await this.outbox.publish(profile.pullEvents());
  }
}
