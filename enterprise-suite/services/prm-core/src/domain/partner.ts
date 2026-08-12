import {
  AggregateRoot,
  envelope,
  newId,
  type EntityProps,
  type IsoDateTime,
  type TenantId,
  type Ulid,
  type UserId,
} from "@enterprise-suite/shared-kernel";
import { InvalidStateError, ValidationError, type ValidationIssue } from "./errors.js";
import { PrmEventTypes } from "./events.js";

/**
 * Partner aggregate: the channel account.
 *
 * Onboarding is a state machine, not a flag:
 *
 *   prospect → applied → in_review → approved → active
 *                  \          \          \        ↕ suspended
 *                   \          \          \→ rejected
 *                    \→ rejected           → terminated (terminal)
 *
 * Contacts, addresses, territories and specializations live inside the
 * aggregate because their invariants are partner-local (one primary contact,
 * one headquarters, unique emails). Anything that spans partners — contracts,
 * MDF, certifications, portal users — is its own aggregate and only referenced
 * by id, so those can be transacted independently.
 */

export type PartnerType =
  | "reseller"
  | "distributor"
  | "var"
  | "systems_integrator"
  | "isv"
  | "referral"
  | "msp";

export const PARTNER_TYPES: readonly PartnerType[] = [
  "reseller",
  "distributor",
  "var",
  "systems_integrator",
  "isv",
  "referral",
  "msp",
];

export type PartnerStatus =
  | "prospect"
  | "applied"
  | "in_review"
  | "approved"
  | "active"
  | "suspended"
  | "rejected"
  | "terminated";

export const PARTNER_STATUSES: readonly PartnerStatus[] = [
  "prospect",
  "applied",
  "in_review",
  "approved",
  "active",
  "suspended",
  "rejected",
  "terminated",
];

/** Legal transitions; anything else is an InvalidStateError. */
const PARTNER_TRANSITIONS: Readonly<Record<PartnerStatus, readonly PartnerStatus[]>> = {
  prospect: ["applied"],
  applied: ["in_review", "rejected"],
  in_review: ["approved", "rejected"],
  approved: ["active", "rejected"],
  active: ["suspended", "terminated"],
  suspended: ["active", "terminated"],
  // A rejected applicant may re-apply with a fresh application.
  rejected: ["applied"],
  terminated: [],
};

export type ContactRole = "primary" | "billing" | "technical" | "marketing" | "executive";

export const CONTACT_ROLES: readonly ContactRole[] = [
  "primary",
  "billing",
  "technical",
  "marketing",
  "executive",
];

export type AddressKind = "headquarters" | "billing" | "shipping";

export const ADDRESS_KINDS: readonly AddressKind[] = ["headquarters", "billing", "shipping"];

export interface PartnerContact {
  readonly id: Ulid;
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly phone?: string;
  readonly role: ContactRole;
  readonly jobTitle?: string;
}

export interface PartnerAddress {
  readonly id: Ulid;
  readonly kind: AddressKind;
  readonly line1: string;
  readonly line2?: string;
  readonly city: string;
  readonly region?: string;
  readonly postalCode: string;
  readonly countryCode: string;
}

export interface TierAssignment {
  readonly tierCode: string;
  readonly rank: number;
  readonly direction: "initial" | "upgrade" | "downgrade";
  readonly reason: string;
  readonly effectiveAt: IsoDateTime;
  readonly assignedBy: UserId;
}

export interface PartnerProps {
  number: string;
  legalName: string;
  displayName: string;
  type: PartnerType;
  status: PartnerStatus;
  countryCode: string;
  currency: string;
  /** Tier-2 partners sit under a distributor; distributors have no parent. */
  parentPartnerId?: Ulid;
  websiteUrl?: string;
  taxId?: string;
  channelManagerId?: UserId;
  tierCode?: string;
  tierRank: number;
  tierAssignedAt?: IsoDateTime;
  tierHistory: TierAssignment[];
  territories: string[];
  specializations: string[];
  addresses: PartnerAddress[];
  contacts: PartnerContact[];
  applicationSubmittedAt?: IsoDateTime;
  reviewStartedAt?: IsoDateTime;
  decidedAt?: IsoDateTime;
  decidedBy?: UserId;
  decisionNotes?: string;
  activatedAt?: IsoDateTime;
  suspendedAt?: IsoDateTime;
  suspensionReason?: string;
  terminatedAt?: IsoDateTime;
  terminationReason?: string;
}

export interface CreatePartnerInput {
  readonly number: string;
  readonly legalName: string;
  readonly displayName?: string;
  readonly type: PartnerType;
  readonly countryCode: string;
  readonly currency?: string;
  readonly parentPartnerId?: Ulid;
  readonly websiteUrl?: string;
  readonly taxId?: string;
  readonly channelManagerId?: UserId;
  readonly territories?: readonly string[];
  readonly specializations?: readonly string[];
}

export interface AddContactInput {
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly phone?: string;
  readonly role: ContactRole;
  readonly jobTitle?: string;
}

export interface AddAddressInput {
  readonly kind: AddressKind;
  readonly line1: string;
  readonly line2?: string;
  readonly city: string;
  readonly region?: string;
  readonly postalCode: string;
  readonly countryCode: string;
}

export interface UpdatePartnerProfileInput {
  readonly legalName?: string;
  readonly displayName?: string;
  readonly websiteUrl?: string;
  readonly taxId?: string;
  readonly channelManagerId?: UserId;
  readonly specializations?: readonly string[];
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COUNTRY_PATTERN = /^[A-Z]{2}$/;
/** ISO country code or a program region such as EMEA-NORTH. */
const TERRITORY_PATTERN = /^[A-Z]{2}(-[A-Z0-9]{1,8})?$/;

function normalizeCountry(value: string, field: string): string {
  const code = value.trim().toUpperCase();
  if (!COUNTRY_PATTERN.test(code)) {
    throw ValidationError.single(field, "must be a 2-letter ISO country code");
  }
  return code;
}

function normalizeTerritory(value: string): string {
  const code = value.trim().toUpperCase();
  if (!TERRITORY_PATTERN.test(code)) {
    throw ValidationError.single("territory", 'must look like "DE" or "EMEA-NORTH"');
  }
  return code;
}

function normalizeEmail(value: string, field = "email"): string {
  const email = value.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw ValidationError.single(field, "must be a valid email address");
  return email;
}

export class Partner extends AggregateRoot<PartnerProps> {
  static create(tenantId: TenantId, input: CreatePartnerInput): Partner {
    const issues: ValidationIssue[] = [];
    const legalName = input.legalName.trim();
    if (legalName.length < 2) issues.push({ field: "legalName", message: "must be at least 2 characters" });
    if (!PARTNER_TYPES.includes(input.type)) {
      issues.push({ field: "type", message: `must be one of [${PARTNER_TYPES.join(", ")}]` });
    }
    if (input.websiteUrl !== undefined && !/^https?:\/\/\S+$/.test(input.websiteUrl.trim())) {
      issues.push({ field: "websiteUrl", message: "must be an http(s) URL" });
    }
    if (issues.length > 0) throw new ValidationError("Invalid partner", issues);

    const currency = (input.currency ?? "USD").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw ValidationError.single("currency", "must be a 3-letter ISO currency code");
    }
    if (input.type === "distributor" && input.parentPartnerId !== undefined) {
      throw ValidationError.single("parentPartnerId", "a distributor cannot sit under another partner");
    }

    const partner = new Partner(tenantId, {
      number: input.number,
      legalName,
      displayName: (input.displayName ?? legalName).trim(),
      type: input.type,
      status: "prospect",
      countryCode: normalizeCountry(input.countryCode, "countryCode"),
      currency,
      parentPartnerId: input.parentPartnerId,
      websiteUrl: input.websiteUrl?.trim(),
      taxId: input.taxId?.trim(),
      channelManagerId: input.channelManagerId,
      tierRank: 0,
      tierHistory: [],
      territories: [...new Set((input.territories ?? []).map(normalizeTerritory))],
      specializations: [...new Set((input.specializations ?? []).map((s) => s.trim().toLowerCase()))],
      addresses: [],
      contacts: [],
    });
    partner.raise(
      envelope({
        eventType: PrmEventTypes.PartnerRegistered,
        aggregateType: "Partner",
        aggregateId: partner.id,
        tenantId,
        payload: {
          partnerId: partner.id,
          number: partner.props.number,
          legalName: partner.props.legalName,
          type: partner.props.type,
          countryCode: partner.props.countryCode,
          currency: partner.props.currency,
          parentPartnerId: partner.props.parentPartnerId,
        },
      }),
    );
    return partner;
  }

  static fromSnapshot(snapshot: EntityProps & PartnerProps): Partner {
    const { id, tenantId, createdAt, updatedAt, version, ...props } = snapshot;
    return new Partner(
      tenantId,
      {
        ...props,
        tierHistory: [...props.tierHistory],
        territories: [...props.territories],
        specializations: [...props.specializations],
        addresses: [...props.addresses],
        contacts: [...props.contacts],
      },
      { id, createdAt, updatedAt, version },
    );
  }

  // --- accessors -------------------------------------------------------------

  get number(): string {
    return this.props.number;
  }
  get legalName(): string {
    return this.props.legalName;
  }
  get displayName(): string {
    return this.props.displayName;
  }
  get type(): PartnerType {
    return this.props.type;
  }
  get status(): PartnerStatus {
    return this.props.status;
  }
  get currency(): string {
    return this.props.currency;
  }
  get countryCode(): string {
    return this.props.countryCode;
  }
  get parentPartnerId(): Ulid | undefined {
    return this.props.parentPartnerId;
  }
  get tierCode(): string | undefined {
    return this.props.tierCode;
  }
  get tierRank(): number {
    return this.props.tierRank;
  }
  get tierHistory(): readonly TierAssignment[] {
    return this.props.tierHistory;
  }
  get contacts(): readonly PartnerContact[] {
    return this.props.contacts;
  }
  get addresses(): readonly PartnerAddress[] {
    return this.props.addresses;
  }
  get territories(): readonly string[] {
    return this.props.territories;
  }
  get specializations(): readonly string[] {
    return this.props.specializations;
  }
  get activatedAt(): IsoDateTime | undefined {
    return this.props.activatedAt;
  }
  get channelManagerId(): UserId | undefined {
    return this.props.channelManagerId;
  }

  /** Trading is allowed only while active — everything else is read-only access. */
  isTrading(): boolean {
    return this.props.status === "active";
  }

  primaryContact(): PartnerContact | undefined {
    return this.props.contacts.find((c) => c.role === "primary");
  }

  headquarters(): PartnerAddress | undefined {
    return this.props.addresses.find((a) => a.kind === "headquarters");
  }

  coversTerritory(code: string): boolean {
    const wanted = code.trim().toUpperCase();
    return this.props.territories.some((t) => t === wanted || wanted.startsWith(`${t}-`));
  }

  // --- profile ---------------------------------------------------------------

  updateProfile(input: UpdatePartnerProfileInput): void {
    this.assertMutable("update the profile");
    if (input.legalName !== undefined) {
      const legalName = input.legalName.trim();
      if (legalName.length < 2) throw ValidationError.single("legalName", "must be at least 2 characters");
      this.props.legalName = legalName;
    }
    if (input.displayName !== undefined) {
      const displayName = input.displayName.trim();
      if (displayName.length === 0) throw ValidationError.single("displayName", "must not be empty");
      this.props.displayName = displayName;
    }
    if (input.websiteUrl !== undefined) {
      const url = input.websiteUrl.trim();
      if (url.length > 0 && !/^https?:\/\/\S+$/.test(url)) {
        throw ValidationError.single("websiteUrl", "must be an http(s) URL");
      }
      this.props.websiteUrl = url.length > 0 ? url : undefined;
    }
    if (input.taxId !== undefined) this.props.taxId = input.taxId.trim() || undefined;
    if (input.channelManagerId !== undefined) this.props.channelManagerId = input.channelManagerId;
    if (input.specializations !== undefined) {
      this.props.specializations = [...new Set(input.specializations.map((s) => s.trim().toLowerCase()))];
    }
    this.raise(
      envelope({
        eventType: PrmEventTypes.PartnerProfileUpdated,
        aggregateType: "Partner",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          partnerId: this.id,
          number: this.props.number,
          legalName: this.props.legalName,
        },
      }),
    );
  }

  addTerritory(code: string): void {
    this.assertMutable("change territories");
    const territory = normalizeTerritory(code);
    if (this.props.territories.includes(territory)) {
      throw new InvalidStateError(`Territory ${territory} is already assigned to ${this.props.number}`);
    }
    this.props.territories.push(territory);
    this.touch();
  }

  removeTerritory(code: string): void {
    this.assertMutable("change territories");
    const territory = normalizeTerritory(code);
    const index = this.props.territories.indexOf(territory);
    if (index === -1) throw new InvalidStateError(`Territory ${territory} is not assigned`);
    if (this.props.territories.length === 1 && this.props.status === "active") {
      throw new InvalidStateError("An active partner must keep at least one territory");
    }
    this.props.territories.splice(index, 1);
    this.touch();
  }

  addAddress(input: AddAddressInput): PartnerAddress {
    this.assertMutable("add an address");
    if (input.kind === "headquarters" && this.headquarters()) {
      throw new InvalidStateError(`${this.props.number} already has a headquarters address`);
    }
    const issues: ValidationIssue[] = [];
    if (input.line1.trim().length === 0) issues.push({ field: "line1", message: "is required" });
    if (input.city.trim().length === 0) issues.push({ field: "city", message: "is required" });
    if (input.postalCode.trim().length === 0) issues.push({ field: "postalCode", message: "is required" });
    if (issues.length > 0) throw new ValidationError("Invalid address", issues);
    const address: PartnerAddress = {
      id: newId("addr"),
      kind: input.kind,
      line1: input.line1.trim(),
      line2: input.line2?.trim() || undefined,
      city: input.city.trim(),
      region: input.region?.trim() || undefined,
      postalCode: input.postalCode.trim(),
      countryCode: normalizeCountry(input.countryCode, "countryCode"),
    };
    this.props.addresses.push(address);
    this.touch();
    return address;
  }

  removeAddress(addressId: Ulid): void {
    this.assertMutable("remove an address");
    const index = this.props.addresses.findIndex((a) => a.id === addressId);
    if (index === -1) throw new InvalidStateError(`Address ${addressId} not found`);
    if (this.props.addresses[index]!.kind === "headquarters" && this.props.status !== "prospect") {
      throw new InvalidStateError("The headquarters address cannot be removed after the application is filed");
    }
    this.props.addresses.splice(index, 1);
    this.touch();
  }

  addContact(input: AddContactInput): PartnerContact {
    this.assertMutable("add a contact");
    const email = normalizeEmail(input.email);
    if (this.props.contacts.some((c) => c.email === email)) {
      throw new InvalidStateError(`Contact ${email} already exists on ${this.props.number}`);
    }
    if (!CONTACT_ROLES.includes(input.role)) {
      throw ValidationError.single("role", `must be one of [${CONTACT_ROLES.join(", ")}]`);
    }
    if (input.role === "primary" && this.primaryContact()) {
      throw new InvalidStateError(
        `${this.props.number} already has a primary contact; promote the new one instead`,
      );
    }
    const issues: ValidationIssue[] = [];
    if (input.firstName.trim().length === 0) issues.push({ field: "firstName", message: "is required" });
    if (input.lastName.trim().length === 0) issues.push({ field: "lastName", message: "is required" });
    if (issues.length > 0) throw new ValidationError("Invalid contact", issues);

    const contact: PartnerContact = {
      id: newId("cont"),
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      email,
      phone: input.phone?.trim() || undefined,
      role: input.role,
      jobTitle: input.jobTitle?.trim() || undefined,
    };
    this.props.contacts.push(contact);
    this.raise(
      envelope({
        eventType: PrmEventTypes.PartnerContactAdded,
        aggregateType: "Partner",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { partnerId: this.id, contactId: contact.id, email: contact.email, role: contact.role },
      }),
    );
    return contact;
  }

  /** Moves the primary role to another existing contact; the old one becomes executive. */
  promoteToPrimary(contactId: Ulid): void {
    this.assertMutable("change the primary contact");
    const index = this.props.contacts.findIndex((c) => c.id === contactId);
    if (index === -1) throw new InvalidStateError(`Contact ${contactId} not found`);
    const previous = this.props.contacts.findIndex((c) => c.role === "primary");
    if (previous === index) return;
    if (previous >= 0) {
      this.props.contacts[previous] = { ...this.props.contacts[previous]!, role: "executive" };
    }
    this.props.contacts[index] = { ...this.props.contacts[index]!, role: "primary" };
    this.touch();
  }

  removeContact(contactId: Ulid): void {
    this.assertMutable("remove a contact");
    const index = this.props.contacts.findIndex((c) => c.id === contactId);
    if (index === -1) throw new InvalidStateError(`Contact ${contactId} not found`);
    const contact = this.props.contacts[index]!;
    if (contact.role === "primary" && this.props.status !== "prospect") {
      throw new InvalidStateError("The primary contact cannot be removed; promote a replacement first");
    }
    this.props.contacts.splice(index, 1);
    this.raise(
      envelope({
        eventType: PrmEventTypes.PartnerContactRemoved,
        aggregateType: "Partner",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { partnerId: this.id, contactId, email: contact.email },
      }),
    );
  }

  // --- onboarding ------------------------------------------------------------

  /**
   * Files the partner application. The completeness bar is deliberately here
   * rather than in the service: an application without a reachable primary
   * contact, a legal address and a territory cannot be reviewed at all.
   */
  submitApplication(at: IsoDateTime): void {
    this.assertTransition("applied");
    const issues: ValidationIssue[] = [];
    if (!this.primaryContact()) issues.push({ field: "contacts", message: "a primary contact is required" });
    if (!this.headquarters()) {
      issues.push({ field: "addresses", message: "a headquarters address is required" });
    }
    if (this.props.territories.length === 0) {
      issues.push({ field: "territories", message: "at least one territory is required" });
    }
    if (issues.length > 0) throw new ValidationError("Application is incomplete", issues);

    this.transition("applied");
    this.props.applicationSubmittedAt = at;
    this.props.decidedAt = undefined;
    this.props.decidedBy = undefined;
    this.props.decisionNotes = undefined;
    this.raise(
      this.statusEvent(PrmEventTypes.PartnerApplicationSubmitted, "prospect", "applied", undefined, undefined),
    );
  }

  startReview(at: IsoDateTime, reviewer: UserId): void {
    this.assertTransition("in_review");
    this.transition("in_review");
    this.props.reviewStartedAt = at;
    this.raise(this.statusEvent(PrmEventTypes.PartnerReviewStarted, "applied", "in_review", undefined, reviewer));
  }

  approve(at: IsoDateTime, by: UserId, notes?: string): void {
    this.assertTransition("approved");
    const from = this.props.status;
    this.transition("approved");
    this.props.decidedAt = at;
    this.props.decidedBy = by;
    this.props.decisionNotes = notes?.trim() || undefined;
    this.raise(this.statusEvent(PrmEventTypes.PartnerApproved, from, "approved", notes, by));
  }

  reject(at: IsoDateTime, by: UserId, reason: string): void {
    this.assertTransition("rejected");
    if (reason.trim().length === 0) throw ValidationError.single("reason", "a rejection reason is required");
    const from = this.props.status;
    this.transition("rejected");
    this.props.decidedAt = at;
    this.props.decidedBy = by;
    this.props.decisionNotes = reason.trim();
    this.raise(this.statusEvent(PrmEventTypes.PartnerRejected, from, "rejected", reason.trim(), by));
  }

  /**
   * Goes live. The signed-contract precondition is checked by the service
   * (it spans aggregates); here we only guard the state machine and stamp the
   * activation date that tier tenure is measured from.
   */
  activate(at: IsoDateTime, by: UserId): void {
    this.assertTransition("active");
    this.transition("active");
    this.props.activatedAt = this.props.activatedAt ?? at;
    this.props.suspendedAt = undefined;
    this.props.suspensionReason = undefined;
    this.raise(this.statusEvent(PrmEventTypes.PartnerActivated, "approved", "active", undefined, by));
  }

  suspend(at: IsoDateTime, by: UserId, reason: string): void {
    this.assertTransition("suspended");
    if (reason.trim().length === 0) throw ValidationError.single("reason", "a suspension reason is required");
    this.transition("suspended");
    this.props.suspendedAt = at;
    this.props.suspensionReason = reason.trim();
    this.raise(this.statusEvent(PrmEventTypes.PartnerSuspended, "active", "suspended", reason.trim(), by));
  }

  reinstate(by: UserId, note?: string): void {
    if (this.props.status !== "suspended") {
      throw new InvalidStateError(`${this.props.number} is ${this.props.status}, not suspended`);
    }
    this.transition("active");
    this.props.suspendedAt = undefined;
    this.props.suspensionReason = undefined;
    this.raise(this.statusEvent(PrmEventTypes.PartnerReinstated, "suspended", "active", note, by));
  }

  terminate(at: IsoDateTime, by: UserId, reason: string): void {
    this.assertTransition("terminated");
    if (reason.trim().length === 0) throw ValidationError.single("reason", "a termination reason is required");
    const from = this.props.status;
    this.transition("terminated");
    this.props.terminatedAt = at;
    this.props.terminationReason = reason.trim();
    this.props.tierCode = undefined;
    this.props.tierRank = 0;
    this.raise(this.statusEvent(PrmEventTypes.PartnerTerminated, from, "terminated", reason.trim(), by));
  }

  // --- tiering ---------------------------------------------------------------

  /**
   * Records a tier assignment. Eligibility is evaluated by the tier service
   * against the program definitions; the aggregate keeps the audit trail and
   * refuses tiering for partners that are not (yet) in business.
   */
  assignTier(input: {
    readonly tierCode: string;
    readonly rank: number;
    readonly reason: string;
    readonly effectiveAt: IsoDateTime;
    readonly assignedBy: UserId;
  }): TierAssignment {
    if (this.props.status !== "active" && this.props.status !== "approved") {
      throw new InvalidStateError(
        `${this.props.number} is ${this.props.status}; only approved or active partners can hold a tier`,
      );
    }
    if (input.reason.trim().length === 0) {
      throw ValidationError.single("reason", "a reason is required for the tier audit trail");
    }
    const tierCode = input.tierCode.trim().toLowerCase();
    if (this.props.tierCode === tierCode) {
      throw new InvalidStateError(`${this.props.number} is already ${tierCode}`);
    }
    const direction: TierAssignment["direction"] =
      this.props.tierCode === undefined ? "initial" : input.rank > this.props.tierRank ? "upgrade" : "downgrade";
    const assignment: TierAssignment = {
      tierCode,
      rank: input.rank,
      direction,
      reason: input.reason.trim(),
      effectiveAt: input.effectiveAt,
      assignedBy: input.assignedBy,
    };
    const fromTierCode = this.props.tierCode;
    this.props.tierHistory.push(assignment);
    this.props.tierCode = tierCode;
    this.props.tierRank = input.rank;
    this.props.tierAssignedAt = input.effectiveAt;
    this.raise(
      envelope({
        eventType: PrmEventTypes.PartnerTierAssigned,
        aggregateType: "Partner",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          partnerId: this.id,
          number: this.props.number,
          legalName: this.props.legalName,
          fromTierCode,
          toTierCode: tierCode,
          toTierRank: input.rank,
          direction,
          reason: assignment.reason,
          effectiveAt: input.effectiveAt,
        },
      }),
    );
    return assignment;
  }

  // --- internals -------------------------------------------------------------

  private statusEvent(
    eventType: string,
    from: PartnerStatus,
    to: PartnerStatus,
    reason: string | undefined,
    actor: UserId | undefined,
  ) {
    return envelope({
      eventType,
      aggregateType: "Partner",
      aggregateId: this.id,
      tenantId: this.tenantId,
      payload: {
        partnerId: this.id,
        number: this.props.number,
        legalName: this.props.legalName,
        from,
        to,
        reason,
        actor,
      },
    });
  }

  private transition(to: PartnerStatus): void {
    this.props.status = to;
  }

  private assertTransition(to: PartnerStatus): void {
    const allowed = PARTNER_TRANSITIONS[this.props.status];
    if (!allowed.includes(to)) {
      throw new InvalidStateError(
        `Cannot move ${this.props.number} from ${this.props.status} to ${to}` +
          (allowed.length > 0 ? ` (allowed: ${allowed.join(", ")})` : " (terminal state)"),
        { from: this.props.status, to, allowed },
      );
    }
  }

  /** Terminated partners are frozen records; everything else can still be edited. */
  private assertMutable(action: string): void {
    if (this.props.status === "terminated") {
      throw new InvalidStateError(`Cannot ${action}: ${this.props.number} is terminated`);
    }
  }
}
