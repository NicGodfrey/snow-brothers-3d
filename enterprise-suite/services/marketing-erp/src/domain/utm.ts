import {
  AggregateRoot,
  DomainError,
  envelope,
  type EntityProps,
  type IsoDateTime,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { MarketingEvents, type TrackedLinkClickedPayload } from "./events.js";

/**
 * UTM parameters as captured on inbound traffic and stamped on outbound
 * links. Source/medium/campaign are mandatory per the UTM convention;
 * term and content are optional refinements.
 */
export interface UtmParams {
  readonly source: string;
  readonly medium: string;
  readonly campaign: string;
  readonly term?: string;
  readonly content?: string;
}

const UTM_VALUE_PATTERN = /^[a-z0-9][a-z0-9_\-.+%]*$/;

function normalizeValue(raw: string, key: string): string {
  const value = raw.trim().toLowerCase().replace(/\s+/g, "_");
  if (value.length === 0) {
    throw new DomainError(`utm_${key} must not be empty`, "UTM_INVALID");
  }
  if (value.length > 128) {
    throw new DomainError(`utm_${key} exceeds 128 characters`, "UTM_INVALID");
  }
  if (!UTM_VALUE_PATTERN.test(value)) {
    throw new DomainError(
      `utm_${key} contains unsupported characters: ${value}`,
      "UTM_INVALID",
    );
  }
  return value;
}

/** Validates and canonicalizes raw UTM input (lowercase, snake_case). */
export function normalizeUtm(input: {
  source: string;
  medium: string;
  campaign: string;
  term?: string;
  content?: string;
}): UtmParams {
  const utm: {
    source: string;
    medium: string;
    campaign: string;
    term?: string;
    content?: string;
  } = {
    source: normalizeValue(input.source, "source"),
    medium: normalizeValue(input.medium, "medium"),
    campaign: normalizeValue(input.campaign, "campaign"),
  };
  if (input.term !== undefined && input.term.trim() !== "") {
    utm.term = normalizeValue(input.term, "term");
  }
  if (input.content !== undefined && input.content.trim() !== "") {
    utm.content = normalizeValue(input.content, "content");
  }
  return utm;
}

/**
 * Extracts UTM parameters from a URL. Returns undefined when the URL does
 * not carry the three mandatory parameters (partial UTM sets are treated
 * as untagged traffic rather than an error — this mirrors analytics tools).
 */
export function parseUtmFromUrl(url: string): UtmParams | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new DomainError(`Not a valid URL: ${url}`, "UTM_INVALID_URL");
  }
  const q = parsed.searchParams;
  const source = q.get("utm_source");
  const medium = q.get("utm_medium");
  const campaign = q.get("utm_campaign");
  if (!source || !medium || !campaign) return undefined;
  return normalizeUtm({
    source,
    medium,
    campaign,
    term: q.get("utm_term") ?? undefined,
    content: q.get("utm_content") ?? undefined,
  });
}

/** Stamps UTM parameters onto a destination URL, replacing existing ones. */
export function buildTrackingUrl(baseUrl: string, utm: UtmParams): string {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new DomainError(`Not a valid URL: ${baseUrl}`, "UTM_INVALID_URL");
  }
  parsed.searchParams.set("utm_source", utm.source);
  parsed.searchParams.set("utm_medium", utm.medium);
  parsed.searchParams.set("utm_campaign", utm.campaign);
  if (utm.term) parsed.searchParams.set("utm_term", utm.term);
  else parsed.searchParams.delete("utm_term");
  if (utm.content) parsed.searchParams.set("utm_content", utm.content);
  else parsed.searchParams.delete("utm_content");
  return parsed.toString();
}

export function utmEquals(a: UtmParams | undefined, b: UtmParams | undefined): boolean {
  if (!a || !b) return a === b;
  return (
    a.source === b.source &&
    a.medium === b.medium &&
    a.campaign === b.campaign &&
    (a.term ?? "") === (b.term ?? "") &&
    (a.content ?? "") === (b.content ?? "")
  );
}

// ---------------------------------------------------------------------------
// TrackedLink aggregate — a shortened, UTM-stamped link whose clicks feed
// touchpoint capture.
// ---------------------------------------------------------------------------

export interface TrackedLinkProps {
  shortCode: string;
  destinationUrl: string;
  utm: UtmParams;
  campaignId?: Ulid;
  channelId?: Ulid;
  clickCount: number;
  lastClickedAt?: IsoDateTime;
  active: boolean;
}

const SHORT_CODE_PATTERN = /^[a-zA-Z0-9]{4,16}$/;

export class TrackedLink extends AggregateRoot<TrackedLinkProps> {
  private constructor(
    tenantId: TenantId,
    props: TrackedLinkProps,
    existing?: Partial<EntityProps>,
  ) {
    super(tenantId, props, existing);
  }

  static create(input: {
    tenantId: TenantId;
    shortCode: string;
    destinationUrl: string;
    utm: UtmParams;
    campaignId?: Ulid;
    channelId?: Ulid;
  }): TrackedLink {
    if (!SHORT_CODE_PATTERN.test(input.shortCode)) {
      throw new DomainError(
        "Short code must be 4-16 alphanumeric characters",
        "TRACKED_LINK_INVALID_CODE",
      );
    }
    // buildTrackingUrl doubles as URL validation for the destination.
    buildTrackingUrl(input.destinationUrl, input.utm);
    const link = new TrackedLink(input.tenantId, {
      shortCode: input.shortCode,
      destinationUrl: input.destinationUrl,
      utm: input.utm,
      campaignId: input.campaignId,
      channelId: input.channelId,
      clickCount: 0,
      active: true,
    });
    link.raise(
      envelope({
        eventType: MarketingEvents.TrackedLinkCreated,
        aggregateType: "TrackedLink",
        aggregateId: link.id,
        tenantId: link.tenantId,
        payload: { linkId: link.id, shortCode: input.shortCode },
      }),
    );
    return link;
  }

  get shortCode(): string {
    return this.props.shortCode;
  }

  get destinationUrl(): string {
    return this.props.destinationUrl;
  }

  get utm(): UtmParams {
    return this.props.utm;
  }

  get campaignId(): Ulid | undefined {
    return this.props.campaignId;
  }

  get channelId(): Ulid | undefined {
    return this.props.channelId;
  }

  get clickCount(): number {
    return this.props.clickCount;
  }

  get active(): boolean {
    return this.props.active;
  }

  /** Full redirect target with UTM parameters applied. */
  get trackingUrl(): string {
    return buildTrackingUrl(this.props.destinationUrl, this.props.utm);
  }

  recordClick(occurredAt: IsoDateTime, leadId?: Ulid): void {
    if (!this.props.active) {
      throw new DomainError("Tracked link is deactivated", "TRACKED_LINK_INACTIVE", 409);
    }
    this.props.clickCount += 1;
    this.props.lastClickedAt = occurredAt;
    this.raise(
      envelope<TrackedLinkClickedPayload>({
        eventType: MarketingEvents.TrackedLinkClicked,
        aggregateType: "TrackedLink",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          linkId: this.id,
          shortCode: this.props.shortCode,
          leadId,
          campaignId: this.props.campaignId,
          clickCount: this.props.clickCount,
        },
      }),
    );
  }

  deactivate(): void {
    this.props.active = false;
    this.touch();
  }
}
