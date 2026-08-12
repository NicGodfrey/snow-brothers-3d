import {
  AggregateRoot,
  envelope,
  type EntityProps,
  type Email,
  type IsoDateTime,
  type TenantId,
  type UserId,
} from "@enterprise-suite/shared-kernel";
import { InvalidStateError, PolicyViolationError, ValidationError } from "./errors.js";
import { ChannelEventTypes } from "./events.js";
import { normalizeProductLine, normalizeProductLines, normalizeTerritory, territoryCovers } from "./territory.js";

/**
 * Channel-side partner profile.
 *
 * `prm-core` owns the commercial partner master (legal entity, contracts, MDF
 * budgets). Channel PRM keeps its own profile because every decision this
 * context makes — may they register here, how long is their protection, what
 * discount is inside the band — depends on partner state at decision time, and
 * that cannot hang on a synchronous call to another service. The profile is
 * fed by `prm.partner.*` events upstream and is authoritative for channel
 * eligibility only.
 */

export type PartnerTier = "registered" | "silver" | "gold" | "platinum";

export const PARTNER_TIERS: readonly PartnerTier[] = ["registered", "silver", "gold", "platinum"];

export const TIER_RANK: Readonly<Record<PartnerTier, number>> = {
  registered: 0,
  silver: 1,
  gold: 2,
  platinum: 3,
};

export type PartnerType = "reseller" | "distributor" | "referral_agent" | "msp" | "system_integrator" | "isv";

export const PARTNER_TYPES: readonly PartnerType[] = [
  "reseller",
  "distributor",
  "referral_agent",
  "msp",
  "system_integrator",
  "isv",
];

export type PartnerStatus = "onboarding" | "active" | "suspended" | "terminated";

export const PARTNER_STATUSES: readonly PartnerStatus[] = ["onboarding", "active", "suspended", "terminated"];

/**
 * The commercial parameters a tier buys. One record drives protection length,
 * extension head-room, discount authority, referral commission and the
 * auto-approval threshold, so tier changes are a single edit rather than a
 * scatter of constants.
 */
export interface TierPolicy {
  readonly tier: PartnerTier;
  /** Protection granted on approval. */
  readonly protectionDays: number;
  readonly maxExtensionDays: number;
  readonly maxExtensions: number;
  /** How long the channel team has to decide before the deal escalates. */
  readonly approvalSlaHours: number;
  /** Discount any deal from this tier gets, registered or not. */
  readonly baseDiscountBps: number;
  /** Discount applied automatically to an approved registered deal. */
  readonly registeredDiscountBps: number;
  /** Ceiling a channel manager may approve on a protected registered deal. */
  readonly maxDiscountBps: number;
  readonly referralCommissionBps: number;
  /** Deals below this value auto-approve when clean (no conflict, in territory). */
  readonly autoApproveBelowMinor: number;
  /** Days after expiry in which protection can still be renewed. */
  readonly renewalGraceDays: number;
  /** Hours a conflict case may sit before escalation. */
  readonly conflictSlaHours: number;
}

export const DEFAULT_TIER_POLICIES: Readonly<Record<PartnerTier, TierPolicy>> = {
  registered: {
    tier: "registered",
    protectionDays: 30,
    maxExtensionDays: 15,
    maxExtensions: 1,
    approvalSlaHours: 72,
    baseDiscountBps: 150,
    registeredDiscountBps: 300,
    maxDiscountBps: 500,
    referralCommissionBps: 300,
    autoApproveBelowMinor: 500_000,
    renewalGraceDays: 5,
    conflictSlaHours: 120,
  },
  silver: {
    tier: "silver",
    protectionDays: 60,
    maxExtensionDays: 30,
    maxExtensions: 2,
    approvalSlaHours: 48,
    baseDiscountBps: 300,
    registeredDiscountBps: 600,
    maxDiscountBps: 1_000,
    referralCommissionBps: 500,
    autoApproveBelowMinor: 2_500_000,
    renewalGraceDays: 7,
    conflictSlaHours: 96,
  },
  gold: {
    tier: "gold",
    protectionDays: 90,
    maxExtensionDays: 45,
    maxExtensions: 2,
    approvalSlaHours: 24,
    baseDiscountBps: 500,
    registeredDiscountBps: 1_000,
    maxDiscountBps: 1_800,
    referralCommissionBps: 700,
    autoApproveBelowMinor: 10_000_000,
    renewalGraceDays: 10,
    conflictSlaHours: 72,
  },
  platinum: {
    tier: "platinum",
    protectionDays: 120,
    maxExtensionDays: 60,
    maxExtensions: 3,
    approvalSlaHours: 12,
    baseDiscountBps: 800,
    registeredDiscountBps: 1_500,
    maxDiscountBps: 2_500,
    referralCommissionBps: 1_000,
    autoApproveBelowMinor: 25_000_000,
    renewalGraceDays: 14,
    conflictSlaHours: 48,
  },
};

export function validateTierPolicy(policy: TierPolicy): TierPolicy {
  const issues = [];
  if (!Number.isInteger(policy.protectionDays) || policy.protectionDays < 1 || policy.protectionDays > 365) {
    issues.push({ field: "protectionDays", message: "must be an integer between 1 and 365" });
  }
  if (policy.maxExtensionDays < 0 || policy.maxExtensionDays > 180) {
    issues.push({ field: "maxExtensionDays", message: "must be between 0 and 180" });
  }
  if (policy.maxExtensions < 0 || policy.maxExtensions > 6) {
    issues.push({ field: "maxExtensions", message: "must be between 0 and 6" });
  }
  if (policy.maxDiscountBps < 0 || policy.maxDiscountBps > 9_000) {
    issues.push({ field: "maxDiscountBps", message: "must be between 0 and 9000 basis points" });
  }
  if (policy.registeredDiscountBps > policy.maxDiscountBps) {
    issues.push({
      field: "registeredDiscountBps",
      message: "cannot exceed maxDiscountBps — the automatic discount must sit inside the band",
    });
  }
  if (policy.baseDiscountBps > policy.registeredDiscountBps) {
    issues.push({
      field: "baseDiscountBps",
      message: "cannot exceed registeredDiscountBps — registering a deal must be worth more than not registering it",
    });
  }
  if (policy.referralCommissionBps < 0 || policy.referralCommissionBps > 5_000) {
    issues.push({ field: "referralCommissionBps", message: "must be between 0 and 5000 basis points" });
  }
  if (policy.autoApproveBelowMinor < 0 || !Number.isInteger(policy.autoApproveBelowMinor)) {
    issues.push({ field: "autoApproveBelowMinor", message: "must be a non-negative integer of minor units" });
  }
  if (issues.length > 0) throw ValidationError.fromIssues(`Invalid tier policy for ${policy.tier}`, issues);
  return policy;
}

export interface PartnerContact {
  readonly name: string;
  readonly email: Email;
  readonly phone?: string;
}

export interface PartnerProps {
  code: string;
  name: string;
  tier: PartnerTier;
  type: PartnerType;
  status: PartnerStatus;
  territories: string[];
  productLines: string[];
  contact: PartnerContact;
  /** Currency the partner transacts in; commissions are paid in it. */
  currency: string;
  onboardedAt?: IsoDateTime;
  statusReason?: string;
  tierChangedAt?: IsoDateTime;
  /** Free-form channel-manager ownership, used for work queues. */
  channelManagerId?: UserId;
}

export interface CreatePartnerInput {
  readonly code: string;
  readonly name: string;
  readonly tier?: PartnerTier;
  readonly type: PartnerType;
  readonly territories: readonly string[];
  readonly productLines: readonly string[];
  readonly contact: PartnerContact;
  readonly currency?: string;
  readonly channelManagerId?: UserId;
}

export class Partner extends AggregateRoot<PartnerProps> {
  static create(tenantId: TenantId, input: CreatePartnerInput): Partner {
    const code = input.code.trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9-]{1,23}$/.test(code)) {
      throw ValidationError.single("code", "must be 2-24 chars of A-Z, 0-9 and dashes");
    }
    if (input.name.trim().length < 2) {
      throw ValidationError.single("name", "must be at least 2 characters");
    }
    if (!PARTNER_TYPES.includes(input.type)) {
      throw ValidationError.single("type", `must be one of [${PARTNER_TYPES.join(", ")}]`);
    }
    if (!input.contact?.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.contact.email)) {
      throw ValidationError.single("contact.email", "must be a valid email address");
    }
    if (input.territories.length === 0) {
      throw ValidationError.single("territories", "at least one territory grant is required");
    }
    const currency = (input.currency ?? "USD").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw ValidationError.single("currency", "must be a 3-letter ISO currency code");
    }

    const partner = new Partner(tenantId, {
      code,
      name: input.name.trim(),
      tier: input.tier ?? "registered",
      type: input.type,
      status: "onboarding",
      territories: [...new Set(input.territories.map(normalizeTerritory))].sort(),
      productLines: normalizeProductLines(input.productLines),
      contact: {
        name: input.contact.name.trim(),
        email: input.contact.email.trim().toLowerCase() as Email,
        phone: input.contact.phone?.trim() || undefined,
      },
      currency,
      channelManagerId: input.channelManagerId,
    });
    partner.raise(
      envelope({
        eventType: ChannelEventTypes.PartnerRegistered,
        aggregateType: "Partner",
        aggregateId: partner.id,
        tenantId,
        payload: {
          partnerId: partner.id,
          code: partner.props.code,
          name: partner.props.name,
          tier: partner.props.tier,
          type: partner.props.type,
          territories: partner.props.territories,
          productLines: partner.props.productLines,
        },
      }),
    );
    return partner;
  }

  static fromSnapshot(snapshot: EntityProps & PartnerProps): Partner {
    const { id, tenantId, createdAt, updatedAt, version, ...props } = snapshot;
    return new Partner(
      tenantId,
      { ...props, territories: [...props.territories], productLines: [...props.productLines] },
      { id, createdAt, updatedAt, version },
    );
  }

  get code(): string {
    return this.props.code;
  }
  get name(): string {
    return this.props.name;
  }
  get tier(): PartnerTier {
    return this.props.tier;
  }
  get type(): PartnerType {
    return this.props.type;
  }
  get status(): PartnerStatus {
    return this.props.status;
  }
  get territories(): readonly string[] {
    return this.props.territories;
  }
  get productLines(): readonly string[] {
    return this.props.productLines;
  }
  get currency(): string {
    return this.props.currency;
  }
  get channelManagerId(): UserId | undefined {
    return this.props.channelManagerId;
  }

  /** Referral agents introduce deals but never transact; they cannot resell. */
  get canTransact(): boolean {
    return this.props.type !== "referral_agent";
  }

  coversTerritory(country: string): boolean {
    return territoryCovers(this.props.territories, country);
  }

  sellsProductLine(line: string): boolean {
    return this.props.productLines.includes(normalizeProductLine(line));
  }

  unauthorizedProductLines(lines: readonly string[]): string[] {
    return lines.map(normalizeProductLine).filter((line) => !this.props.productLines.includes(line));
  }

  /** Throws unless the partner is active — used before every channel command. */
  assertActive(action: string): void {
    if (this.props.status !== "active") {
      throw new PolicyViolationError(
        `Partner ${this.props.code} is ${this.props.status}; cannot ${action}`,
        "partner.status",
        { status: this.props.status, reason: this.props.statusReason },
      );
    }
  }

  activate(at: IsoDateTime): void {
    if (this.props.status === "terminated") {
      throw new InvalidStateError(`Partner ${this.props.code} is terminated and cannot be reactivated`);
    }
    if (this.props.status === "active") return;
    this.changeStatus("active", at);
  }

  suspend(reason: string, at: IsoDateTime): void {
    if (reason.trim().length === 0) throw ValidationError.single("reason", "a suspension reason is required");
    if (this.props.status === "terminated") {
      throw new InvalidStateError(`Partner ${this.props.code} is already terminated`);
    }
    this.changeStatus("suspended", at, reason.trim());
  }

  terminate(reason: string, at: IsoDateTime): void {
    if (reason.trim().length === 0) throw ValidationError.single("reason", "a termination reason is required");
    this.changeStatus("terminated", at, reason.trim());
  }

  changeTier(tier: PartnerTier, at: IsoDateTime, reason?: string): void {
    if (!PARTNER_TIERS.includes(tier)) {
      throw ValidationError.single("tier", `must be one of [${PARTNER_TIERS.join(", ")}]`);
    }
    if (this.props.status === "terminated") {
      throw new InvalidStateError(`Partner ${this.props.code} is terminated; tier is frozen`);
    }
    if (tier === this.props.tier) return;
    const from = this.props.tier;
    this.props.tier = tier;
    this.props.tierChangedAt = at;
    this.raise(
      envelope({
        eventType: ChannelEventTypes.PartnerTierChanged,
        aggregateType: "Partner",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { partnerId: this.id, code: this.props.code, from, to: tier, reason: reason?.trim() },
      }),
    );
  }

  /**
   * Replaces the authorization grants. Narrowing them does not retro-actively
   * invalidate approved registrations — protection already granted is honoured
   * to the end of its window; only new registrations see the new grants.
   */
  setAuthorizations(input: { territories?: readonly string[]; productLines?: readonly string[] }): void {
    if (input.territories) {
      if (input.territories.length === 0) {
        throw ValidationError.single("territories", "at least one territory grant is required");
      }
      this.props.territories = [...new Set(input.territories.map(normalizeTerritory))].sort();
    }
    if (input.productLines) {
      this.props.productLines = normalizeProductLines(input.productLines);
    }
    this.raise(
      envelope({
        eventType: ChannelEventTypes.PartnerAuthorizationsChanged,
        aggregateType: "Partner",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          partnerId: this.id,
          code: this.props.code,
          territories: this.props.territories,
          productLines: this.props.productLines,
        },
      }),
    );
  }

  assignChannelManager(userId: UserId): void {
    this.props.channelManagerId = userId;
    this.touch();
  }

  private changeStatus(to: PartnerStatus, at: IsoDateTime, reason?: string): void {
    const from = this.props.status;
    this.props.status = to;
    this.props.statusReason = reason;
    if (to === "active" && !this.props.onboardedAt) this.props.onboardedAt = at;
    this.raise(
      envelope({
        eventType: ChannelEventTypes.PartnerStatusChanged,
        aggregateType: "Partner",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { partnerId: this.id, code: this.props.code, from, to, reason },
      }),
    );
  }
}
