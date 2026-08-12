import {
  brand,
  ConflictError,
  DomainError,
  type IsoDateTime,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import type { Lead } from "../domain/lead.js";
import { SendJob, type SendChannelKind, type SendJobStats } from "../domain/send-job.js";
import { Touchpoint } from "../domain/touchpoint.js";
import type {
  AudienceRepository,
  CampaignRepository,
  ChannelRepository,
  Clock,
  ContentAssetRepository,
  LeadRepository,
  MessageSenderPort,
  OutboxPort,
  SendJobRepository,
  TouchpointRepository,
} from "./ports.js";

export interface CreateSendJobInput {
  campaignId: string;
  channelId: string;
  audienceId: string;
  contentAssetId: string;
}

const KIND_TO_CONTENT: Record<SendChannelKind, string> = {
  email: "email_template",
  sms: "sms_template",
};

export class SendJobService {
  constructor(
    private readonly jobs: SendJobRepository,
    private readonly audiences: AudienceRepository,
    private readonly contents: ContentAssetRepository,
    private readonly campaigns: CampaignRepository,
    private readonly channels: ChannelRepository,
    private readonly leads: LeadRepository,
    private readonly touchpoints: TouchpointRepository,
    private readonly sender: MessageSenderPort,
    private readonly clock: Clock,
    private readonly outbox: OutboxPort,
  ) {}

  private persist(job: SendJob): SendJob {
    this.jobs.save(job);
    this.outbox.publish(job.pullEvents());
    return job;
  }

  create(ctx: TenantContext, input: CreateSendJobInput): SendJob {
    const campaign = this.campaigns.getOrThrow(ctx.tenantId, input.campaignId);
    const channel = this.channels.getOrThrow(ctx.tenantId, input.channelId);
    if (!channel.isMessagingChannel) {
      throw new DomainError(
        `Channel ${channel.code} (${channel.kind}) cannot deliver direct messages`,
        "SEND_JOB_INVALID_CHANNEL",
        422,
      );
    }
    if (!channel.active) {
      throw new ConflictError(`Channel is deactivated: ${channel.code}`);
    }
    const kind = channel.kind as SendChannelKind;

    const audience = this.audiences.getOrThrow(ctx.tenantId, input.audienceId);
    if (audience.channelKind !== kind) {
      throw new DomainError(
        `Audience was built for ${audience.channelKind}, channel delivers ${kind}`,
        "SEND_JOB_AUDIENCE_MISMATCH",
        422,
      );
    }
    if (audience.campaignId && audience.campaignId !== campaign.id) {
      throw new DomainError(
        "Audience was built for a different campaign",
        "SEND_JOB_AUDIENCE_MISMATCH",
        422,
      );
    }

    const content = this.contents.getOrThrow(ctx.tenantId, input.contentAssetId);
    if (content.kind !== KIND_TO_CONTENT[kind]) {
      throw new DomainError(
        `Content kind ${content.kind} does not fit a ${kind} send`,
        "SEND_JOB_CONTENT_MISMATCH",
        422,
      );
    }
    if (!content.isSendable) {
      throw new ConflictError(`Content must be approved before sending (status: ${content.status})`);
    }

    const job = SendJob.create({
      tenantId: ctx.tenantId,
      campaignId: campaign.id,
      channelId: channel.id,
      channelKind: kind,
      audienceId: audience.id,
      contentAssetId: content.id,
      recipientLeadIds: audience.memberLeadIds,
    });
    return this.persist(job);
  }

  queue(ctx: TenantContext, id: string, scheduledAt?: string): SendJob {
    const job = this.jobs.getOrThrow(ctx.tenantId, id);
    let at: IsoDateTime | undefined;
    if (scheduledAt !== undefined) {
      const ms = Date.parse(scheduledAt);
      if (Number.isNaN(ms)) {
        throw new DomainError(`scheduledAt is not a valid ISO date-time: ${scheduledAt}`, "INVALID_DATE");
      }
      at = brand<string, "IsoDateTime">(new Date(ms).toISOString());
    }
    job.queue(at);
    return this.persist(job);
  }

  /**
   * Executes the whole send synchronously against the (simulated) delivery
   * gateway: consent and address checks, per-recipient rendering, outcome
   * capture, engagement activities, and attribution touchpoints.
   */
  run(ctx: TenantContext, id: string): { job: SendJob; stats: SendJobStats } {
    const job = this.jobs.getOrThrow(ctx.tenantId, id);
    const campaign = this.campaigns.getOrThrow(ctx.tenantId, job.campaignId);
    if (!campaign.isRunnable) {
      throw new ConflictError(
        `Campaign ${campaign.code} must be active to send (status: ${campaign.status})`,
      );
    }
    const content = this.contents.getOrThrow(ctx.tenantId, job.contentAssetId);
    const now = this.clock.nowIso();
    job.start(now);

    for (const recipient of job.recipients) {
      const lead = this.leads.getOrThrow(ctx.tenantId, recipient.leadId);
      if (!lead.canReceive(job.channelKind)) {
        job.skipRecipient(lead.id, "no_consent");
        continue;
      }
      const address = job.channelKind === "email" ? lead.email : lead.view().phone;
      if (!address) {
        job.skipRecipient(lead.id, "no_address");
        continue;
      }

      const rendered = content.render({
        firstName: lead.view().firstName ?? "there",
        lastName: lead.view().lastName ?? "",
        fullName: lead.fullName,
        company: lead.company ?? "your company",
        email: lead.email,
      });
      const outcome = this.sender.send({
        jobId: job.id,
        channel: job.channelKind,
        to: address,
        subject: rendered.subject,
        body: rendered.body,
      });
      job.recordOutcome(lead.id, address, outcome, now);

      if (outcome.delivered) {
        this.recordEngagement(ctx, job, lead, outcome, now);
      }
      this.leads.save(lead);
      this.outbox.publish(lead.pullEvents());
    }

    const stats = job.complete(now);
    this.persist(job);
    return { job, stats };
  }

  private recordEngagement(
    ctx: TenantContext,
    job: SendJob,
    lead: Lead,
    outcome: { opened: boolean; clicked: boolean; unsubscribed: boolean },
    at: IsoDateTime,
  ): void {
    if (job.channelKind === "email" && outcome.opened) {
      lead.recordActivity({
        type: "email_open",
        occurredAt: at,
        campaignId: job.campaignId,
        channelId: job.channelId,
      });
      this.touchpoints.append(
        Touchpoint.record({
          tenantId: ctx.tenantId,
          leadId: lead.id,
          touchType: "email_open",
          occurredAt: at,
          campaignId: job.campaignId,
          channelId: job.channelId,
        }),
      );
    }
    if (outcome.clicked) {
      const clickActivity = job.channelKind === "email" ? "email_click" : "sms_click";
      lead.recordActivity({
        type: clickActivity,
        occurredAt: at,
        campaignId: job.campaignId,
        channelId: job.channelId,
      });
      this.touchpoints.append(
        Touchpoint.record({
          tenantId: ctx.tenantId,
          leadId: lead.id,
          touchType: clickActivity,
          occurredAt: at,
          campaignId: job.campaignId,
          channelId: job.channelId,
        }),
      );
    }
    if (outcome.unsubscribed) {
      lead.setConsent(job.channelKind, false, at);
    }
  }

  cancel(ctx: TenantContext, id: string): SendJob {
    const job = this.jobs.getOrThrow(ctx.tenantId, id);
    job.cancel();
    return this.persist(job);
  }

  get(ctx: TenantContext, id: string): SendJob {
    return this.jobs.getOrThrow(ctx.tenantId, id);
  }

  listByCampaign(ctx: TenantContext, campaignId: string): SendJob[] {
    const campaign = this.campaigns.getOrThrow(ctx.tenantId, campaignId);
    return this.jobs.listByCampaign(ctx.tenantId, campaign.id);
  }

  stats(ctx: TenantContext, id: string): SendJobStats {
    return this.jobs.getOrThrow(ctx.tenantId, id).stats();
  }
}
