import {
  brand,
  ConflictError,
  DomainError,
  normalizePage,
  paginate,
  type IsoDateTime,
  type Page,
  type PageRequest,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import {
  assertActivityType,
  assertLeadSource,
  Lead,
  LEAD_STAGES,
  type LeadActivityType,
  type LeadStage,
} from "../domain/lead.js";
import { Touchpoint, type TouchType } from "../domain/touchpoint.js";
import { normalizeUtm, parseUtmFromUrl, type UtmParams } from "../domain/utm.js";
import type { FunnelSnapshotDto } from "./dto.js";
import type {
  CampaignRepository,
  Clock,
  LeadRepository,
  OutboxPort,
  TouchpointRepository,
} from "./ports.js";

export interface CaptureLeadInput {
  email: string;
  source: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  company?: string;
  jobTitle?: string;
  industry?: string;
  companySize?: number;
  country?: string;
  tags?: string[];
  consentEmail?: boolean;
  consentSms?: boolean;
  utm?: { source: string; medium: string; campaign: string; term?: string; content?: string };
  /** Alternative to `utm`: full landing URL from which UTM params are parsed. */
  landingUrl?: string;
}

export interface RecordActivityInput {
  type: string;
  occurredAt?: string;
  campaignId?: string;
  channelId?: string;
  utm?: { source: string; medium: string; campaign: string; term?: string; content?: string };
  metadata?: Record<string, string>;
}

/** How lead activities surface on the attribution timeline. */
const ACTIVITY_TO_TOUCH: Record<LeadActivityType, TouchType> = {
  page_view: "visit",
  form_submit: "form_submit",
  email_open: "email_open",
  email_click: "email_click",
  sms_click: "sms_click",
  webinar_attend: "webinar_attend",
  event_checkin: "event_checkin",
  demo_request: "form_submit",
  content_download: "form_submit",
  pricing_view: "visit",
  trial_signup: "form_submit",
};

function toIso(value: string | undefined, clock: Clock): IsoDateTime {
  if (value === undefined) return clock.nowIso();
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new DomainError(`occurredAt is not a valid ISO date-time: ${value}`, "INVALID_DATE");
  }
  return brand<string, "IsoDateTime">(new Date(ms).toISOString());
}

export class LeadService {
  constructor(
    private readonly leads: LeadRepository,
    private readonly touchpoints: TouchpointRepository,
    private readonly campaigns: CampaignRepository,
    private readonly clock: Clock,
    private readonly outbox: OutboxPort,
  ) {}

  private persist(lead: Lead): Lead {
    this.leads.save(lead);
    this.outbox.publish(lead.pullEvents());
    return lead;
  }

  capture(ctx: TenantContext, input: CaptureLeadInput): Lead {
    const email = input.email.trim().toLowerCase();
    if (this.leads.findByEmail(ctx.tenantId, email)) {
      throw new ConflictError(`Lead already exists for email: ${email}`);
    }
    let utm: UtmParams | undefined;
    if (input.utm) utm = normalizeUtm(input.utm);
    else if (input.landingUrl) utm = parseUtmFromUrl(input.landingUrl);

    const capturedAt = this.clock.nowIso();
    const lead = Lead.capture({
      tenantId: ctx.tenantId,
      email,
      source: assertLeadSource(input.source),
      capturedAt,
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone,
      company: input.company,
      jobTitle: input.jobTitle,
      industry: input.industry,
      companySize: input.companySize,
      country: input.country,
      utm,
      tags: input.tags,
      consentEmail: input.consentEmail,
      consentSms: input.consentSms,
    });

    // The capture itself is the first touch when we know where it came from.
    if (utm) {
      const campaign = this.campaigns.findByCode(ctx.tenantId, utm.campaign);
      this.appendTouchpoint(ctx, {
        leadId: lead.id,
        touchType: "form_submit",
        occurredAt: capturedAt,
        campaignId: campaign?.id,
        utm,
        sourceRef: input.landingUrl,
      });
    }
    return this.persist(lead);
  }

  get(ctx: TenantContext, id: string): Lead {
    return this.leads.getOrThrow(ctx.tenantId, id);
  }

  findByEmail(ctx: TenantContext, email: string): Lead | undefined {
    return this.leads.findByEmail(ctx.tenantId, email.trim().toLowerCase());
  }

  list(
    ctx: TenantContext,
    filter?: { stage?: string; minScore?: number; tag?: string },
    page?: Partial<PageRequest>,
  ): Page<Lead> {
    let items = this.leads.list(ctx.tenantId);
    if (filter?.stage !== undefined) {
      if (!(LEAD_STAGES as readonly string[]).includes(filter.stage)) {
        throw new DomainError(`Unknown lead stage: ${filter.stage}`, "LEAD_INVALID_STAGE");
      }
      items = items.filter((l) => l.stage === (filter.stage as LeadStage));
    }
    if (filter?.minScore !== undefined) {
      items = items.filter((l) => l.score >= filter.minScore!);
    }
    if (filter?.tag !== undefined) {
      const tag = filter.tag.toLowerCase();
      items = items.filter((l) => l.tags.includes(tag));
    }
    items.sort((a, b) => b.score - a.score || a.email.localeCompare(b.email));
    return paginate(items, normalizePage(page));
  }

  recordActivity(ctx: TenantContext, leadId: string, input: RecordActivityInput): Lead {
    const lead = this.leads.getOrThrow(ctx.tenantId, leadId);
    const type = assertActivityType(input.type);
    const occurredAt = toIso(input.occurredAt, this.clock);
    const utm = input.utm ? normalizeUtm(input.utm) : undefined;
    const campaignId = input.campaignId
      ? this.campaigns.getOrThrow(ctx.tenantId, input.campaignId).id
      : utm
        ? this.campaigns.findByCode(ctx.tenantId, utm.campaign)?.id
        : undefined;

    lead.recordActivity({
      type,
      occurredAt,
      campaignId,
      channelId: input.channelId as Ulid | undefined,
      metadata: input.metadata,
    });

    if (campaignId || input.channelId || utm) {
      this.appendTouchpoint(ctx, {
        leadId: lead.id,
        touchType: ACTIVITY_TO_TOUCH[type],
        occurredAt,
        campaignId,
        channelId: input.channelId as Ulid | undefined,
        utm,
      });
    }
    return this.persist(lead);
  }

  private appendTouchpoint(
    ctx: TenantContext,
    input: {
      leadId: Ulid;
      touchType: TouchType;
      occurredAt: IsoDateTime;
      campaignId?: Ulid;
      channelId?: Ulid;
      utm?: UtmParams;
      sourceRef?: string;
    },
  ): Touchpoint {
    const touchpoint = Touchpoint.record({ tenantId: ctx.tenantId, ...input });
    return this.touchpoints.append(touchpoint);
  }

  enrich(
    ctx: TenantContext,
    leadId: string,
    fields: Parameters<Lead["enrich"]>[0],
  ): Lead {
    const lead = this.leads.getOrThrow(ctx.tenantId, leadId);
    lead.enrich(fields);
    return this.persist(lead);
  }

  addTag(ctx: TenantContext, leadId: string, tag: string): Lead {
    const lead = this.leads.getOrThrow(ctx.tenantId, leadId);
    lead.addTag(tag);
    return this.persist(lead);
  }

  removeTag(ctx: TenantContext, leadId: string, tag: string): Lead {
    const lead = this.leads.getOrThrow(ctx.tenantId, leadId);
    lead.removeTag(tag);
    return this.persist(lead);
  }

  setConsent(ctx: TenantContext, leadId: string, channel: "email" | "sms", granted: boolean): Lead {
    const lead = this.leads.getOrThrow(ctx.tenantId, leadId);
    lead.setConsent(channel, granted, this.clock.nowIso());
    return this.persist(lead);
  }

  unsubscribe(ctx: TenantContext, leadId: string): Lead {
    const lead = this.leads.getOrThrow(ctx.tenantId, leadId);
    lead.unsubscribeAll(this.clock.nowIso());
    return this.persist(lead);
  }

  markMql(ctx: TenantContext, leadId: string, reason?: string): Lead {
    const lead = this.leads.getOrThrow(ctx.tenantId, leadId);
    lead.markMql(reason);
    return this.persist(lead);
  }

  markSql(ctx: TenantContext, leadId: string, reason?: string): Lead {
    const lead = this.leads.getOrThrow(ctx.tenantId, leadId);
    lead.markSql(reason);
    return this.persist(lead);
  }

  disqualify(ctx: TenantContext, leadId: string, reason: string): Lead {
    const lead = this.leads.getOrThrow(ctx.tenantId, leadId);
    lead.disqualify(reason);
    return this.persist(lead);
  }

  requalify(ctx: TenantContext, leadId: string): Lead {
    const lead = this.leads.getOrThrow(ctx.tenantId, leadId);
    lead.requalify();
    return this.persist(lead);
  }

  timeline(ctx: TenantContext, leadId: string): Touchpoint[] {
    const lead = this.leads.getOrThrow(ctx.tenantId, leadId);
    return this.touchpoints
      .listByLead(ctx.tenantId, lead.id)
      .sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : 1));
  }

  /** Aggregate funnel counts and stage-to-stage conversion rates. */
  funnel(ctx: TenantContext): FunnelSnapshotDto {
    const all = this.leads.list(ctx.tenantId);
    const counts = Object.fromEntries(LEAD_STAGES.map((s) => [s, 0])) as Record<LeadStage, number>;
    for (const lead of all) counts[lead.stage] += 1;

    // "Reached at least" counts: a customer has also been an MQL and SQL.
    const reached = (stage: LeadStage): number => {
      const order: LeadStage[] = ["subscriber", "lead", "mql", "sql", "opportunity", "customer"];
      const idx = order.indexOf(stage);
      return all.filter((l) => order.indexOf(l.stage) >= idx).length;
    };
    const totalActive = all.length - counts.disqualified;
    const leadsReached = reached("lead");
    const mqlReached = reached("mql");
    const sqlReached = reached("sql");
    const customers = counts.customer;
    return {
      countsByStage: counts,
      totalActive,
      mqlRate: leadsReached === 0 ? null : mqlReached / leadsReached,
      sqlRate: mqlReached === 0 ? null : sqlReached / mqlReached,
      winRate: sqlReached === 0 ? null : customers / sqlReached,
    };
  }
}
