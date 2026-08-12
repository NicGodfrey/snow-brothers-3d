import { ConflictError, NotFoundError, } from "@enterprise-suite/shared-kernel";
import { routingId, workCenterId } from "../domain/ids.js";
import { Routing } from "../domain/routing.js";
export class RoutingService {
    routings;
    workCenters;
    publisher;
    constructor(routings, workCenters, publisher) {
        this.routings = routings;
        this.workCenters = workCenters;
        this.publisher = publisher;
    }
    async create(ctx, input) {
        const revision = input.revision?.trim() || "A";
        const existing = await this.routings.findBySkuRevision(ctx.tenantId, input.sku.toUpperCase(), revision);
        if (existing) {
            throw new ConflictError(`Routing ${input.sku}/${revision} already exists`);
        }
        const routing = Routing.create(ctx.tenantId, { ...input, revision });
        for (const op of input.operations ?? []) {
            await this.assertWorkCenterExists(ctx, op.workCenterId);
            routing.addOperation({ ...op, workCenterId: workCenterId(op.workCenterId) });
        }
        await this.routings.save(routing);
        await this.publisher.publish(routing.pullEvents());
        return routing;
    }
    async get(ctx, id) {
        const routing = await this.routings.findById(ctx.tenantId, routingId(id));
        if (!routing)
            throw new NotFoundError("Routing", id);
        return routing;
    }
    async list(ctx, filter) {
        const all = await this.routings.list(ctx.tenantId, filter);
        return all.sort((a, b) => a.sku.localeCompare(b.sku) || a.revision.localeCompare(b.revision));
    }
    async addOperation(ctx, id, op) {
        const routing = await this.get(ctx, id);
        await this.assertWorkCenterExists(ctx, op.workCenterId);
        routing.addOperation({ ...op, workCenterId: workCenterId(op.workCenterId) });
        await this.routings.save(routing);
        await this.publisher.publish(routing.pullEvents());
        return routing;
    }
    async updateOperation(ctx, id, seq, patch) {
        const routing = await this.get(ctx, id);
        if (patch.workCenterId !== undefined) {
            await this.assertWorkCenterExists(ctx, patch.workCenterId);
        }
        routing.updateOperation(seq, {
            ...patch,
            workCenterId: patch.workCenterId ? workCenterId(patch.workCenterId) : undefined,
        });
        await this.routings.save(routing);
        await this.publisher.publish(routing.pullEvents());
        return routing;
    }
    async removeOperation(ctx, id, seq) {
        const routing = await this.get(ctx, id);
        routing.removeOperation(seq);
        await this.routings.save(routing);
        await this.publisher.publish(routing.pullEvents());
        return routing;
    }
    async release(ctx, id) {
        const routing = await this.get(ctx, id);
        routing.release();
        await this.routings.save(routing);
        await this.publisher.publish(routing.pullEvents());
        return routing;
    }
    async makeObsolete(ctx, id) {
        const routing = await this.get(ctx, id);
        routing.makeObsolete();
        await this.routings.save(routing);
        await this.publisher.publish(routing.pullEvents());
        return routing;
    }
    async estimateLeadTime(ctx, id, quantity) {
        const routing = await this.get(ctx, id);
        return {
            routingId: routing.id,
            quantity,
            leadTimeMinutes: routing.estimateLeadTimeMinutes(quantity),
        };
    }
    async assertWorkCenterExists(ctx, id) {
        const workCenter = await this.workCenters.findById(ctx.tenantId, workCenterId(id));
        if (!workCenter)
            throw new NotFoundError("WorkCenter", id);
    }
}
//# sourceMappingURL=routing-service.js.map