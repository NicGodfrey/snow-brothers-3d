import {
  isoDate,
  normalizePage,
  paginate,
  userId,
  type Page,
  type TenantContext,
  type Ulid,
} from "../kernel/index.js";
import { Opportunity } from "../domain/opportunities/opportunity.js";
import { OPEN_STAGES, type OpportunityStage } from "../domain/opportunities/stages.js";
import type { AccountRepository, OpportunityRepository, OutboxPort } from "./ports.js";
import { parse } from "./validation/validator.js";
import {
  createOpportunitySchema,
  loseOpportunitySchema,
  moveStageSchema,
  reviseAmountSchema,
} from "./validation/opportunity-schemas.js";

export interface PipelineStageSummary {
  readonly stage: OpportunityStage;
  readonly count: number;
  readonly totalMinor: number;
  readonly weightedMinor: number;
}

export interface PipelineSummary {
  readonly stages: readonly PipelineStageSummary[];
  readonly openCount: number;
  readonly openTotalMinor: number;
  readonly weightedTotalMinor: number;
}

export class OpportunityService {
  constructor(
    private readonly opportunities: OpportunityRepository,
    private readonly accounts: AccountRepository,
    private readonly outbox: OutboxPort,
  ) {}

  create(ctx: TenantContext, input: unknown): Opportunity {
    const cmd = parse(createOpportunitySchema, input);
    const account = this.accounts.getById(ctx.tenantId, cmd.accountId as Ulid);
    const opportunity = Opportunity.create(ctx.tenantId, {
      accountId: account.id,
      name: cmd.name,
      amountMinor: cmd.amountMinor,
      currency: cmd.currency,
      expectedCloseDate: cmd.expectedCloseDate === undefined ? undefined : isoDate(cmd.expectedCloseDate),
      ownerId: userId(ctx.userId as unknown as string),
      source: cmd.source,
    });
    this.opportunities.save(opportunity);
    this.outbox.append(opportunity.pullEvents());
    return opportunity;
  }

  get(ctx: TenantContext, id: Ulid): Opportunity {
    return this.opportunities.getById(ctx.tenantId, id);
  }

  list(
    ctx: TenantContext,
    query: { page?: number; pageSize?: number; stage?: string; accountId?: string } = {},
  ): Page<Opportunity> {
    let items = query.accountId
      ? this.opportunities.listByAccount(ctx.tenantId, query.accountId as Ulid)
      : this.opportunities.listByTenant(ctx.tenantId);
    if (query.stage) items = items.filter((o) => o.stage === query.stage);
    items.sort((a, b) => (a.createdAt as unknown as string).localeCompare(b.createdAt as unknown as string));
    return paginate(items, normalizePage(query));
  }

  moveStage(ctx: TenantContext, id: Ulid, input: unknown): Opportunity {
    const cmd = parse(moveStageSchema, input);
    const opportunity = this.opportunities.getById(ctx.tenantId, id);
    opportunity.moveToStage(cmd.stage);
    this.opportunities.save(opportunity);
    this.outbox.append(opportunity.pullEvents());
    return opportunity;
  }

  advanceStage(ctx: TenantContext, id: Ulid): Opportunity {
    const opportunity = this.opportunities.getById(ctx.tenantId, id);
    opportunity.advanceStage();
    this.opportunities.save(opportunity);
    this.outbox.append(opportunity.pullEvents());
    return opportunity;
  }

  reviseAmount(ctx: TenantContext, id: Ulid, input: unknown): Opportunity {
    const cmd = parse(reviseAmountSchema, input);
    const opportunity = this.opportunities.getById(ctx.tenantId, id);
    opportunity.reviseAmount(cmd.amountMinor);
    this.opportunities.save(opportunity);
    this.outbox.append(opportunity.pullEvents());
    return opportunity;
  }

  win(ctx: TenantContext, id: Ulid, wonQuoteId?: Ulid): Opportunity {
    const opportunity = this.opportunities.getById(ctx.tenantId, id);
    opportunity.win(wonQuoteId);
    this.opportunities.save(opportunity);
    this.outbox.append(opportunity.pullEvents());
    return opportunity;
  }

  lose(ctx: TenantContext, id: Ulid, input: unknown): Opportunity {
    const cmd = parse(loseOpportunitySchema, input);
    const opportunity = this.opportunities.getById(ctx.tenantId, id);
    opportunity.lose(cmd.reason);
    this.opportunities.save(opportunity);
    this.outbox.append(opportunity.pullEvents());
    return opportunity;
  }

  pipelineSummary(ctx: TenantContext): PipelineSummary {
    const open = this.opportunities.listOpen(ctx.tenantId);
    const stages: PipelineStageSummary[] = OPEN_STAGES.map((stage) => {
      const inStage = open.filter((o) => o.stage === stage);
      return {
        stage,
        count: inStage.length,
        totalMinor: inStage.reduce((acc, o) => acc + (o.amount.amountMinor as unknown as number), 0),
        weightedMinor: inStage.reduce((acc, o) => acc + o.weightedAmountMinor, 0),
      };
    });
    return {
      stages,
      openCount: open.length,
      openTotalMinor: stages.reduce((acc, s) => acc + s.totalMinor, 0),
      weightedTotalMinor: stages.reduce((acc, s) => acc + s.weightedMinor, 0),
    };
  }
}
