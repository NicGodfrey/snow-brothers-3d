import { DomainError, type TenantContext } from "@enterprise-suite/shared-kernel";
import { assertActivityType, type Lead } from "../domain/lead.js";
import {
  defaultScoringModel,
  ScoringModel,
  type ActivityWeight,
  type DemographicRule,
  type ScoreBreakdown,
} from "../domain/lead-scoring.js";
import type { Clock, LeadRepository, OutboxPort, ScoringModelRepository } from "./ports.js";

export interface UpdateScoringModelInput {
  activityWeights?: { activity: string; points: number }[];
  demographicRules?: DemographicRule[];
  mqlThreshold?: number;
  sqlThreshold?: number;
}

export interface RescoreResult {
  readonly leadId: string;
  readonly score: number;
  readonly grade: string;
  readonly stage: string;
  readonly promoted: "none" | "mql" | "sql";
  readonly breakdown: ScoreBreakdown;
}

export interface BatchRescoreSummary {
  readonly scored: number;
  readonly promotedToMql: number;
  readonly promotedToSql: number;
}

export class LeadScoringService {
  constructor(
    private readonly models: ScoringModelRepository,
    private readonly leads: LeadRepository,
    private readonly clock: Clock,
    private readonly outbox: OutboxPort,
  ) {}

  /** Every tenant always has a model; the default is provisioned lazily. */
  getModel(ctx: TenantContext): ScoringModel {
    const existing = this.models.findDefault(ctx.tenantId);
    if (existing) return existing;
    const model = defaultScoringModel(ctx.tenantId);
    this.models.save(model);
    this.outbox.publish(model.pullEvents());
    return model;
  }

  updateModel(ctx: TenantContext, input: UpdateScoringModelInput): ScoringModel {
    const model = this.getModel(ctx);
    if (input.activityWeights || input.demographicRules) {
      const weights: ActivityWeight[] = (input.activityWeights ?? []).map((w) => {
        if (w.points < 0) {
          throw new DomainError("Activity points cannot be negative", "SCORING_INVALID_POINTS");
        }
        return { activity: assertActivityType(w.activity), points: w.points };
      });
      model.replaceRules(
        input.activityWeights ? weights : [...modelWeightsOf(model)],
        input.demographicRules ?? [...modelDemographicsOf(model)],
      );
    }
    if (input.mqlThreshold !== undefined || input.sqlThreshold !== undefined) {
      model.updateThresholds(
        input.mqlThreshold ?? model.mqlThreshold,
        input.sqlThreshold ?? model.sqlThreshold,
      );
    }
    this.models.save(model);
    this.outbox.publish(model.pullEvents());
    return model;
  }

  /**
   * Recomputes one lead's score and applies stage promotions the score
   * justifies. Promotion only ever moves forward (lead -> mql -> sql);
   * demotion is a deliberate human decision, not a scoring side effect.
   */
  rescoreLead(ctx: TenantContext, leadId: string): RescoreResult {
    const model = this.getModel(ctx);
    const lead = this.leads.getOrThrow(ctx.tenantId, leadId);
    const result = this.applyScoring(lead, model);
    this.leads.save(lead);
    this.outbox.publish(lead.pullEvents());
    return result;
  }

  rescoreAll(ctx: TenantContext): BatchRescoreSummary {
    const model = this.getModel(ctx);
    let scored = 0;
    let promotedToMql = 0;
    let promotedToSql = 0;
    for (const lead of this.leads.list(ctx.tenantId)) {
      if (lead.stage === "disqualified" || lead.isConverted || lead.stage === "customer") continue;
      const result = this.applyScoring(lead, model);
      this.leads.save(lead);
      this.outbox.publish(lead.pullEvents());
      scored += 1;
      if (result.promoted === "mql") promotedToMql += 1;
      if (result.promoted === "sql") promotedToSql += 1;
    }
    return { scored, promotedToMql, promotedToSql };
  }

  /** Pure preview: computes the breakdown without persisting or promoting. */
  explainScore(ctx: TenantContext, leadId: string): ScoreBreakdown {
    const model = this.getModel(ctx);
    const lead = this.leads.getOrThrow(ctx.tenantId, leadId);
    return model.computeScore(lead, this.clock.now());
  }

  private applyScoring(lead: Lead, model: ScoringModel): RescoreResult {
    const breakdown = model.computeScore(lead, this.clock.now());
    lead.applyScore(breakdown.total, breakdown.grade, model.id);

    let promoted: "none" | "mql" | "sql" = "none";
    const suggestion = model.stageSuggestion(breakdown.total);
    if (suggestion === "mql" && lead.stage === "lead") {
      lead.markMql(`score ${breakdown.total} >= ${model.mqlThreshold}`);
      promoted = "mql";
    } else if (suggestion === "sql") {
      if (lead.stage === "lead") {
        lead.markMql(`score ${breakdown.total} >= ${model.mqlThreshold}`);
        promoted = "mql";
      }
      if (lead.stage === "mql") {
        lead.markSql(`score ${breakdown.total} >= ${model.sqlThreshold}`);
        promoted = "sql";
      }
    }
    return {
      leadId: lead.id,
      score: breakdown.total,
      grade: breakdown.grade,
      stage: lead.stage,
      promoted,
      breakdown,
    };
  }
}

// The model exposes rules only through behavior; for partial updates we read
// them via the serialized form to avoid widening the aggregate's interface.
function modelWeightsOf(model: ScoringModel): ActivityWeight[] {
  return (model.toJSON() as unknown as { activityWeights: ActivityWeight[] }).activityWeights;
}

function modelDemographicsOf(model: ScoringModel): DemographicRule[] {
  return (model.toJSON() as unknown as { demographicRules: DemographicRule[] }).demographicRules;
}
