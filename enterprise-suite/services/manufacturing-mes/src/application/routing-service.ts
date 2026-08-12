import {
  ConflictError,
  NotFoundError,
  type TenantContext,
} from "@enterprise-suite/shared-kernel";
import { routingId, workCenterId } from "../domain/ids.js";
import { Routing, type OperationInput, type RoutingStatus } from "../domain/routing.js";
import type { EventPublisher, RoutingRepository, WorkCenterRepository } from "./ports.js";

export interface OperationInputDto extends Omit<OperationInput, "workCenterId"> {
  workCenterId: string;
}

export class RoutingService {
  constructor(
    private readonly routings: RoutingRepository,
    private readonly workCenters: WorkCenterRepository,
    private readonly publisher: EventPublisher,
  ) {}

  async create(
    ctx: TenantContext,
    input: { sku: string; revision?: string; description?: string; operations?: OperationInputDto[] },
  ): Promise<Routing> {
    const revision = input.revision?.trim() || "A";
    const existing = await this.routings.findBySkuRevision(
      ctx.tenantId,
      input.sku.toUpperCase(),
      revision,
    );
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

  async get(ctx: TenantContext, id: string): Promise<Routing> {
    const routing = await this.routings.findById(ctx.tenantId, routingId(id));
    if (!routing) throw new NotFoundError("Routing", id);
    return routing;
  }

  async list(
    ctx: TenantContext,
    filter?: { sku?: string; status?: RoutingStatus },
  ): Promise<Routing[]> {
    const all = await this.routings.list(ctx.tenantId, filter);
    return all.sort((a, b) => a.sku.localeCompare(b.sku) || a.revision.localeCompare(b.revision));
  }

  async addOperation(ctx: TenantContext, id: string, op: OperationInputDto): Promise<Routing> {
    const routing = await this.get(ctx, id);
    await this.assertWorkCenterExists(ctx, op.workCenterId);
    routing.addOperation({ ...op, workCenterId: workCenterId(op.workCenterId) });
    await this.routings.save(routing);
    await this.publisher.publish(routing.pullEvents());
    return routing;
  }

  async updateOperation(
    ctx: TenantContext,
    id: string,
    seq: number,
    patch: Partial<Omit<OperationInputDto, "seq">>,
  ): Promise<Routing> {
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

  async removeOperation(ctx: TenantContext, id: string, seq: number): Promise<Routing> {
    const routing = await this.get(ctx, id);
    routing.removeOperation(seq);
    await this.routings.save(routing);
    await this.publisher.publish(routing.pullEvents());
    return routing;
  }

  async release(ctx: TenantContext, id: string): Promise<Routing> {
    const routing = await this.get(ctx, id);
    routing.release();
    await this.routings.save(routing);
    await this.publisher.publish(routing.pullEvents());
    return routing;
  }

  async makeObsolete(ctx: TenantContext, id: string): Promise<Routing> {
    const routing = await this.get(ctx, id);
    routing.makeObsolete();
    await this.routings.save(routing);
    await this.publisher.publish(routing.pullEvents());
    return routing;
  }

  async estimateLeadTime(
    ctx: TenantContext,
    id: string,
    quantity: number,
  ): Promise<{ routingId: string; quantity: number; leadTimeMinutes: number }> {
    const routing = await this.get(ctx, id);
    return {
      routingId: routing.id,
      quantity,
      leadTimeMinutes: routing.estimateLeadTimeMinutes(quantity),
    };
  }

  private async assertWorkCenterExists(ctx: TenantContext, id: string): Promise<void> {
    const workCenter = await this.workCenters.findById(ctx.tenantId, workCenterId(id));
    if (!workCenter) throw new NotFoundError("WorkCenter", id);
  }
}
