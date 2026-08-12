import { type TenantContext } from "@enterprise-suite/shared-kernel";
import { Routing, type OperationInput, type RoutingStatus } from "../domain/routing.js";
import type { EventPublisher, RoutingRepository, WorkCenterRepository } from "./ports.js";
export interface OperationInputDto extends Omit<OperationInput, "workCenterId"> {
    workCenterId: string;
}
export declare class RoutingService {
    private readonly routings;
    private readonly workCenters;
    private readonly publisher;
    constructor(routings: RoutingRepository, workCenters: WorkCenterRepository, publisher: EventPublisher);
    create(ctx: TenantContext, input: {
        sku: string;
        revision?: string;
        description?: string;
        operations?: OperationInputDto[];
    }): Promise<Routing>;
    get(ctx: TenantContext, id: string): Promise<Routing>;
    list(ctx: TenantContext, filter?: {
        sku?: string;
        status?: RoutingStatus;
    }): Promise<Routing[]>;
    addOperation(ctx: TenantContext, id: string, op: OperationInputDto): Promise<Routing>;
    updateOperation(ctx: TenantContext, id: string, seq: number, patch: Partial<Omit<OperationInputDto, "seq">>): Promise<Routing>;
    removeOperation(ctx: TenantContext, id: string, seq: number): Promise<Routing>;
    release(ctx: TenantContext, id: string): Promise<Routing>;
    makeObsolete(ctx: TenantContext, id: string): Promise<Routing>;
    estimateLeadTime(ctx: TenantContext, id: string, quantity: number): Promise<{
        routingId: string;
        quantity: number;
        leadTimeMinutes: number;
    }>;
    private assertWorkCenterExists;
}
//# sourceMappingURL=routing-service.d.ts.map