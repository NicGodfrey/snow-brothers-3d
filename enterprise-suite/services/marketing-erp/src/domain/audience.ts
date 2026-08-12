import {
  AggregateRoot,
  envelope,
  type EntityProps,
  type IsoDateTime,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { MarketingEvents, type AudienceBuiltPayload } from "./events.js";
import type { Lead } from "./lead.js";
import type { Segment } from "./segment.js";

export type SuppressionReason = "unsubscribed" | "bounced" | "disqualified" | "no_consent";

export interface SuppressedMember {
  readonly leadId: Ulid;
  readonly reason: SuppressionReason;
}

export interface AudienceProps {
  segmentId: Ulid;
  campaignId?: Ulid;
  /** Which messaging channel consent was enforced during the build. */
  channelKind: "email" | "sms";
  memberLeadIds: Ulid[];
  suppressed: SuppressedMember[];
  builtAt: IsoDateTime;
}

/**
 * An Audience is an immutable snapshot of a segment's membership at build
 * time, with consent and suppression rules already applied. Send jobs target
 * audiences (not raw segments) so a delayed send does not silently pick up
 * leads who joined the segment after approval.
 */
export class Audience extends AggregateRoot<AudienceProps> {
  private constructor(tenantId: TenantId, props: AudienceProps, existing?: Partial<EntityProps>) {
    super(tenantId, props, existing);
  }

  static build(input: {
    tenantId: TenantId;
    segment: Segment;
    leads: readonly Lead[];
    channelKind: "email" | "sms";
    campaignId?: Ulid;
    builtAt: IsoDateTime;
    extraSuppressions?: readonly SuppressedMember[];
  }): Audience {
    const members: Ulid[] = [];
    const suppressed: SuppressedMember[] = [...(input.extraSuppressions ?? [])];
    const extraSuppressedIds = new Set(suppressed.map((s) => s.leadId));

    for (const lead of input.leads) {
      if (!input.segment.matches(lead.view())) continue;
      if (extraSuppressedIds.has(lead.id)) continue;
      if (lead.stage === "disqualified") {
        suppressed.push({ leadId: lead.id, reason: "disqualified" });
        continue;
      }
      if (!lead.consent[input.channelKind]) {
        suppressed.push({ leadId: lead.id, reason: "no_consent" });
        continue;
      }
      members.push(lead.id);
    }

    const audience = new Audience(input.tenantId, {
      segmentId: input.segment.id,
      campaignId: input.campaignId,
      channelKind: input.channelKind,
      memberLeadIds: members,
      suppressed,
      builtAt: input.builtAt,
    });
    audience.raise(
      envelope<AudienceBuiltPayload>({
        eventType: MarketingEvents.AudienceBuilt,
        aggregateType: "Audience",
        aggregateId: audience.id,
        tenantId: audience.tenantId,
        payload: {
          audienceId: audience.id,
          segmentId: input.segment.id,
          campaignId: input.campaignId,
          size: members.length,
          suppressedCount: suppressed.length,
        },
      }),
    );
    return audience;
  }

  get segmentId(): Ulid {
    return this.props.segmentId;
  }

  get campaignId(): Ulid | undefined {
    return this.props.campaignId;
  }

  get channelKind(): "email" | "sms" {
    return this.props.channelKind;
  }

  get memberLeadIds(): readonly Ulid[] {
    return this.props.memberLeadIds;
  }

  get suppressed(): readonly SuppressedMember[] {
    return this.props.suppressed;
  }

  get size(): number {
    return this.props.memberLeadIds.length;
  }

  get builtAt(): IsoDateTime {
    return this.props.builtAt;
  }

  includes(leadId: Ulid): boolean {
    return this.props.memberLeadIds.includes(leadId);
  }
}
