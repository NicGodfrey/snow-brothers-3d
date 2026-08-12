import {
  normalizePage,
  paginate,
  type Page,
  type PageRequest,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { Segment, type SegmentRule } from "../domain/segment.js";
import type { LeadRepository, OutboxPort, SegmentRepository } from "./ports.js";

export interface SegmentPreview {
  readonly segmentId: Ulid;
  readonly matchCount: number;
  readonly sample: readonly { leadId: Ulid; email: string; stage: string; score: number }[];
}

export class SegmentService {
  constructor(
    private readonly segments: SegmentRepository,
    private readonly leads: LeadRepository,
    private readonly outbox: OutboxPort,
  ) {}

  private persist(segment: Segment): Segment {
    this.segments.save(segment);
    this.outbox.publish(segment.pullEvents());
    return segment;
  }

  createDynamic(
    ctx: TenantContext,
    input: { name: string; rule: SegmentRule; description?: string },
  ): Segment {
    const segment = Segment.createDynamic({ tenantId: ctx.tenantId, ...input });
    return this.persist(segment);
  }

  createStatic(
    ctx: TenantContext,
    input: { name: string; memberIds?: string[]; description?: string },
  ): Segment {
    // Every explicit member must exist; a typo'd id silently shrinking an
    // audience is worse than a hard failure here.
    const memberIds = (input.memberIds ?? []).map(
      (id) => this.leads.getOrThrow(ctx.tenantId, id).id,
    );
    const segment = Segment.createStatic({
      tenantId: ctx.tenantId,
      name: input.name,
      memberIds,
      description: input.description,
    });
    return this.persist(segment);
  }

  get(ctx: TenantContext, id: string): Segment {
    return this.segments.getOrThrow(ctx.tenantId, id);
  }

  list(ctx: TenantContext, page?: Partial<PageRequest>): Page<Segment> {
    const items = this.segments.list(ctx.tenantId);
    items.sort((a, b) => a.name.localeCompare(b.name));
    return paginate(items, normalizePage(page));
  }

  updateRule(ctx: TenantContext, id: string, rule: SegmentRule): Segment {
    const segment = this.segments.getOrThrow(ctx.tenantId, id);
    segment.updateRule(rule);
    return this.persist(segment);
  }

  addStaticMember(ctx: TenantContext, id: string, leadId: string): Segment {
    const segment = this.segments.getOrThrow(ctx.tenantId, id);
    const lead = this.leads.getOrThrow(ctx.tenantId, leadId);
    segment.addStaticMember(lead.id);
    return this.persist(segment);
  }

  removeStaticMember(ctx: TenantContext, id: string, leadId: string): Segment {
    const segment = this.segments.getOrThrow(ctx.tenantId, id);
    segment.removeStaticMember(this.leads.getOrThrow(ctx.tenantId, leadId).id);
    return this.persist(segment);
  }

  archive(ctx: TenantContext, id: string): Segment {
    const segment = this.segments.getOrThrow(ctx.tenantId, id);
    segment.archive();
    return this.persist(segment);
  }

  /** Evaluates the segment against the current lead base without persisting anything. */
  preview(ctx: TenantContext, id: string, sampleSize = 10): SegmentPreview {
    const segment = this.segments.getOrThrow(ctx.tenantId, id);
    const matches = this.leads
      .list(ctx.tenantId)
      .filter((lead) => segment.matches(lead.view()));
    return {
      segmentId: segment.id,
      matchCount: matches.length,
      sample: matches.slice(0, sampleSize).map((lead) => ({
        leadId: lead.id,
        email: lead.email,
        stage: lead.stage,
        score: lead.score,
      })),
    };
  }
}
