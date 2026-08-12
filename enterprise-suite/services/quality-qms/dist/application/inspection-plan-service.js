/**
 * Inspection plan use-cases: authoring, activation, revisioning.
 */
import { ConflictError, NotFoundError, } from "@enterprise-suite/shared-kernel";
import { InspectionPlan } from "../domain/inspection-plan.js";
export class InspectionPlanService {
    plans;
    outbox;
    constructor(plans, outbox) {
        this.plans = plans;
        this.outbox = outbox;
    }
    async flush(plan) {
        await this.plans.save(plan);
        await this.outbox.append(plan.pullEvents());
    }
    async createPlan(ctx, cmd) {
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
    async addCharacteristic(ctx, planId, input) {
        const plan = await this.getPlan(ctx, planId);
        const characteristic = plan.addCharacteristic(input);
        await this.flush(plan);
        return { plan, characteristic };
    }
    async removeCharacteristic(ctx, planId, characteristicId) {
        const plan = await this.getPlan(ctx, planId);
        plan.removeCharacteristic(characteristicId);
        await this.flush(plan);
        return plan;
    }
    async updateSamplingRule(ctx, planId, rule) {
        const plan = await this.getPlan(ctx, planId);
        plan.updateSamplingRule(rule);
        await this.flush(plan);
        return plan;
    }
    async activatePlan(ctx, planId) {
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
    async retirePlan(ctx, planId) {
        const plan = await this.getPlan(ctx, planId);
        plan.retire();
        await this.flush(plan);
        return plan;
    }
    /** Creates the next revision as a fresh draft plan. */
    async revisePlan(ctx, planId) {
        const plan = await this.getPlan(ctx, planId);
        const next = plan.createNextRevision();
        await this.flush(next);
        return next;
    }
    async getPlan(ctx, planId) {
        const plan = await this.plans.findById(ctx.tenantId, planId);
        if (!plan)
            throw new NotFoundError("InspectionPlan", planId);
        return plan;
    }
    async listPlans(ctx, filter) {
        return this.plans.list(ctx.tenantId, filter);
    }
}
//# sourceMappingURL=inspection-plan-service.js.map