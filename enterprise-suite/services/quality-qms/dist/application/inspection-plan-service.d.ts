/**
 * Inspection plan use-cases: authoring, activation, revisioning.
 */
import { type TenantContext, type Ulid } from "@enterprise-suite/shared-kernel";
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
export declare class InspectionPlanService {
    private readonly plans;
    private readonly outbox;
    constructor(plans: InspectionPlanRepository, outbox: Outbox);
    private flush;
    createPlan(ctx: TenantContext, cmd: CreatePlanCommand): Promise<InspectionPlan>;
    addCharacteristic(ctx: TenantContext, planId: Ulid, input: CharacteristicInput): Promise<{
        plan: InspectionPlan;
        characteristic: import("../domain/inspection-plan.js").InspectionCharacteristic;
    }>;
    removeCharacteristic(ctx: TenantContext, planId: Ulid, characteristicId: Ulid): Promise<InspectionPlan>;
    updateSamplingRule(ctx: TenantContext, planId: Ulid, rule: SamplingRule): Promise<InspectionPlan>;
    activatePlan(ctx: TenantContext, planId: Ulid): Promise<InspectionPlan>;
    retirePlan(ctx: TenantContext, planId: Ulid): Promise<InspectionPlan>;
    /** Creates the next revision as a fresh draft plan. */
    revisePlan(ctx: TenantContext, planId: Ulid): Promise<InspectionPlan>;
    getPlan(ctx: TenantContext, planId: Ulid): Promise<InspectionPlan>;
    listPlans(ctx: TenantContext, filter?: {
        status?: PlanStatus;
        materialCode?: string;
    }): Promise<InspectionPlan[]>;
}
//# sourceMappingURL=inspection-plan-service.d.ts.map