import {
  DomainError,
  Entity,
  type EntityProps,
  type IsoDateTime,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import type { UtmParams } from "./utm.js";

export const TOUCH_TYPES = [
  "impression",
  "click",
  "visit",
  "form_submit",
  "email_open",
  "email_click",
  "sms_click",
  "webinar_attend",
  "event_checkin",
  "referral_visit",
] as const;
export type TouchType = (typeof TOUCH_TYPES)[number];

export interface TouchpointProps {
  leadId: Ulid;
  touchType: TouchType;
  occurredAt: IsoDateTime;
  campaignId?: Ulid;
  channelId?: Ulid;
  utm?: UtmParams;
  /** Optional page/creative reference for diagnostics. */
  sourceRef?: string;
}

export function assertTouchType(value: string): TouchType {
  if (!(TOUCH_TYPES as readonly string[]).includes(value)) {
    throw new DomainError(`Unknown touch type: ${value}`, "TOUCHPOINT_INVALID_TYPE");
  }
  return value as TouchType;
}

/**
 * A Touchpoint is one marketing interaction on a lead's journey. Touchpoints
 * are append-only facts: they are never edited, and attribution models read
 * them ordered by occurrence time.
 */
export class Touchpoint extends Entity<TouchpointProps> {
  private constructor(tenantId: TenantId, props: TouchpointProps, existing?: Partial<EntityProps>) {
    super(tenantId, props, existing);
  }

  static record(input: {
    tenantId: TenantId;
    leadId: Ulid;
    touchType: TouchType;
    occurredAt: IsoDateTime;
    campaignId?: Ulid;
    channelId?: Ulid;
    utm?: UtmParams;
    sourceRef?: string;
  }): Touchpoint {
    if (!input.campaignId && !input.channelId && !input.utm) {
      throw new DomainError(
        "A touchpoint needs at least a campaign, a channel, or UTM parameters to be attributable",
        "TOUCHPOINT_UNATTRIBUTABLE",
      );
    }
    return new Touchpoint(input.tenantId, {
      leadId: input.leadId,
      touchType: input.touchType,
      occurredAt: input.occurredAt,
      campaignId: input.campaignId,
      channelId: input.channelId,
      utm: input.utm,
      sourceRef: input.sourceRef,
    });
  }

  get leadId(): Ulid {
    return this.props.leadId;
  }

  get touchType(): TouchType {
    return this.props.touchType;
  }

  get occurredAt(): IsoDateTime {
    return this.props.occurredAt;
  }

  get campaignId(): Ulid | undefined {
    return this.props.campaignId;
  }

  get channelId(): Ulid | undefined {
    return this.props.channelId;
  }

  get utm(): UtmParams | undefined {
    return this.props.utm;
  }
}
