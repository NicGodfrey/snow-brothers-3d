/**
 * Inspection plan use-cases: authoring, activation, revisioning.
 */
import {
  ConflictError,
  NotFoundError,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { InspectionPlan, type CharacteristicInput, type LotOrigin, type PlanStatus, type PlanTargetType } from "../domain/inspection-plan.js";
import type { InspectionPlanRepository } from "../domain/repositories.js";
import type { SamplingRule } from "../domain/sampling.js";
import type { Outbox } from "./ports.js";

export interface CreatePlanCommand {
  planCode: string;
  name: string;
  description?: string;
  targetType: PlanTargetType;
  materialCode?: string;
  allowedOrigins?: LotOrigin[];
  samplingRule: SamplingRule;
  characteristics?: CharacteristicInput[];
}

export class InspectionPlanService {
  constructor(
    private readonly plans: InspectionPlanRepository,
    private readonly outbox: Outbox,
  ) {}

  private async flush(plan: InspectionPlan): Promise<void> {
    await this.plans.save(plan);
    await this.outbox.append(plan.pullEvents());
  }

  async createPlan(ctx: TenantContext, cmd: CreatePlanCommand): Promise<InspectionPlan> {
    const existing = await this.plans.findActiveByPlanCode(ctx.tenantId, cmd.planCode.trim().toUpperCase());
    if (existing) {
      throw new ConflictError(`An active plan with code '${cmd.planCode}' already exists`);
    }
    const plan = InspectionPlan.create(ctx.tenantId, cmd);
    for (const characteristic of cmd.characteristics ?? []) {
      plan.addCharacteristic(characteristic);
    }
    await this.flush(plan);
    return plan;
  }

  async addCharacteristic(ctx: TenantContext, planId: Ulid, input: CharacteristicInput) {
    const plan = await this.getPlan(ctx, planId);
    const characteristic = plan.addCharacteristic(input);
    await this.flush(plan);
    return { plan, characteristic };
  }

  async removeCharacteristic(ctx: TenantContext, planId: Ulid, characteristicId: Ulid): Promise<InspectionPlan> {
    const plan = await this.getPlan(ctx, planId);
    plan.removeCharacteristic(characteristicId);
    await this.flush(plan);
    return plan;
  }

  async updateSamplingRule(ctx: TenantContext, planId: Ulid, rule: SamplingRule): Promise<InspectionPlan> {
    const plan = await this.getPlan(ctx, planId);
    plan.updateSamplingRule(rule);
    await this.flush(plan);
    return plan;
  }

  async activatePlan(ctx: TenantContext, planId: Ulid): Promise<InspectionPlan> {
    const plan = await this.getPlan(ctx, planId);
    // Enforce a single active revision per plan code.
    const activeSibling = await this.plans.findActiveByPlanCode(ctx.tenantId, plan.planCode);
    if (activeSibling && activeSibling.id !== plan.id) {
      activeSibling.retire();
      await this.flush(activeSibling);
    }
    plan.activate();
    await this.flush(plan);
    return plan;
  }

  async retirePlan(ctx: TenantContext, planId: Ulid): Promise<InspectionPlan> {
    const plan = await this.getPlan(ctx, planId);
    plan.retire();
    await this.flush(plan);
    return plan;
  }

  /** Creates the next revision as a fresh draft plan. */
  async revisePlan(ctx: TenantContext, planId: Ulid): Promise<InspectionPlan> {
    const plan = await this.getPlan(ctx, planId);
    const next = plan.createNextRevision();
    await this.flush(next);
    return next;
  }

  async getPlan(ctx: TenantContext, planId: Ulid): Promise<InspectionPlan> {
    const plan = await this.plans.findById(ctx.tenantId, planId);
    if (!plan) throw new NotFoundError("InspectionPlan", planId);
    return plan;
  }

  async listPlans(
    ctx: TenantContext,
    filter?: { status?: PlanStatus; materialCode?: string },
  ): Promise<InspectionPlan[]> {
    return this.plans.list(ctx.tenantId, filter);
  }
}
