import {
  AggregateRoot,
  envelope,
  type EntityProps,
  type IsoDateTime,
  type TenantId,
} from "@enterprise-suite/shared-kernel";
import { InvalidStateError, QuotaExceededError, ValidationError } from "./errors.js";
import { AdminEventTypes } from "./events.js";

/**
 * Tenant aggregate.
 *
 * A tenant is the isolation boundary for everything else in the suite. It owns
 * its lifecycle (`provisioning → active ⇄ suspended → archived`), the plan that
 * sets its resource quotas, and the locale/currency defaults every domain
 * service reads when formatting for that customer.
 *
 * Suspension is deliberately reversible and archival deliberately terminal:
 * billing suspends and resumes routinely, whereas archival is the point where
 * data retention timers start.
 */

export const TENANT_STATUSES = ["provisioning", "active", "suspended", "archived"] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const TENANT_PLANS = ["trial", "standard", "enterprise"] as const;
export type TenantPlan = (typeof TENANT_PLANS)[number];

export const TENANT_KEY_PATTERN = /^[a-z][a-z0-9-]{2,38}[a-z0-9]$/;

const TRANSITIONS: Record<TenantStatus, readonly TenantStatus[]> = {
  provisioning: ["active", "archived"],
  active: ["suspended", "archived"],
  suspended: ["active", "archived"],
  archived: [],
};

export interface TenantQuotas {
  readonly users: number;
  readonly roles: number;
  readonly referenceSets: number;
  readonly webhooks: number;
  readonly featureFlags: number;
  readonly apiRequestsPerMinute: number;
}

export type QuotaResource = keyof TenantQuotas;

export const PLAN_QUOTAS: Record<TenantPlan, TenantQuotas> = {
  trial: {
    users: 10,
    roles: 5,
    referenceSets: 10,
    webhooks: 2,
    featureFlags: 20,
    apiRequestsPerMinute: 120,
  },
  standard: {
    users: 250,
    roles: 25,
    referenceSets: 100,
    webhooks: 20,
    featureFlags: 200,
    apiRequestsPerMinute: 1_200,
  },
  enterprise: {
    users: 10_000,
    roles: 200,
    referenceSets: 1_000,
    webhooks: 200,
    featureFlags: 2_000,
    apiRequestsPerMinute: 12_000,
  },
};

export interface TenantSettings {
  readonly locale: string;
  readonly timeZone: string;
  readonly defaultCurrency: string;
  readonly fiscalYearStartMonth: number;
  readonly dataResidency: string;
  readonly supportEmail?: string;
}

export const DEFAULT_SETTINGS: TenantSettings = {
  locale: "en-US",
  timeZone: "UTC",
  defaultCurrency: "USD",
  fiscalYearStartMonth: 1,
  dataResidency: "eu-west",
};

export interface TenantContact {
  readonly kind: "billing" | "technical" | "security";
  readonly name: string;
  readonly email: string;
}

export interface TenantProps {
  key: string;
  name: string;
  status: TenantStatus;
  plan: TenantPlan;
  quotas: TenantQuotas;
  settings: TenantSettings;
  contacts: TenantContact[];
  suspensionReason?: string;
  activatedAt?: IsoDateTime;
  suspendedAt?: IsoDateTime;
  archivedAt?: IsoDateTime;
}

export interface CreateTenantInput {
  readonly key: string;
  readonly name: string;
  readonly plan?: TenantPlan;
  readonly settings?: Partial<TenantSettings>;
  readonly contacts?: readonly TenantContact[];
  /** Quota overrides negotiated outside the plan defaults. */
  readonly quotaOverrides?: Partial<TenantQuotas>;
}

const EMAIL_PATTERN = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/;

export class Tenant extends AggregateRoot<TenantProps> {
  static create(input: CreateTenantInput, existing?: Partial<EntityProps>): Tenant {
    const key = input.key.trim().toLowerCase();
    if (!TENANT_KEY_PATTERN.test(key)) {
      throw ValidationError.single(
        "key",
        "must be 4-40 lowercase characters: letters, digits and dashes, starting with a letter",
      );
    }
    if (input.name.trim().length < 2) {
      throw ValidationError.single("name", "must be at least 2 characters");
    }
    const plan = input.plan ?? "trial";
    if (!TENANT_PLANS.includes(plan)) {
      throw ValidationError.single("plan", `must be one of [${TENANT_PLANS.join(", ")}]`);
    }
    for (const contact of input.contacts ?? []) assertContact(contact);

    const settings = mergeSettings(DEFAULT_SETTINGS, input.settings);
    const tenant = new Tenant(
      key as unknown as TenantId,
      {
        key,
        name: input.name.trim(),
        status: "provisioning",
        plan,
        quotas: { ...PLAN_QUOTAS[plan], ...input.quotaOverrides },
        settings,
        contacts: [...(input.contacts ?? [])],
      },
      existing,
    );
    tenant.raise(
      envelope({
        eventType: AdminEventTypes.tenantProvisioned,
        aggregateType: "Tenant",
        aggregateId: tenant.id,
        tenantId: tenant.tenantId,
        payload: { key, name: tenant.props.name, plan },
      }),
    );
    return tenant;
  }

  get key(): string {
    return this.props.key;
  }
  get name(): string {
    return this.props.name;
  }
  get status(): TenantStatus {
    return this.props.status;
  }
  get plan(): TenantPlan {
    return this.props.plan;
  }
  get quotas(): TenantQuotas {
    return this.props.quotas;
  }
  get settings(): TenantSettings {
    return this.props.settings;
  }
  get contacts(): readonly TenantContact[] {
    return this.props.contacts;
  }

  /** Tenants stop serving traffic in every state except `active`. */
  get isOperational(): boolean {
    return this.props.status === "active";
  }

  rename(name: string): void {
    this.assertMutable();
    if (name.trim().length < 2) throw ValidationError.single("name", "must be at least 2 characters");
    this.props.name = name.trim();
    this.touch();
  }

  activate(occurredAt: IsoDateTime): void {
    this.transition("active");
    this.props.activatedAt = occurredAt;
    this.props.suspensionReason = undefined;
    const first = this.props.suspendedAt === undefined;
    this.raise(
      envelope({
        eventType: first ? AdminEventTypes.tenantActivated : AdminEventTypes.tenantResumed,
        aggregateType: "Tenant",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { key: this.props.key, activatedAt: occurredAt },
      }),
    );
  }

  suspend(reason: string, occurredAt: IsoDateTime): void {
    if (reason.trim().length === 0) {
      throw ValidationError.single("reason", "a suspension reason is required");
    }
    this.transition("suspended");
    this.props.suspensionReason = reason.trim();
    this.props.suspendedAt = occurredAt;
    this.raise(
      envelope({
        eventType: AdminEventTypes.tenantSuspended,
        aggregateType: "Tenant",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { key: this.props.key, reason: this.props.suspensionReason },
      }),
    );
  }

  archive(occurredAt: IsoDateTime): void {
    this.transition("archived");
    this.props.archivedAt = occurredAt;
    this.raise(
      envelope({
        eventType: AdminEventTypes.tenantArchived,
        aggregateType: "Tenant",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { key: this.props.key, archivedAt: occurredAt },
      }),
    );
  }

  /**
   * Moving plan resets quotas to the new plan's defaults, then re-applies any
   * negotiated overrides the caller passes. Downgrades that would put current
   * usage over the new ceiling are rejected by the application service, which
   * is the only layer that knows current usage.
   */
  changePlan(plan: TenantPlan, overrides?: Partial<TenantQuotas>): void {
    this.assertMutable();
    if (!TENANT_PLANS.includes(plan)) {
      throw ValidationError.single("plan", `must be one of [${TENANT_PLANS.join(", ")}]`);
    }
    if (plan === this.props.plan && overrides === undefined) return;
    const previous = this.props.plan;
    this.props.plan = plan;
    this.props.quotas = { ...PLAN_QUOTAS[plan], ...overrides };
    this.raise(
      envelope({
        eventType: AdminEventTypes.tenantPlanChanged,
        aggregateType: "Tenant",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { key: this.props.key, from: previous, to: plan, quotas: this.props.quotas },
      }),
    );
  }

  updateSettings(patch: Partial<TenantSettings>): void {
    this.assertMutable();
    const merged = mergeSettings(this.props.settings, patch);
    this.props.settings = merged;
    this.raise(
      envelope({
        eventType: AdminEventTypes.tenantSettingsUpdated,
        aggregateType: "Tenant",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { key: this.props.key, settings: merged },
      }),
    );
  }

  setContact(contact: TenantContact): void {
    this.assertMutable();
    assertContact(contact);
    const others = this.props.contacts.filter((c) => c.kind !== contact.kind);
    this.props.contacts = [...others, contact].sort((a, b) => a.kind.localeCompare(b.kind));
    this.touch();
  }

  /** Throws when adding one more `resource` would breach the plan quota. */
  assertWithinQuota(resource: QuotaResource, currentCount: number): void {
    const limit = this.props.quotas[resource];
    if (currentCount >= limit) throw new QuotaExceededError(resource, limit, currentCount);
  }

  canTransitionTo(status: TenantStatus): boolean {
    return TRANSITIONS[this.props.status].includes(status);
  }

  private transition(to: TenantStatus): void {
    if (!this.canTransitionTo(to)) {
      throw new InvalidStateError(
        `Tenant ${this.props.key} cannot move from ${this.props.status} to ${to}`,
        { from: this.props.status, to, allowed: TRANSITIONS[this.props.status] },
      );
    }
    this.props.status = to;
  }

  private assertMutable(): void {
    if (this.props.status === "archived") {
      throw new InvalidStateError(`Tenant ${this.props.key} is archived and read-only`);
    }
  }
}

export function mergeSettings(
  base: TenantSettings,
  patch?: Partial<TenantSettings>,
): TenantSettings {
  const merged = { ...base, ...(patch ?? {}) };
  if (merged.fiscalYearStartMonth < 1 || merged.fiscalYearStartMonth > 12) {
    throw ValidationError.single("settings.fiscalYearStartMonth", "must be between 1 and 12");
  }
  if (!/^[a-z]{2}-[A-Z]{2}$/.test(merged.locale)) {
    throw ValidationError.single("settings.locale", 'must look like "en-US"');
  }
  if (!/^[A-Z]{3}$/.test(merged.defaultCurrency)) {
    throw ValidationError.single("settings.defaultCurrency", "must be a 3-letter ISO code");
  }
  if (merged.supportEmail !== undefined && !EMAIL_PATTERN.test(merged.supportEmail)) {
    throw ValidationError.single("settings.supportEmail", "must be a valid email address");
  }
  return merged;
}

function assertContact(contact: TenantContact): void {
  if (!["billing", "technical", "security"].includes(contact.kind)) {
    throw ValidationError.single("contacts.kind", "must be billing, technical or security");
  }
  if (!EMAIL_PATTERN.test(contact.email)) {
    throw ValidationError.single("contacts.email", `"${contact.email}" is not a valid address`);
  }
  if (contact.name.trim().length === 0) {
    throw ValidationError.single("contacts.name", "is required");
  }
}
