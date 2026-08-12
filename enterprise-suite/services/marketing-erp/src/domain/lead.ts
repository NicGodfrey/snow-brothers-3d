import {
  AggregateRoot,
  ConflictError,
  DomainError,
  envelope,
  type EntityProps,
  type IsoDateTime,
  type Money,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import {
  MarketingEvents,
  type LeadActivityRecordedPayload,
  type LeadCapturedPayload,
  type LeadConsentChangedPayload,
  type LeadScoredPayload,
  type LeadStageChangedPayload,
} from "./events.js";
import type { UtmParams } from "./utm.js";

export const LEAD_STAGES = [
  "subscriber",
  "lead",
  "mql",
  "sql",
  "opportunity",
  "customer",
  "disqualified",
] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

/** Funnel order used for "may only move forward" checks and reporting. */
export const FUNNEL_ORDER: readonly LeadStage[] = [
  "subscriber",
  "lead",
  "mql",
  "sql",
  "opportunity",
  "customer",
];

const STAGE_TRANSITIONS: Record<LeadStage, readonly LeadStage[]> = {
  subscriber: ["lead", "disqualified"],
  lead: ["mql", "disqualified"],
  mql: ["sql", "lead", "disqualified"],
  sql: ["opportunity", "mql", "disqualified"],
  opportunity: ["customer", "disqualified"],
  customer: [],
  disqualified: ["lead"],
};

export const LEAD_SOURCES = [
  "web_form",
  "landing_page",
  "import",
  "event",
  "webinar",
  "referral",
  "paid",
  "organic",
  "outbound",
  "partner",
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const LEAD_ACTIVITY_TYPES = [
  "page_view",
  "form_submit",
  "email_open",
  "email_click",
  "sms_click",
  "webinar_attend",
  "event_checkin",
  "demo_request",
  "content_download",
  "pricing_view",
  "trial_signup",
] as const;
export type LeadActivityType = (typeof LEAD_ACTIVITY_TYPES)[number];

export interface LeadActivity {
  readonly type: LeadActivityType;
  readonly occurredAt: IsoDateTime;
  readonly campaignId?: Ulid;
  readonly channelId?: Ulid;
  readonly metadata?: Record<string, string>;
}

export interface ConsentState {
  email: boolean;
  sms: boolean;
  updatedAt: IsoDateTime;
}

export type LeadGrade = "A" | "B" | "C" | "D";

export interface LeadProps {
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  company?: string;
  jobTitle?: string;
  industry?: string;
  companySize?: number;
  country?: string;
  source: LeadSource;
  stage: LeadStage;
  score: number;
  grade: LeadGrade;
  tags: string[];
  consent: ConsentState;
  capturedUtm?: UtmParams;
  activities: LeadActivity[];
  disqualifiedReason?: string;
  lastActivityAt?: IsoDateTime;
  ownerUserId?: string;
  conversionValue?: Money;
  convertedAt?: IsoDateTime;
}

/** Flat read view used by segment evaluation and projections. */
export type LeadView = EntityProps & LeadProps;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function assertLeadSource(value: string): LeadSource {
  if (!(LEAD_SOURCES as readonly string[]).includes(value)) {
    throw new DomainError(`Unknown lead source: ${value}`, "LEAD_INVALID_SOURCE");
  }
  return value as LeadSource;
}

export function assertActivityType(value: string): LeadActivityType {
  if (!(LEAD_ACTIVITY_TYPES as readonly string[]).includes(value)) {
    throw new DomainError(`Unknown activity type: ${value}`, "LEAD_INVALID_ACTIVITY");
  }
  return value as LeadActivityType;
}

export class Lead extends AggregateRoot<LeadProps> {
  private constructor(tenantId: TenantId, props: LeadProps, existing?: Partial<EntityProps>) {
    super(tenantId, props, existing);
  }

  static capture(input: {
    tenantId: TenantId;
    email: string;
    source: LeadSource;
    capturedAt: IsoDateTime;
    firstName?: string;
    lastName?: string;
    phone?: string;
    company?: string;
    jobTitle?: string;
    industry?: string;
    companySize?: number;
    country?: string;
    utm?: UtmParams;
    tags?: string[];
    consentEmail?: boolean;
    consentSms?: boolean;
  }): Lead {
    const email = input.email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(email)) {
      throw new DomainError(`Invalid email address: ${input.email}`, "LEAD_INVALID_EMAIL");
    }
    if (input.companySize !== undefined && (input.companySize < 1 || !Number.isInteger(input.companySize))) {
      throw new DomainError("companySize must be a positive integer", "LEAD_INVALID_COMPANY_SIZE");
    }
    const lead = new Lead(input.tenantId, {
      email,
      firstName: input.firstName?.trim(),
      lastName: input.lastName?.trim(),
      phone: input.phone?.trim(),
      company: input.company?.trim(),
      jobTitle: input.jobTitle?.trim(),
      industry: input.industry?.trim().toLowerCase(),
      companySize: input.companySize,
      country: input.country?.trim().toUpperCase(),
      source: input.source,
      stage: "subscriber",
      score: 0,
      grade: "D",
      tags: [...new Set(input.tags ?? [])],
      consent: {
        email: input.consentEmail ?? false,
        sms: input.consentSms ?? false,
        updatedAt: input.capturedAt,
      },
      capturedUtm: input.utm,
      activities: [],
    });
    lead.raise(
      envelope<LeadCapturedPayload>({
        eventType: MarketingEvents.LeadCaptured,
        aggregateType: "Lead",
        aggregateId: lead.id,
        tenantId: lead.tenantId,
        payload: { leadId: lead.id, email, source: input.source, utm: input.utm },
      }),
    );
    return lead;
  }

  get email(): string {
    return this.props.email;
  }

  get fullName(): string {
    return [this.props.firstName, this.props.lastName].filter(Boolean).join(" ") || this.props.email;
  }

  get company(): string | undefined {
    return this.props.company;
  }

  get stage(): LeadStage {
    return this.props.stage;
  }

  get score(): number {
    return this.props.score;
  }

  get grade(): LeadGrade {
    return this.props.grade;
  }

  get source(): LeadSource {
    return this.props.source;
  }

  get consent(): ConsentState {
    return this.props.consent;
  }

  get capturedUtm(): UtmParams | undefined {
    return this.props.capturedUtm;
  }

  get activities(): readonly LeadActivity[] {
    return this.props.activities;
  }

  get tags(): readonly string[] {
    return this.props.tags;
  }

  get conversionValue(): Money | undefined {
    return this.props.conversionValue;
  }

  get convertedAt(): IsoDateTime | undefined {
    return this.props.convertedAt;
  }

  get isConverted(): boolean {
    return this.props.stage === "opportunity" || this.props.stage === "customer";
  }

  view(): LeadView {
    return this.toJSON();
  }

  // -- Activities -----------------------------------------------------------

  recordActivity(activity: LeadActivity): void {
    if (this.props.stage === "disqualified") {
      throw new ConflictError("Cannot record activity on a disqualified lead");
    }
    this.props.activities.push(activity);
    this.props.lastActivityAt = activity.occurredAt;
    // First meaningful engagement promotes a subscriber to a working lead.
    if (this.props.stage === "subscriber" && activity.type !== "page_view") {
      this.changeStage("lead", `first ${activity.type}`);
    }
    this.raise(
      envelope<LeadActivityRecordedPayload>({
        eventType: MarketingEvents.LeadActivityRecorded,
        aggregateType: "Lead",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          leadId: this.id,
          activityType: activity.type,
          occurredAt: activity.occurredAt,
          campaignId: activity.campaignId,
          channelId: activity.channelId,
        },
      }),
    );
  }

  // -- Stage machine --------------------------------------------------------

  private changeStage(next: LeadStage, reason?: string): void {
    const current = this.props.stage;
    if (current === next) return;
    if (!STAGE_TRANSITIONS[current].includes(next)) {
      throw new ConflictError(`Lead cannot transition ${current} -> ${next}`);
    }
    this.props.stage = next;
    this.raise(
      envelope<LeadStageChangedPayload>({
        eventType: MarketingEvents.LeadStageChanged,
        aggregateType: "Lead",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { leadId: this.id, previousStage: current, stage: next, reason },
      }),
    );
  }

  promoteToLead(reason?: string): void {
    this.changeStage("lead", reason);
  }

  markMql(reason?: string): void {
    this.changeStage("mql", reason ?? "score threshold reached");
  }

  markSql(reason?: string): void {
    this.changeStage("sql", reason ?? "sales accepted");
  }

  /** Demote an over-promoted lead one step back down the funnel. */
  demote(reason: string): void {
    if (this.props.stage === "mql") this.changeStage("lead", reason);
    else if (this.props.stage === "sql") this.changeStage("mql", reason);
    else throw new ConflictError(`Cannot demote lead from stage ${this.props.stage}`);
  }

  disqualify(reason: string): void {
    if (this.props.stage === "customer") {
      throw new ConflictError("Cannot disqualify a customer");
    }
    this.props.disqualifiedReason = reason;
    this.changeStage("disqualified", reason);
    this.raise(
      envelope({
        eventType: MarketingEvents.LeadDisqualified,
        aggregateType: "Lead",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { leadId: this.id, reason },
      }),
    );
  }

  requalify(): void {
    this.props.disqualifiedReason = undefined;
    this.changeStage("lead", "requalified");
  }

  /**
   * Hand off to Sales: only sales-qualified leads may become opportunities.
   * The conversion value recorded here is what attribution models distribute.
   */
  handOff(estimatedValue: Money, at: IsoDateTime): void {
    if (this.props.stage !== "sql") {
      throw new ConflictError(
        `Only SQL leads can be handed off to sales (current stage: ${this.props.stage})`,
      );
    }
    if (estimatedValue.amountMinor <= 0) {
      throw new DomainError("Estimated value must be positive", "LEAD_INVALID_VALUE");
    }
    this.props.conversionValue = estimatedValue;
    this.props.convertedAt = at;
    this.changeStage("opportunity", "handed off to sales");
  }

  markCustomer(actualValue: Money, at: IsoDateTime): void {
    this.changeStage("customer", "deal won");
    this.props.conversionValue = actualValue;
    this.props.convertedAt = at;
    this.raise(
      envelope({
        eventType: MarketingEvents.LeadConverted,
        aggregateType: "Lead",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { leadId: this.id, value: actualValue, convertedAt: at },
      }),
    );
  }

  // -- Scoring --------------------------------------------------------------

  applyScore(score: number, grade: LeadGrade, modelId: Ulid): void {
    const previous = this.props.score;
    this.props.score = score;
    this.props.grade = grade;
    this.raise(
      envelope<LeadScoredPayload>({
        eventType: MarketingEvents.LeadScored,
        aggregateType: "Lead",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { leadId: this.id, previousScore: previous, score, grade, modelId },
      }),
    );
  }

  // -- Consent --------------------------------------------------------------

  setConsent(channel: "email" | "sms", granted: boolean, at: IsoDateTime): void {
    if (this.props.consent[channel] === granted) return;
    this.props.consent[channel] = granted;
    this.props.consent.updatedAt = at;
    this.raise(
      envelope<LeadConsentChangedPayload>({
        eventType: MarketingEvents.LeadConsentChanged,
        aggregateType: "Lead",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { leadId: this.id, channel, granted },
      }),
    );
  }

  unsubscribeAll(at: IsoDateTime): void {
    this.setConsent("email", false, at);
    this.setConsent("sms", false, at);
  }

  canReceive(channel: "email" | "sms"): boolean {
    return this.props.consent[channel] && this.props.stage !== "disqualified";
  }

  // -- Tags & enrichment ----------------------------------------------------

  addTag(tag: string): void {
    const normalized = tag.trim().toLowerCase();
    if (normalized.length === 0) {
      throw new DomainError("Tag must not be empty", "LEAD_INVALID_TAG");
    }
    if (!this.props.tags.includes(normalized)) {
      this.props.tags.push(normalized);
      this.touch();
    }
  }

  removeTag(tag: string): void {
    const idx = this.props.tags.indexOf(tag.trim().toLowerCase());
    if (idx !== -1) {
      this.props.tags.splice(idx, 1);
      this.touch();
    }
  }

  enrich(fields: {
    firstName?: string;
    lastName?: string;
    phone?: string;
    company?: string;
    jobTitle?: string;
    industry?: string;
    companySize?: number;
    country?: string;
    ownerUserId?: string;
  }): void {
    if (fields.firstName !== undefined) this.props.firstName = fields.firstName.trim();
    if (fields.lastName !== undefined) this.props.lastName = fields.lastName.trim();
    if (fields.phone !== undefined) this.props.phone = fields.phone.trim();
    if (fields.company !== undefined) this.props.company = fields.company.trim();
    if (fields.jobTitle !== undefined) this.props.jobTitle = fields.jobTitle.trim();
    if (fields.industry !== undefined) this.props.industry = fields.industry.trim().toLowerCase();
    if (fields.companySize !== undefined) this.props.companySize = fields.companySize;
    if (fields.country !== undefined) this.props.country = fields.country.trim().toUpperCase();
    if (fields.ownerUserId !== undefined) this.props.ownerUserId = fields.ownerUserId;
    this.touch();
  }
}
