/**
 * CAPA use-cases: full workflow driving, action management, effectiveness
 * verification, and an overdue-actions query used by dashboards.
 */
import { type IsoDateTime, type TenantContext, type Ulid } from "@enterprise-suite/shared-kernel";
import { CapaCase, type CapaAction, type CapaActionType, type CapaPriority, type CapaSourceLinkage, type CapaStatus, type CapaType, type RiskRating, type RootCauseMethod } from "../domain/capa.js";
import type { CapaRepository } from "../domain/repositories.js";
import { type Clock, type NumberSeries, type Outbox } from "./ports.js";
export interface CreateCapaCommand {
    type: CapaType;
    title: string;
    description: string;
    priority: CapaPriority;
    riskRating?: RiskRating;
    source?: Partial<CapaSourceLinkage>;
    owner?: string;
}
export declare class CapaService {
    private readonly capas;
    private readonly outbox;
    private readonly numbers;
    private readonly clock;
    constructor(capas: CapaRepository, outbox: Outbox, numbers: NumberSeries, clock: Clock);
    private flush;
    createCapa(ctx: TenantContext, cmd: CreateCapaCommand): Promise<CapaCase>;
    submit(ctx: TenantContext, capaId: Ulid): Promise<CapaCase>;
    startInvestigation(ctx: TenantContext, capaId: Ulid): Promise<CapaCase>;
    recordRootCause(ctx: TenantContext, capaId: Ulid, input: {
        method: RootCauseMethod;
        summary: string;
        causes: readonly {
            category?: string;
            description: string;
        }[];
    }): Promise<CapaCase>;
    moveToActionPlanning(ctx: TenantContext, capaId: Ulid): Promise<CapaCase>;
    addAction(ctx: TenantContext, capaId: Ulid, input: {
        type: CapaActionType;
        description: string;
        owner?: string;
        dueAt: IsoDateTime;
    }): Promise<{
        capa: CapaCase;
        action: CapaAction;
    }>;
    startAction(ctx: TenantContext, capaId: Ulid, actionId: Ulid): Promise<CapaCase>;
    completeAction(ctx: TenantContext, capaId: Ulid, actionId: Ulid, note?: string): Promise<CapaCase>;
    cancelAction(ctx: TenantContext, capaId: Ulid, actionId: Ulid, reason: string): Promise<CapaCase>;
    beginImplementation(ctx: TenantContext, capaId: Ulid): Promise<CapaCase>;
    defineEffectivenessCheck(ctx: TenantContext, capaId: Ulid, input: {
        criteria: string;
        dueAt: IsoDateTime;
    }): Promise<CapaCase>;
    requestVerification(ctx: TenantContext, capaId: Ulid): Promise<CapaCase>;
    recordEffectiveness(ctx: TenantContext, capaId: Ulid, input: {
        outcome: "effective" | "not-effective";
        note?: string;
    }): Promise<CapaCase>;
    returnToPlanning(ctx: TenantContext, capaId: Ulid): Promise<CapaCase>;
    close(ctx: TenantContext, capaId: Ulid, note?: string): Promise<CapaCase>;
    cancel(ctx: TenantContext, capaId: Ulid, reason: string): Promise<CapaCase>;
    getCapa(ctx: TenantContext, capaId: Ulid): Promise<CapaCase>;
    listCapas(ctx: TenantContext, filter?: {
        status?: CapaStatus;
        ncrId?: Ulid;
    }): Promise<CapaCase[]>;
    /** Open CAPAs with overdue actions, for quality dashboards. */
    listOverdue(ctx: TenantContext): Promise<{
        capa: CapaCase;
        overdueActions: CapaAction[];
    }[]>;
    private mutate;
}
//# sourceMappingURL=capa-service.d.ts.map