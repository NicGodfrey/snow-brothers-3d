/**
 * CAPA use-cases: full workflow driving, action management, effectiveness
 * verification, and an overdue-actions query used by dashboards.
 */
import { NotFoundError, userId, } from "@enterprise-suite/shared-kernel";
import { CapaCase, } from "../domain/capa.js";
import { documentSeries } from "./ports.js";
export class CapaService {
    capas;
    outbox;
    numbers;
    clock;
    constructor(capas, outbox, numbers, clock) {
        this.capas = capas;
        this.outbox = outbox;
        this.numbers = numbers;
        this.clock = clock;
    }
    async flush(capa) {
        await this.capas.save(capa);
        await this.outbox.append(capa.pullEvents());
    }
    async createCapa(ctx, cmd) {
        const capaNumber = await this.numbers.next(ctx.tenantId, documentSeries.capa);
        const capa = CapaCase.create(ctx.tenantId, {
            capaNumber,
            type: cmd.type,
            title: cmd.title,
            description: cmd.description,
            priority: cmd.priority,
            riskRating: cmd.riskRating,
            source: cmd.source,
            owner: cmd.owner ? userId(cmd.owner) : ctx.userId,
        });
        await this.flush(capa);
        return capa;
    }
    async submit(ctx, capaId) {
        return this.mutate(ctx, capaId, (capa) => capa.submit());
    }
    async startInvestigation(ctx, capaId) {
        return this.mutate(ctx, capaId, (capa) => capa.startInvestigation());
    }
    async recordRootCause(ctx, capaId, input) {
        return this.mutate(ctx, capaId, (capa) => capa.recordRootCause({ ...input, completedBy: ctx.userId }));
    }
    async moveToActionPlanning(ctx, capaId) {
        return this.mutate(ctx, capaId, (capa) => capa.moveToActionPlanning());
    }
    async addAction(ctx, capaId, input) {
        const capa = await this.getCapa(ctx, capaId);
        const action = capa.addAction({
            type: input.type,
            description: input.description,
            owner: input.owner ? userId(input.owner) : ctx.userId,
            dueAt: input.dueAt,
        });
        await this.flush(capa);
        return { capa, action };
    }
    async startAction(ctx, capaId, actionId) {
        return this.mutate(ctx, capaId, (capa) => capa.startAction(actionId));
    }
    async completeAction(ctx, capaId, actionId, note) {
        return this.mutate(ctx, capaId, (capa) => capa.completeAction(actionId, note));
    }
    async cancelAction(ctx, capaId, actionId, reason) {
        return this.mutate(ctx, capaId, (capa) => capa.cancelAction(actionId, reason));
    }
    async beginImplementation(ctx, capaId) {
        return this.mutate(ctx, capaId, (capa) => capa.beginImplementation());
    }
    async defineEffectivenessCheck(ctx, capaId, input) {
        return this.mutate(ctx, capaId, (capa) => capa.defineEffectivenessCheck(input));
    }
    async requestVerification(ctx, capaId) {
        return this.mutate(ctx, capaId, (capa) => capa.requestVerification());
    }
    async recordEffectiveness(ctx, capaId, input) {
        return this.mutate(ctx, capaId, (capa) => capa.recordEffectiveness({ ...input, verifiedBy: ctx.userId }));
    }
    async returnToPlanning(ctx, capaId) {
        return this.mutate(ctx, capaId, (capa) => capa.returnToPlanning());
    }
    async close(ctx, capaId, note) {
        return this.mutate(ctx, capaId, (capa) => capa.close(ctx.userId, note));
    }
    async cancel(ctx, capaId, reason) {
        return this.mutate(ctx, capaId, (capa) => capa.cancel(ctx.userId, reason));
    }
    async getCapa(ctx, capaId) {
        const capa = await this.capas.findById(ctx.tenantId, capaId);
        if (!capa)
            throw new NotFoundError("CAPA", capaId);
        return capa;
    }
    async listCapas(ctx, filter) {
        return this.capas.list(ctx.tenantId, filter);
    }
    /** Open CAPAs with overdue actions, for quality dashboards. */
    async listOverdue(ctx) {
        const now = this.clock.now();
        const all = await this.capas.list(ctx.tenantId);
        return all
            .filter((c) => !["closed", "cancelled", "draft"].includes(c.status))
            .map((capa) => ({ capa, overdueActions: capa.overdueActions(now) }))
            .filter((entry) => entry.overdueActions.length > 0);
    }
    async mutate(ctx, capaId, fn) {
        const capa = await this.getCapa(ctx, capaId);
        fn(capa);
        await this.flush(capa);
        return capa;
    }
}
//# sourceMappingURL=capa-service.js.map