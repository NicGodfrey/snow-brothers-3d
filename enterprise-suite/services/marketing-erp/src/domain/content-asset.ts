import {
  AggregateRoot,
  ConflictError,
  DomainError,
  envelope,
  type EntityProps,
  type IsoDateTime,
  type TenantId,
} from "@enterprise-suite/shared-kernel";
import { MarketingEvents } from "./events.js";

export const CONTENT_KINDS = [
  "email_template",
  "sms_template",
  "landing_page",
  "blog_post",
  "whitepaper",
  "ad_creative",
  "social_post",
  "video",
] as const;
export type ContentKind = (typeof CONTENT_KINDS)[number];

export const CONTENT_STATUSES = ["draft", "in_review", "approved", "retired"] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

const STATUS_TRANSITIONS: Record<ContentStatus, readonly ContentStatus[]> = {
  draft: ["in_review"],
  in_review: ["approved", "draft"],
  approved: ["retired", "in_review"],
  retired: [],
};

export interface ContentRevision {
  readonly revision: number;
  readonly body: string;
  readonly subject?: string;
  readonly changedAt: IsoDateTime;
  readonly changeNote?: string;
}

export interface ContentAssetProps {
  title: string;
  slug: string;
  kind: ContentKind;
  status: ContentStatus;
  /** Current body: template text for email/sms, canonical URL for hosted assets. */
  body: string;
  /** Email subject line template; only meaningful for email templates. */
  subject?: string;
  locale: string;
  tags: string[];
  revisions: ContentRevision[];
  approvedBy?: string;
  approvedAt?: IsoDateTime;
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;
const SMS_MAX_TEMPLATE_LENGTH = 480;

export function assertContentKind(value: string): ContentKind {
  if (!(CONTENT_KINDS as readonly string[]).includes(value)) {
    throw new DomainError(`Unknown content kind: ${value}`, "CONTENT_INVALID_KIND");
  }
  return value as ContentKind;
}

/** Distinct `{{variable}}` placeholders referenced by a template. */
export function extractTemplateVariables(template: string): string[] {
  const vars = new Set<string>();
  for (const match of template.matchAll(VARIABLE_PATTERN)) {
    vars.add(match[1]!);
  }
  return [...vars];
}

export interface RenderResult {
  readonly rendered: string;
  readonly missingVariables: readonly string[];
}

/** Substitutes `{{variable}}` placeholders; unresolved ones are blanked and reported. */
export function renderTemplate(template: string, vars: Record<string, string>): RenderResult {
  const missing = new Set<string>();
  const rendered = template.replace(VARIABLE_PATTERN, (_whole, name: string) => {
    const value = vars[name];
    if (value === undefined) {
      missing.add(name);
      return "";
    }
    return value;
  });
  return { rendered, missingVariables: [...missing] };
}

export class ContentAsset extends AggregateRoot<ContentAssetProps> {
  private constructor(tenantId: TenantId, props: ContentAssetProps, existing?: Partial<EntityProps>) {
    super(tenantId, props, existing);
  }

  static create(input: {
    tenantId: TenantId;
    title: string;
    slug: string;
    kind: ContentKind;
    body: string;
    createdAt: IsoDateTime;
    subject?: string;
    locale?: string;
    tags?: string[];
  }): ContentAsset {
    if (input.title.trim().length < 3) {
      throw new DomainError("Content title must be at least 3 characters", "CONTENT_INVALID_TITLE");
    }
    if (!SLUG_PATTERN.test(input.slug)) {
      throw new DomainError(`Content slug must be kebab-case: ${input.slug}`, "CONTENT_INVALID_SLUG");
    }
    if (input.body.trim().length === 0) {
      throw new DomainError("Content body must not be empty", "CONTENT_EMPTY_BODY");
    }
    if (input.kind === "email_template" && !input.subject?.trim()) {
      throw new DomainError("Email templates require a subject line", "CONTENT_MISSING_SUBJECT");
    }
    if (input.kind === "sms_template" && input.body.length > SMS_MAX_TEMPLATE_LENGTH) {
      throw new DomainError(
        `SMS template exceeds ${SMS_MAX_TEMPLATE_LENGTH} characters`,
        "CONTENT_SMS_TOO_LONG",
      );
    }
    const asset = new ContentAsset(input.tenantId, {
      title: input.title.trim(),
      slug: input.slug,
      kind: input.kind,
      status: "draft",
      body: input.body,
      subject: input.subject,
      locale: input.locale ?? "en-US",
      tags: [...new Set((input.tags ?? []).map((t) => t.toLowerCase()))],
      revisions: [
        {
          revision: 1,
          body: input.body,
          subject: input.subject,
          changedAt: input.createdAt,
          changeNote: "initial version",
        },
      ],
    });
    asset.raise(
      envelope({
        eventType: MarketingEvents.ContentAssetCreated,
        aggregateType: "ContentAsset",
        aggregateId: asset.id,
        tenantId: asset.tenantId,
        payload: { contentAssetId: asset.id, slug: input.slug, kind: input.kind },
      }),
    );
    return asset;
  }

  get title(): string {
    return this.props.title;
  }

  get slug(): string {
    return this.props.slug;
  }

  get kind(): ContentKind {
    return this.props.kind;
  }

  get status(): ContentStatus {
    return this.props.status;
  }

  get body(): string {
    return this.props.body;
  }

  get subject(): string | undefined {
    return this.props.subject;
  }

  get locale(): string {
    return this.props.locale;
  }

  get revisions(): readonly ContentRevision[] {
    return this.props.revisions;
  }

  get currentRevision(): number {
    return this.props.revisions[this.props.revisions.length - 1]!.revision;
  }

  get isSendable(): boolean {
    return (
      this.props.status === "approved" &&
      (this.props.kind === "email_template" || this.props.kind === "sms_template")
    );
  }

  /** Placeholders the send pipeline must supply per recipient. */
  get variables(): string[] {
    const all = extractTemplateVariables(this.props.body);
    if (this.props.subject) {
      for (const v of extractTemplateVariables(this.props.subject)) {
        if (!all.includes(v)) all.push(v);
      }
    }
    return all;
  }

  private transitionTo(next: ContentStatus, eventType: string): void {
    const current = this.props.status;
    if (!STATUS_TRANSITIONS[current].includes(next)) {
      throw new ConflictError(`Content cannot transition ${current} -> ${next}`);
    }
    this.props.status = next;
    this.raise(
      envelope({
        eventType,
        aggregateType: "ContentAsset",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { contentAssetId: this.id, previousStatus: current, status: next },
      }),
    );
  }

  submitForReview(): void {
    this.transitionTo("in_review", MarketingEvents.ContentAssetSubmitted);
  }

  approve(approverUserId: string, at: IsoDateTime): void {
    this.transitionTo("approved", MarketingEvents.ContentAssetApproved);
    this.props.approvedBy = approverUserId;
    this.props.approvedAt = at;
  }

  reject(reason: string): void {
    this.transitionTo("draft", MarketingEvents.ContentAssetRejected);
    this.props.revisions.push({
      revision: this.currentRevision, // rejection is an annotation, not a new body
      body: this.props.body,
      subject: this.props.subject,
      changedAt: this.updatedAt,
      changeNote: `rejected: ${reason}`,
    });
  }

  retire(): void {
    this.transitionTo("retired", MarketingEvents.ContentAssetRetired);
  }

  /** Editing an approved asset forces it back through review. */
  revise(input: { body: string; subject?: string; changeNote?: string; at: IsoDateTime }): void {
    if (this.props.status === "retired") {
      throw new ConflictError("Cannot revise a retired asset");
    }
    if (input.body.trim().length === 0) {
      throw new DomainError("Content body must not be empty", "CONTENT_EMPTY_BODY");
    }
    if (this.props.kind === "sms_template" && input.body.length > SMS_MAX_TEMPLATE_LENGTH) {
      throw new DomainError(
        `SMS template exceeds ${SMS_MAX_TEMPLATE_LENGTH} characters`,
        "CONTENT_SMS_TOO_LONG",
      );
    }
    this.props.body = input.body;
    if (input.subject !== undefined) this.props.subject = input.subject;
    if (this.props.status === "approved") {
      this.props.status = "draft";
      this.props.approvedBy = undefined;
      this.props.approvedAt = undefined;
    }
    this.props.revisions.push({
      revision: this.currentRevision + 1,
      body: input.body,
      subject: this.props.subject,
      changedAt: input.at,
      changeNote: input.changeNote,
    });
    this.raise(
      envelope({
        eventType: MarketingEvents.ContentAssetRevised,
        aggregateType: "ContentAsset",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { contentAssetId: this.id, revision: this.currentRevision },
      }),
    );
  }

  /** Renders subject + body for one recipient. Only sendable kinds render. */
  render(vars: Record<string, string>): { subject?: string; body: string; missingVariables: string[] } {
    const bodyResult = renderTemplate(this.props.body, vars);
    const missing = [...bodyResult.missingVariables];
    let subject: string | undefined;
    if (this.props.subject) {
      const subjectResult = renderTemplate(this.props.subject, vars);
      subject = subjectResult.rendered;
      for (const v of subjectResult.missingVariables) {
        if (!missing.includes(v)) missing.push(v);
      }
    }
    return { subject, body: bodyResult.rendered, missingVariables: missing };
  }
}
