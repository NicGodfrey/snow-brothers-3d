/**
 * CAPA use-cases: full workflow driving, action management, effectiveness
 * verification, and an overdue-actions query used by dashboards.
 */
import {
  NotFoundError,
  userId,
  type IsoDateTime,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import {
  CapaCase,
  type CapaAction,
  type CapaActionType,
  type CapaPriority,
  type CapaSourceLinkage,
  type CapaStatus,
  type CapaType,
  type RiskRating,
  type RootCauseMethod,
} from "../domain/capa.js";
import type { CapaRepository } from "../domain/repositories.js";
import { documentSeries, type Clock, type NumberSeries, type Outbox } from "./ports.js";

export interface CreateCapaCommand {
  type: CapaType;
  title: string;
  description: string;
  priority: CapaPriority;
  riskRating?: RiskRating;
  source?: Partial<CapaSourceLinkage>;
  owner?: string; // defaults to the calling user
}

export class CapaService {
  constructor(
    private readonly capas: CapaRepository,
    private readonly outbox: Outbox,
    private readonly numbers: NumberSeries,
    private readonly clock: Clock,
  ) {}

  private async flush(capa: CapaCase): Promise<void> {
    await this.capas.save(capa);
    await this.outbox.append(capa.pullEvents());
  }

  async createCapa(ctx: TenantContext, cmd: CreateCapaCommand): Promise<CapaCase> {
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

  async submit(ctx: TenantContext, capaId: Ulid): Promise<CapaCase> {
    return this.mutate(ctx, capaId, (capa) => capa.submit());
  }

  async startInvestigation(ctx: TenantContext, capaId: Ulid): Promise<CapaCase> {
    return this.mutate(ctx, capaId, (capa) => capa.startInvestigation());
  }

  async recordRootCause(
    ctx: TenantContext,
    capaId: Ulid,
    input: {
      method: RootCauseMethod;
      summary: string;
      causes: readonly { category?: string; description: string }[];
    },
  ): Promise<CapaCase> {
    return this.mutate(ctx, capaId, (capa) =>
      capa.recordRootCause({ ...input, completedBy: ctx.userId }),
    );
  }

  async moveToActionPlanning(ctx: TenantContext, capaId: Ulid): Promise<CapaCase> {
    return this.mutate(ctx, capaId, (capa) => capa.moveToActionPlanning());
  }

  async addAction(
    ctx: TenantContext,
    capaId: Ulid,
    input: { type: CapaActionType; description: string; owner?: string; dueAt: IsoDateTime },
  ): Promise<{ capa: CapaCase; action: CapaAction }> {
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

  async startAction(ctx: TenantContext, capaId: Ulid, actionId: Ulid): Promise<CapaCase> {
    return this.mutate(ctx, capaId, (capa) => capa.startAction(actionId));
  }

  async completeAction(ctx: TenantContext, capaId: Ulid, actionId: Ulid, note?: string): Promise<CapaCase> {
    return this.mutate(ctx, capaId, (capa) => capa.completeAction(actionId, note));
  }

  async cancelAction(ctx: TenantContext, capaId: Ulid, actionId: Ulid, reason: string): Promise<CapaCase> {
    return this.mutate(ctx, capaId, (capa) => capa.cancelAction(actionId, reason));
  }

  async beginImplementation(ctx: TenantContext, capaId: Ulid): Promise<CapaCase> {
    return this.mutate(ctx, capaId, (capa) => capa.beginImplementation());
  }

  async defineEffectivenessCheck(
    ctx: TenantContext,
    capaId: Ulid,
    input: { criteria: string; dueAt: IsoDateTime },
  ): Promise<CapaCase> {
    return this.mutate(ctx, capaId, (capa) => capa.defineEffectivenessCheck(input));
  }

  async requestVerification(ctx: TenantContext, capaId: Ulid): Promise<CapaCase> {
    return this.mutate(ctx, capaId, (capa) => capa.requestVerification());
  }

  async recordEffectiveness(
    ctx: TenantContext,
    capaId: Ulid,
    input: { outcome: "effective" | "not-effective"; note?: string },
  ): Promise<CapaCase> {
    return this.mutate(ctx, capaId, (capa) =>
      capa.recordEffectiveness({ ...input, verifiedBy: ctx.userId }),
    );
  }

  async returnToPlanning(ctx: TenantContext, capaId: Ulid): Promise<CapaCase> {
    return this.mutate(ctx, capaId, (capa) => capa.returnToPlanning());
  }

  async close(ctx: TenantContext, capaId: Ulid, note?: string): Promise<CapaCase> {
    return this.mutate(ctx, capaId, (capa) => capa.close(ctx.userId, note));
  }

  async cancel(ctx: TenantContext, capaId: Ulid, reason: string): Promise<CapaCase> {
    return this.mutate(ctx, capaId, (capa) => capa.cancel(ctx.userId, reason));
  }

  async getCapa(ctx: TenantContext, capaId: Ulid): Promise<CapaCase> {
    const capa = await this.capas.findById(ctx.tenantId, capaId);
    if (!capa) throw new NotFoundError("CAPA", capaId);
    return capa;
  }

  async listCapas(ctx: TenantContext, filter?: { status?: CapaStatus; ncrId?: Ulid }): Promise<CapaCase[]> {
    return this.capas.list(ctx.tenantId, filter);
  }

  /** Open CAPAs with overdue actions, for quality dashboards. */
  async listOverdue(ctx: TenantContext): Promise<{ capa: CapaCase; overdueActions: CapaAction[] }[]> {
    const now = this.clock.now();
    const all = await this.capas.list(ctx.tenantId);
    return all
      .filter((c) => !["closed", "cancelled", "draft"].includes(c.status))
      .map((capa) => ({ capa, overdueActions: capa.overdueActions(now) }))
      .filter((entry) => entry.overdueActions.length > 0);
  }

  private async mutate(ctx: TenantContext, capaId: Ulid, fn: (capa: CapaCase) => void): Promise<CapaCase> {
    const capa = await this.getCapa(ctx, capaId);
    fn(capa);
    await this.flush(capa);
    return capa;
  }
}
