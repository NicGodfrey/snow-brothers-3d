import {
  AggregateRoot,
  ConflictError,
  DomainError,
  envelope,
  type EntityProps,
  type IsoDateTime,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { MarketingEvents, type SendJobCompletedPayload } from "./events.js";

export type SendChannelKind = "email" | "sms";

export const SEND_JOB_STATUSES = [
  "draft",
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;
export type SendJobStatus = (typeof SEND_JOB_STATUSES)[number];

const STATUS_TRANSITIONS: Record<SendJobStatus, readonly SendJobStatus[]> = {
  draft: ["queued", "cancelled"],
  queued: ["running", "cancelled"],
  running: ["completed", "failed"],
  completed: [],
  failed: ["queued"],
  cancelled: [],
};

export type RecipientStatus =
  | "pending"
  | "skipped_no_consent"
  | "skipped_no_address"
  | "sent"
  | "bounced";

export interface RecipientDelivery {
  readonly leadId: Ulid;
  /** Email address or phone number depending on the channel kind. */
  address?: string;
  status: RecipientStatus;
  opened: boolean;
  clicked: boolean;
  unsubscribed: boolean;
  sentAt?: IsoDateTime;
  error?: string;
}

export interface SendJobStats {
  readonly total: number;
  readonly sent: number;
  readonly delivered: number;
  readonly bounced: number;
  readonly skipped: number;
  readonly opened: number;
  readonly clicked: number;
  readonly unsubscribed: number;
  /** opened / delivered */
  readonly openRate: number;
  /** clicked / delivered */
  readonly clickRate: number;
}

export interface SendJobProps {
  campaignId: Ulid;
  channelId: Ulid;
  channelKind: SendChannelKind;
  audienceId: Ulid;
  contentAssetId: Ulid;
  status: SendJobStatus;
  scheduledAt?: IsoDateTime;
  startedAt?: IsoDateTime;
  completedAt?: IsoDateTime;
  recipients: RecipientDelivery[];
  failureReason?: string;
}

export interface DeliveryOutcome {
  readonly delivered: boolean;
  readonly opened: boolean;
  readonly clicked: boolean;
  readonly unsubscribed: boolean;
  readonly failureReason?: string;
}

export class SendJob extends AggregateRoot<SendJobProps> {
  private constructor(tenantId: TenantId, props: SendJobProps, existing?: Partial<EntityProps>) {
    super(tenantId, props, existing);
  }

  static create(input: {
    tenantId: TenantId;
    campaignId: Ulid;
    channelId: Ulid;
    channelKind: SendChannelKind;
    audienceId: Ulid;
    contentAssetId: Ulid;
    recipientLeadIds: readonly Ulid[];
  }): SendJob {
    if (input.recipientLeadIds.length === 0) {
      throw new DomainError("Send job needs at least one recipient", "SEND_JOB_EMPTY_AUDIENCE", 422);
    }
    const job = new SendJob(input.tenantId, {
      campaignId: input.campaignId,
      channelId: input.channelId,
      channelKind: input.channelKind,
      audienceId: input.audienceId,
      contentAssetId: input.contentAssetId,
      status: "draft",
      recipients: input.recipientLeadIds.map((leadId) => ({
        leadId,
        status: "pending",
        opened: false,
        clicked: false,
        unsubscribed: false,
      })),
    });
    job.raise(
      envelope({
        eventType: MarketingEvents.SendJobCreated,
        aggregateType: "SendJob",
        aggregateId: job.id,
        tenantId: job.tenantId,
        payload: {
          sendJobId: job.id,
          campaignId: input.campaignId,
          channelKind: input.channelKind,
          recipientCount: input.recipientLeadIds.length,
        },
      }),
    );
    return job;
  }

  get campaignId(): Ulid {
    return this.props.campaignId;
  }

  get channelId(): Ulid {
    return this.props.channelId;
  }

  get channelKind(): SendChannelKind {
    return this.props.channelKind;
  }

  get audienceId(): Ulid {
    return this.props.audienceId;
  }

  get contentAssetId(): Ulid {
    return this.props.contentAssetId;
  }

  get status(): SendJobStatus {
    return this.props.status;
  }

  get scheduledAt(): IsoDateTime | undefined {
    return this.props.scheduledAt;
  }

  get recipients(): readonly RecipientDelivery[] {
    return this.props.recipients;
  }

  private transitionTo(next: SendJobStatus, eventType: string, extra?: object): void {
    const current = this.props.status;
    if (!STATUS_TRANSITIONS[current].includes(next)) {
      throw new ConflictError(`Send job cannot transition ${current} -> ${next}`);
    }
    this.props.status = next;
    this.raise(
      envelope({
        eventType,
        aggregateType: "SendJob",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { sendJobId: this.id, previousStatus: current, status: next, ...extra },
      }),
    );
  }

  queue(scheduledAt?: IsoDateTime): void {
    this.transitionTo("queued", MarketingEvents.SendJobScheduled, { scheduledAt });
    this.props.scheduledAt = scheduledAt;
  }

  start(at: IsoDateTime): void {
    if (this.props.scheduledAt && at < this.props.scheduledAt) {
      throw new ConflictError(
        `Send job is scheduled for ${this.props.scheduledAt}; cannot start at ${at}`,
      );
    }
    this.transitionTo("running", MarketingEvents.SendJobStarted);
    this.props.startedAt = at;
  }

  private recipientOrThrow(leadId: Ulid): RecipientDelivery {
    const recipient = this.props.recipients.find((r) => r.leadId === leadId);
    if (!recipient) {
      throw new DomainError(`Lead is not a recipient of this job: ${leadId}`, "SEND_JOB_UNKNOWN_RECIPIENT");
    }
    return recipient;
  }

  private assertRunning(): void {
    if (this.props.status !== "running") {
      throw new ConflictError(`Send job must be running (status: ${this.props.status})`);
    }
  }

  skipRecipient(leadId: Ulid, reason: "no_consent" | "no_address"): void {
    this.assertRunning();
    const recipient = this.recipientOrThrow(leadId);
    recipient.status = reason === "no_consent" ? "skipped_no_consent" : "skipped_no_address";
  }

  recordOutcome(leadId: Ulid, address: string, outcome: DeliveryOutcome, at: IsoDateTime): void {
    this.assertRunning();
    const recipient = this.recipientOrThrow(leadId);
    if (recipient.status !== "pending") {
      throw new ConflictError(`Recipient already processed: ${leadId} (${recipient.status})`);
    }
    recipient.address = address;
    recipient.sentAt = at;
    if (outcome.delivered) {
      recipient.status = "sent";
      recipient.opened = outcome.opened;
      recipient.clicked = outcome.clicked;
      recipient.unsubscribed = outcome.unsubscribed;
    } else {
      recipient.status = "bounced";
      recipient.error = outcome.failureReason ?? "delivery failed";
    }
  }

  complete(at: IsoDateTime): SendJobStats {
    const pending = this.props.recipients.filter((r) => r.status === "pending");
    if (pending.length > 0) {
      throw new ConflictError(`Cannot complete: ${pending.length} recipients still pending`);
    }
    const stats = this.stats();
    this.transitionTo("completed", MarketingEvents.SendJobCompleted, {
      campaignId: this.props.campaignId,
      channelKind: this.props.channelKind,
      sent: stats.sent,
      delivered: stats.delivered,
      bounced: stats.bounced,
      opened: stats.opened,
      clicked: stats.clicked,
      unsubscribed: stats.unsubscribed,
    } satisfies Partial<SendJobCompletedPayload> & object);
    this.props.completedAt = at;
    return stats;
  }

  fail(reason: string): void {
    this.transitionTo("failed", MarketingEvents.SendJobFailed, { reason });
    this.props.failureReason = reason;
  }

  cancel(): void {
    this.transitionTo("cancelled", MarketingEvents.SendJobCancelled);
  }

  stats(): SendJobStats {
    const recipients = this.props.recipients;
    const sent = recipients.filter((r) => r.status === "sent" || r.status === "bounced").length;
    const delivered = recipients.filter((r) => r.status === "sent").length;
    const bounced = recipients.filter((r) => r.status === "bounced").length;
    const skipped = recipients.filter(
      (r) => r.status === "skipped_no_consent" || r.status === "skipped_no_address",
    ).length;
    const opened = recipients.filter((r) => r.opened).length;
    const clicked = recipients.filter((r) => r.clicked).length;
    const unsubscribed = recipients.filter((r) => r.unsubscribed).length;
    return {
      total: recipients.length,
      sent,
      delivered,
      bounced,
      skipped,
      opened,
      clicked,
      unsubscribed,
      openRate: delivered === 0 ? 0 : opened / delivered,
      clickRate: delivered === 0 ? 0 : clicked / delivered,
    };
  }
}
