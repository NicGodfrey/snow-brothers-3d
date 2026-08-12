import {
  AggregateRoot,
  envelope,
  newId,
  type EntityProps,
  type Email,
  type IsoDateTime,
  type TenantId,
  type Ulid,
  type UserId,
} from "@enterprise-suite/shared-kernel";
import {
  address,
  businessCode,
  countryCode,
  currencyCodeOf,
  emailAddress,
  incoterm,
  isDiversityFlag,
  nonEmpty,
  paymentTerms,
  phoneNumber,
  type Address,
  type DiversityFlag,
  type Incoterm,
  type PaymentTerms,
} from "./common.js";
import type { DateOnly } from "./dates.js";
import { InvalidStateError, ValidationError } from "./errors.js";
import { SrmEventTypes } from "./events.js";

/**
 * Supplier master record: the single source of truth every other SRM
 * aggregate hangs off, and the record procurement/finance read before they
 * raise a PO or a payment.
 *
 * Lifecycle:
 *
 *   prospect -> onboarding -> active <-> suspended
 *        |           |  \-> rejected        |
 *        |           |                      |
 *        \-----------+------> blocked ------+--> inactive -> onboarding
 *
 * `blocked` is the sanctions/fraud stop: it is reachable from anywhere, and
 * leaves only through an explicit review that lands the supplier in
 * `suspended` (never straight back to `active`). Sites, contacts, category
 * approvals and bank accounts are entities *inside* this aggregate because
 * their invariants are mutual — e.g. exactly one primary site, a payable
 * supplier needs a verified bank account, a category approval needs an active
 * site in scope.
 */

export type SupplierStatus =
  | "prospect"
  | "onboarding"
  | "active"
  | "suspended"
  | "blocked"
  | "rejected"
  | "inactive";

export const SUPPLIER_STATUSES: readonly SupplierStatus[] = [
  "prospect",
  "onboarding",
  "active",
  "suspended",
  "blocked",
  "rejected",
  "inactive",
];

const ALLOWED_TRANSITIONS: Readonly<Record<SupplierStatus, readonly SupplierStatus[]>> = {
  prospect: ["onboarding", "blocked", "inactive"],
  onboarding: ["active", "rejected", "blocked", "inactive"],
  active: ["suspended", "blocked", "inactive"],
  suspended: ["active", "blocked", "inactive"],
  blocked: ["suspended", "inactive"],
  rejected: ["onboarding", "inactive"],
  inactive: ["onboarding"],
};

export function canTransition(from: SupplierStatus, to: SupplierStatus): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

/** Strategic segmentation (Kraljic-style), driving governance intensity. */
export type SupplierClassification =
  | "strategic"
  | "preferred"
  | "approved"
  | "transactional"
  | "tail"
  | "unclassified";

export const SUPPLIER_CLASSIFICATIONS: readonly SupplierClassification[] = [
  "strategic",
  "preferred",
  "approved",
  "transactional",
  "tail",
  "unclassified",
];

export type SiteType =
  | "headquarters"
  | "manufacturing"
  | "warehouse"
  | "distribution"
  | "service"
  | "remit_to";

export const SITE_TYPES: readonly SiteType[] = [
  "headquarters",
  "manufacturing",
  "warehouse",
  "distribution",
  "service",
  "remit_to",
];

/** Sites that can actually ship goods or perform work. */
const OPERATIONAL_SITE_TYPES: readonly SiteType[] = [
  "manufacturing",
  "warehouse",
  "distribution",
  "service",
];

export interface SupplierSite {
  readonly id: Ulid;
  readonly code: string;
  readonly name: string;
  readonly type: SiteType;
  readonly address: Address;
  readonly isPrimary: boolean;
  readonly isActive: boolean;
  /** Free-form process capability codes ("smt", "cnc-milling", "anodising"). */
  readonly capabilities: readonly string[];
  readonly leadTimeDays?: number;
  readonly timezone?: string;
  readonly deactivatedReason?: string;
}

export type ContactRole =
  | "primary"
  | "sales"
  | "quality"
  | "logistics"
  | "finance"
  | "compliance"
  | "engineering"
  | "executive";

export const CONTACT_ROLES: readonly ContactRole[] = [
  "primary",
  "sales",
  "quality",
  "logistics",
  "finance",
  "compliance",
  "engineering",
  "executive",
];

export interface SupplierContact {
  readonly id: Ulid;
  readonly name: string;
  readonly email: Email;
  readonly phone?: string;
  readonly role: ContactRole;
  readonly title?: string;
  readonly siteId?: Ulid;
  readonly isActive: boolean;
}

export type CategoryApprovalStatus = "pending" | "approved" | "restricted";

export interface SupplierCategoryAssignment {
  readonly categoryId: Ulid;
  readonly categoryCode: string;
  readonly status: CategoryApprovalStatus;
  readonly assignedAt: IsoDateTime;
  readonly approvedAt?: IsoDateTime;
  readonly approvedBy?: UserId;
  readonly restrictedReason?: string;
  readonly note?: string;
}

export type BankAccountStatus = "unverified" | "verified" | "rejected" | "archived";

export interface SupplierBankAccount {
  readonly id: Ulid;
  readonly label: string;
  readonly bankName: string;
  readonly countryCode: string;
  readonly currency: string;
  /** Only the masked tail is ever stored or emitted. */
  readonly maskedNumber: string;
  readonly status: BankAccountStatus;
  readonly isPrimary: boolean;
  readonly addedAt: IsoDateTime;
  readonly verifiedAt?: IsoDateTime;
  readonly verifiedBy?: UserId;
  readonly rejectedReason?: string;
}

export interface DiversityDeclaration {
  readonly flag: DiversityFlag;
  readonly declaredAt: IsoDateTime;
  readonly verified: boolean;
  readonly certificationId?: Ulid;
  readonly verifiedAt?: IsoDateTime;
}

export interface SupplierProps {
  code: string;
  legalName: string;
  tradeName?: string;
  status: SupplierStatus;
  classification: SupplierClassification;
  countryCode: string;
  taxId?: string;
  dunsNumber?: string;
  registrationNumber?: string;
  website?: string;
  defaultCurrency: string;
  paymentTerms: PaymentTerms;
  defaultIncoterm?: Incoterm;
  /** Corporate hierarchy: subsidiaries point at their group parent. */
  parentSupplierId?: Ulid;
  sites: SupplierSite[];
  contacts: SupplierContact[];
  categories: SupplierCategoryAssignment[];
  bankAccounts: SupplierBankAccount[];
  diversity: DiversityDeclaration[];
  tags: string[];
  onboardingCaseId?: Ulid;
  statusReason?: string;
  statusChangedAt?: IsoDateTime;
  activatedOn?: DateOnly;
  blockedReason?: string;
}

export interface RegisterSupplierInput {
  readonly code: string;
  readonly legalName: string;
  readonly countryCode: string;
  readonly tradeName?: string;
  readonly taxId?: string;
  readonly dunsNumber?: string;
  readonly registrationNumber?: string;
  readonly website?: string;
  readonly defaultCurrency?: string;
  readonly paymentTermsCode?: string;
  readonly defaultIncoterm?: string;
  readonly parentSupplierId?: Ulid;
  readonly tags?: readonly string[];
}

export interface UpdateSupplierProfileInput {
  readonly legalName?: string;
  readonly tradeName?: string | null;
  readonly taxId?: string | null;
  readonly dunsNumber?: string | null;
  readonly registrationNumber?: string | null;
  readonly website?: string | null;
  readonly defaultCurrency?: string;
  readonly paymentTermsCode?: string;
  readonly defaultIncoterm?: string | null;
  readonly parentSupplierId?: Ulid | null;
  readonly tags?: readonly string[];
}

export interface AddSiteInput {
  readonly code: string;
  readonly name: string;
  readonly type: SiteType;
  readonly address: Address;
  readonly isPrimary?: boolean;
  readonly capabilities?: readonly string[];
  readonly leadTimeDays?: number;
  readonly timezone?: string;
}

export interface AddContactInput {
  readonly name: string;
  readonly email: string;
  readonly role: ContactRole;
  readonly phone?: string;
  readonly title?: string;
  readonly siteId?: Ulid;
}

export interface AddBankAccountInput {
  readonly label: string;
  readonly bankName: string;
  readonly countryCode: string;
  readonly currency: string;
  /** Raw account number / IBAN; only its last four digits are retained. */
  readonly accountNumber: string;
}

function maskAccountNumber(raw: string): string {
  const digits = raw.replace(/\s+/g, "");
  if (digits.length < 6) {
    throw ValidationError.single("accountNumber", "must be at least 6 characters");
  }
  return `****${digits.slice(-4)}`;
}

export class Supplier extends AggregateRoot<SupplierProps> {
  static register(tenantId: TenantId, input: RegisterSupplierInput): Supplier {
    const supplier = new Supplier(tenantId, {
      code: businessCode(input.code, "code"),
      legalName: nonEmpty(input.legalName, "legalName"),
      tradeName: input.tradeName?.trim() || undefined,
      status: "prospect",
      classification: "unclassified",
      countryCode: countryCode(input.countryCode),
      taxId: input.taxId?.trim() || undefined,
      dunsNumber: input.dunsNumber?.trim() || undefined,
      registrationNumber: input.registrationNumber?.trim() || undefined,
      website: input.website?.trim() || undefined,
      defaultCurrency: currencyCodeOf(input.defaultCurrency ?? "USD"),
      paymentTerms: paymentTerms(input.paymentTermsCode ?? "NET30"),
      defaultIncoterm: input.defaultIncoterm ? incoterm(input.defaultIncoterm) : undefined,
      parentSupplierId: input.parentSupplierId,
      sites: [],
      contacts: [],
      categories: [],
      bankAccounts: [],
      diversity: [],
      tags: [...new Set((input.tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean))],
    });
    supplier.raiseSupplierEvent(SrmEventTypes.SupplierRegistered, {
      legalName: supplier.props.legalName,
      countryCode: supplier.props.countryCode,
      status: supplier.props.status,
    });
    return supplier;
  }

  static fromSnapshot(snapshot: EntityProps & SupplierProps): Supplier {
    const { id, tenantId, createdAt, updatedAt, version, ...props } = snapshot;
    return new Supplier(
      tenantId,
      {
        ...props,
        sites: [...props.sites],
        contacts: [...props.contacts],
        categories: [...props.categories],
        bankAccounts: [...props.bankAccounts],
        diversity: [...props.diversity],
        tags: [...props.tags],
      },
      { id, createdAt, updatedAt, version },
    );
  }

  // --- accessors -----------------------------------------------------------

  get code(): string {
    return this.props.code;
  }
  get legalName(): string {
    return this.props.legalName;
  }
  get displayName(): string {
    return this.props.tradeName ?? this.props.legalName;
  }
  get status(): SupplierStatus {
    return this.props.status;
  }
  get classification(): SupplierClassification {
    return this.props.classification;
  }
  get countryCode(): string {
    return this.props.countryCode;
  }
  get defaultCurrency(): string {
    return this.props.defaultCurrency;
  }
  get paymentTerms(): PaymentTerms {
    return this.props.paymentTerms;
  }
  get parentSupplierId(): Ulid | undefined {
    return this.props.parentSupplierId;
  }
  get sites(): readonly SupplierSite[] {
    return this.props.sites;
  }
  get contacts(): readonly SupplierContact[] {
    return this.props.contacts;
  }
  get categories(): readonly SupplierCategoryAssignment[] {
    return this.props.categories;
  }
  get bankAccounts(): readonly SupplierBankAccount[] {
    return this.props.bankAccounts;
  }
  get diversity(): readonly DiversityDeclaration[] {
    return this.props.diversity;
  }
  get tags(): readonly string[] {
    return this.props.tags;
  }
  get onboardingCaseId(): Ulid | undefined {
    return this.props.onboardingCaseId;
  }

  siteById(siteId: Ulid): SupplierSite | undefined {
    return this.props.sites.find((site) => site.id === siteId);
  }

  siteByCode(code: string): SupplierSite | undefined {
    const normalized = code.trim().toUpperCase();
    return this.props.sites.find((site) => site.code === normalized);
  }

  primarySite(): SupplierSite | undefined {
    return this.props.sites.find((site) => site.isPrimary);
  }

  activeSites(): readonly SupplierSite[] {
    return this.props.sites.filter((site) => site.isActive);
  }

  operationalSites(): readonly SupplierSite[] {
    return this.props.sites.filter((site) => site.isActive && OPERATIONAL_SITE_TYPES.includes(site.type));
  }

  contactById(contactId: Ulid): SupplierContact | undefined {
    return this.props.contacts.find((contact) => contact.id === contactId);
  }

  contactFor(role: ContactRole): SupplierContact | undefined {
    return (
      this.props.contacts.find((contact) => contact.isActive && contact.role === role) ??
      this.props.contacts.find((contact) => contact.isActive && contact.role === "primary")
    );
  }

  categoryAssignment(categoryId: Ulid): SupplierCategoryAssignment | undefined {
    return this.props.categories.find((assignment) => assignment.categoryId === categoryId);
  }

  approvedCategoryIds(): readonly Ulid[] {
    return this.props.categories.filter((a) => a.status === "approved").map((a) => a.categoryId);
  }

  primaryBankAccount(): SupplierBankAccount | undefined {
    return this.props.bankAccounts.find((account) => account.isPrimary && account.status === "verified");
  }

  /** Payables gate: money only moves to a verified, primary account. */
  isPayable(): boolean {
    return this.props.status === "active" && this.primaryBankAccount() !== undefined;
  }

  verifiedDiversityFlags(): readonly DiversityFlag[] {
    return this.props.diversity.filter((d) => d.verified).map((d) => d.flag);
  }

  // --- profile -------------------------------------------------------------

  updateProfile(patch: UpdateSupplierProfileInput): void {
    this.assertMutable("update the profile");
    if (patch.legalName !== undefined) this.props.legalName = nonEmpty(patch.legalName, "legalName");
    if (patch.tradeName !== undefined) {
      this.props.tradeName = patch.tradeName === null ? undefined : patch.tradeName.trim() || undefined;
    }
    if (patch.taxId !== undefined) {
      this.props.taxId = patch.taxId === null ? undefined : nonEmpty(patch.taxId, "taxId", 40);
    }
    if (patch.dunsNumber !== undefined) {
      this.props.dunsNumber = patch.dunsNumber === null ? undefined : nonEmpty(patch.dunsNumber, "dunsNumber", 20);
    }
    if (patch.registrationNumber !== undefined) {
      this.props.registrationNumber =
        patch.registrationNumber === null ? undefined : nonEmpty(patch.registrationNumber, "registrationNumber", 40);
    }
    if (patch.website !== undefined) {
      this.props.website = patch.website === null ? undefined : nonEmpty(patch.website, "website", 200);
    }
    if (patch.defaultCurrency !== undefined) {
      this.props.defaultCurrency = currencyCodeOf(patch.defaultCurrency);
    }
    if (patch.paymentTermsCode !== undefined) {
      this.props.paymentTerms = paymentTerms(patch.paymentTermsCode);
    }
    if (patch.defaultIncoterm !== undefined) {
      this.props.defaultIncoterm = patch.defaultIncoterm === null ? undefined : incoterm(patch.defaultIncoterm);
    }
    if (patch.parentSupplierId !== undefined) {
      if (patch.parentSupplierId === this.id) {
        throw ValidationError.single("parentSupplierId", "a supplier cannot be its own parent");
      }
      this.props.parentSupplierId = patch.parentSupplierId ?? undefined;
    }
    if (patch.tags !== undefined) {
      this.props.tags = [...new Set(patch.tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
    }
    this.raiseSupplierEvent(SrmEventTypes.SupplierProfileUpdated, {
      legalName: this.props.legalName,
      fields: Object.keys(patch),
    });
  }

  classify(to: SupplierClassification, rationale?: string): void {
    if (!SUPPLIER_CLASSIFICATIONS.includes(to)) {
      throw ValidationError.single("classification", `unknown classification "${to}"`);
    }
    if (to === this.props.classification) return;
    if (to === "strategic" && this.props.status !== "active") {
      throw new InvalidStateError(
        `Supplier ${this.props.code} is ${this.props.status}; only active suppliers can be strategic`,
      );
    }
    const from = this.props.classification;
    this.props.classification = to;
    this.raiseSupplierEvent(SrmEventTypes.SupplierClassified, { from, to, rationale: rationale?.trim() });
  }

  // --- lifecycle -----------------------------------------------------------

  startOnboarding(caseId: Ulid, by: UserId): void {
    this.transition("onboarding", by);
    this.props.onboardingCaseId = caseId;
  }

  /**
   * Activation is the moment the supplier becomes transactable, so the master
   * data has to be complete: a primary site, a reachable primary contact and a
   * tax id for the finance system.
   */
  activate(by: UserId, activatedOn: DateOnly, reason?: string): void {
    const missing: string[] = [];
    if (!this.primarySite()) missing.push("a primary site");
    if (!this.props.contacts.some((c) => c.isActive && c.role === "primary")) missing.push("a primary contact");
    if (!this.props.taxId) missing.push("a tax id");
    if (missing.length > 0) {
      throw new InvalidStateError(
        `Supplier ${this.props.code} cannot be activated without ${missing.join(", ")}`,
        { missing },
      );
    }
    this.transition("active", by, reason);
    this.props.activatedOn = activatedOn;
  }

  reject(by: UserId, reason: string): void {
    this.transition("rejected", by, nonEmpty(reason, "reason", 500));
  }

  suspend(by: UserId, reason: string): void {
    this.transition("suspended", by, nonEmpty(reason, "reason", 500));
  }

  reinstate(by: UserId, reason?: string): void {
    if (this.props.status !== "suspended") {
      throw new InvalidStateError(
        `Supplier ${this.props.code} is ${this.props.status}; only suspended suppliers can be reinstated`,
      );
    }
    this.transition("active", by, reason);
  }

  /** Sanctions/fraud stop. Reachable from any live state. */
  block(by: UserId, reason: string): void {
    this.transition("blocked", by, nonEmpty(reason, "reason", 500));
    this.props.blockedReason = this.props.statusReason;
  }

  /** Unblocking never restores trading rights directly: it lands in suspended. */
  unblock(by: UserId, reason: string): void {
    if (this.props.status !== "blocked") {
      throw new InvalidStateError(`Supplier ${this.props.code} is not blocked`);
    }
    this.transition("suspended", by, nonEmpty(reason, "reason", 500));
    this.props.blockedReason = undefined;
  }

  deactivate(by: UserId, reason: string): void {
    this.transition("inactive", by, nonEmpty(reason, "reason", 500));
  }

  private transition(to: SupplierStatus, by: UserId, reason?: string): void {
    const from = this.props.status;
    if (from === to) {
      throw new InvalidStateError(`Supplier ${this.props.code} is already ${to}`);
    }
    if (!canTransition(from, to)) {
      throw new InvalidStateError(`Supplier ${this.props.code} cannot move from ${from} to ${to}`, {
        allowed: ALLOWED_TRANSITIONS[from],
      });
    }
    this.props.status = to;
    this.props.statusReason = reason?.trim() || undefined;
    this.raiseSupplierEvent(SrmEventTypes.SupplierStatusChanged, {
      from,
      to,
      reason: this.props.statusReason,
      changedBy: by,
    });
  }

  // --- sites ---------------------------------------------------------------

  addSite(input: AddSiteInput): SupplierSite {
    this.assertMutable("add a site");
    const code = businessCode(input.code, "site.code");
    if (this.siteByCode(code)) {
      throw new InvalidStateError(`Site ${code} already exists on supplier ${this.props.code}`);
    }
    if (!SITE_TYPES.includes(input.type)) {
      throw ValidationError.single("site.type", `must be one of [${SITE_TYPES.join(", ")}]`);
    }
    if (input.leadTimeDays !== undefined && (!Number.isInteger(input.leadTimeDays) || input.leadTimeDays < 0)) {
      throw ValidationError.single("site.leadTimeDays", "must be a non-negative integer");
    }
    // The first site is always primary; there is no "supplier without an address".
    const makePrimary = input.isPrimary === true || this.props.sites.length === 0;
    if (makePrimary) this.demoteSites();
    const site: SupplierSite = {
      id: newId("site"),
      code,
      name: nonEmpty(input.name, "site.name"),
      type: input.type,
      address: address(input.address, "site.address"),
      isPrimary: makePrimary,
      isActive: true,
      capabilities: [...new Set((input.capabilities ?? []).map((c) => c.trim().toLowerCase()).filter(Boolean))],
      leadTimeDays: input.leadTimeDays,
      timezone: input.timezone?.trim() || undefined,
    };
    this.props.sites.push(site);
    this.raiseSupplierEvent(SrmEventTypes.SupplierSiteAdded, {
      siteId: site.id,
      siteCode: site.code,
      siteType: site.type,
      countryCode: site.address.countryCode,
      isPrimary: site.isPrimary,
    });
    return site;
  }

  updateSite(
    siteId: Ulid,
    patch: {
      readonly name?: string;
      readonly type?: SiteType;
      readonly address?: Address;
      readonly capabilities?: readonly string[];
      readonly leadTimeDays?: number | null;
      readonly timezone?: string | null;
    },
  ): SupplierSite {
    this.assertMutable("update a site");
    const index = this.requireSiteIndex(siteId);
    const current = this.props.sites[index]!;
    const updated: SupplierSite = {
      ...current,
      name: patch.name !== undefined ? nonEmpty(patch.name, "site.name") : current.name,
      type: patch.type ?? current.type,
      address: patch.address ? address(patch.address, "site.address") : current.address,
      capabilities:
        patch.capabilities !== undefined
          ? [...new Set(patch.capabilities.map((c) => c.trim().toLowerCase()).filter(Boolean))]
          : current.capabilities,
      leadTimeDays:
        patch.leadTimeDays === undefined
          ? current.leadTimeDays
          : patch.leadTimeDays === null
            ? undefined
            : patch.leadTimeDays,
      timezone:
        patch.timezone === undefined ? current.timezone : patch.timezone === null ? undefined : patch.timezone.trim(),
    };
    this.props.sites[index] = updated;
    this.raiseSupplierEvent(SrmEventTypes.SupplierSiteUpdated, {
      siteId: updated.id,
      siteCode: updated.code,
      siteType: updated.type,
      countryCode: updated.address.countryCode,
      isPrimary: updated.isPrimary,
    });
    return updated;
  }

  setPrimarySite(siteId: Ulid): void {
    const index = this.requireSiteIndex(siteId);
    const site = this.props.sites[index]!;
    if (!site.isActive) {
      throw new InvalidStateError(`Site ${site.code} is inactive and cannot be the primary site`);
    }
    if (site.isPrimary) return;
    this.demoteSites();
    this.props.sites[index] = { ...site, isPrimary: true };
    this.raiseSupplierEvent(SrmEventTypes.SupplierSiteUpdated, {
      siteId: site.id,
      siteCode: site.code,
      siteType: site.type,
      countryCode: site.address.countryCode,
      isPrimary: true,
    });
  }

  /**
   * Deactivating the primary site would leave the supplier without a legal
   * address, so the caller has to promote another active site first.
   */
  deactivateSite(siteId: Ulid, reason: string): void {
    const index = this.requireSiteIndex(siteId);
    const site = this.props.sites[index]!;
    if (!site.isActive) throw new InvalidStateError(`Site ${site.code} is already inactive`);
    if (site.isPrimary && this.props.sites.some((s) => s.isActive && s.id !== siteId)) {
      throw new InvalidStateError(
        `Site ${site.code} is the primary site; promote another site before deactivating it`,
      );
    }
    this.props.sites[index] = {
      ...site,
      isActive: false,
      isPrimary: false,
      deactivatedReason: nonEmpty(reason, "reason", 300),
    };
    // Contacts pinned to the site lose their site anchor but stay reachable.
    this.props.contacts = this.props.contacts.map((contact) =>
      contact.siteId === siteId ? { ...contact, siteId: undefined } : contact,
    );
    this.raiseSupplierEvent(SrmEventTypes.SupplierSiteDeactivated, {
      siteId: site.id,
      siteCode: site.code,
      siteType: site.type,
      countryCode: site.address.countryCode,
      isPrimary: false,
      reason,
    });
  }

  private demoteSites(): void {
    this.props.sites = this.props.sites.map((site) => (site.isPrimary ? { ...site, isPrimary: false } : site));
  }

  private requireSiteIndex(siteId: Ulid): number {
    const index = this.props.sites.findIndex((site) => site.id === siteId);
    if (index === -1) {
      throw new InvalidStateError(`Site ${siteId} does not belong to supplier ${this.props.code}`);
    }
    return index;
  }

  // --- contacts ------------------------------------------------------------

  addContact(input: AddContactInput): SupplierContact {
    this.assertMutable("add a contact");
    if (!CONTACT_ROLES.includes(input.role)) {
      throw ValidationError.single("contact.role", `must be one of [${CONTACT_ROLES.join(", ")}]`);
    }
    const email = emailAddress(input.email, "contact.email");
    if (this.props.contacts.some((contact) => contact.isActive && contact.email === email)) {
      throw new InvalidStateError(`Contact ${email} already exists on supplier ${this.props.code}`);
    }
    if (input.siteId && !this.siteById(input.siteId)) {
      throw new InvalidStateError(`Site ${input.siteId} does not belong to supplier ${this.props.code}`);
    }
    // One holder per role: a new primary/quality contact replaces the old one.
    this.props.contacts = this.props.contacts.map((contact) =>
      contact.role === input.role && contact.isActive ? { ...contact, isActive: false } : contact,
    );
    const contact: SupplierContact = {
      id: newId("contact"),
      name: nonEmpty(input.name, "contact.name"),
      email,
      phone: input.phone ? phoneNumber(input.phone, "contact.phone") : undefined,
      role: input.role,
      title: input.title?.trim() || undefined,
      siteId: input.siteId,
      isActive: true,
    };
    this.props.contacts.push(contact);
    this.raiseSupplierEvent(SrmEventTypes.SupplierContactAdded, {
      contactId: contact.id,
      email: contact.email,
      role: contact.role,
    });
    return contact;
  }

  removeContact(contactId: Ulid): void {
    const index = this.props.contacts.findIndex((contact) => contact.id === contactId);
    if (index === -1) {
      throw new InvalidStateError(`Contact ${contactId} does not belong to supplier ${this.props.code}`);
    }
    const contact = this.props.contacts[index]!;
    if (!contact.isActive) return;
    if (contact.role === "primary" && this.props.status === "active") {
      throw new InvalidStateError(
        `Contact ${contact.email} is the primary contact of an active supplier; assign a replacement first`,
      );
    }
    this.props.contacts[index] = { ...contact, isActive: false };
    this.raiseSupplierEvent(SrmEventTypes.SupplierContactRemoved, {
      contactId: contact.id,
      email: contact.email,
      role: contact.role,
    });
  }

  // --- category panel ------------------------------------------------------

  assignCategory(categoryId: Ulid, categoryCode: string, at: IsoDateTime, note?: string): SupplierCategoryAssignment {
    this.assertMutable("assign a category");
    if (this.categoryAssignment(categoryId)) {
      throw new InvalidStateError(`Supplier ${this.props.code} is already assigned to ${categoryCode}`);
    }
    const assignment: SupplierCategoryAssignment = {
      categoryId,
      categoryCode,
      status: "pending",
      assignedAt: at,
      note: note?.trim() || undefined,
    };
    this.props.categories.push(assignment);
    this.touch();
    return assignment;
  }

  /**
   * Approving a category panel entry means "this supplier may be awarded
   * business here". Cross-aggregate prerequisites (qualification, required
   * certifications, no blocking holds) are checked by SupplierService; the
   * aggregate enforces what it can see: the supplier trades, and it has an
   * operational site to deliver from.
   */
  approveCategory(categoryId: Ulid, by: UserId, at: IsoDateTime, note?: string): SupplierCategoryAssignment {
    const index = this.requireCategoryIndex(categoryId);
    const current = this.props.categories[index]!;
    if (this.props.status !== "active" && this.props.status !== "onboarding") {
      throw new InvalidStateError(
        `Supplier ${this.props.code} is ${this.props.status}; category approval requires an onboarding or active supplier`,
      );
    }
    if (this.operationalSites().length === 0) {
      throw new InvalidStateError(
        `Supplier ${this.props.code} has no active operational site to serve category ${current.categoryCode}`,
      );
    }
    const updated: SupplierCategoryAssignment = {
      ...current,
      status: "approved",
      approvedAt: at,
      approvedBy: by,
      restrictedReason: undefined,
      note: note?.trim() || current.note,
    };
    this.props.categories[index] = updated;
    this.raiseSupplierEvent(SrmEventTypes.SupplierCategoryApproved, {
      categoryId,
      categoryCode: updated.categoryCode,
      approvalStatus: updated.status,
      note: updated.note,
    });
    return updated;
  }

  restrictCategory(categoryId: Ulid, reason: string): SupplierCategoryAssignment {
    const index = this.requireCategoryIndex(categoryId);
    const current = this.props.categories[index]!;
    const updated: SupplierCategoryAssignment = {
      ...current,
      status: "restricted",
      restrictedReason: nonEmpty(reason, "reason", 500),
    };
    this.props.categories[index] = updated;
    this.raiseSupplierEvent(SrmEventTypes.SupplierCategoryRestricted, {
      categoryId,
      categoryCode: updated.categoryCode,
      approvalStatus: updated.status,
      note: updated.restrictedReason,
    });
    return updated;
  }

  private requireCategoryIndex(categoryId: Ulid): number {
    const index = this.props.categories.findIndex((assignment) => assignment.categoryId === categoryId);
    if (index === -1) {
      throw new InvalidStateError(`Supplier ${this.props.code} is not assigned to category ${categoryId}`);
    }
    return index;
  }

  // --- banking -------------------------------------------------------------

  /**
   * Bank details are the classic payment-fraud vector: a new account always
   * starts unverified and never inherits the primary flag, so a change of
   * bank details cannot silently redirect payments.
   */
  addBankAccount(input: AddBankAccountInput, at: IsoDateTime): SupplierBankAccount {
    this.assertMutable("add a bank account");
    const account: SupplierBankAccount = {
      id: newId("bank"),
      label: nonEmpty(input.label, "bankAccount.label", 60),
      bankName: nonEmpty(input.bankName, "bankAccount.bankName"),
      countryCode: countryCode(input.countryCode, "bankAccount.countryCode"),
      currency: currencyCodeOf(input.currency, "bankAccount.currency"),
      maskedNumber: maskAccountNumber(input.accountNumber),
      status: "unverified",
      isPrimary: false,
      addedAt: at,
    };
    if (this.props.bankAccounts.some((a) => a.maskedNumber === account.maskedNumber && a.status !== "archived")) {
      throw new InvalidStateError(`Bank account ${account.maskedNumber} already exists on ${this.props.code}`);
    }
    this.props.bankAccounts.push(account);
    this.raiseSupplierEvent(SrmEventTypes.SupplierBankAccountAdded, {
      accountId: account.id,
      currency: account.currency,
      maskedNumber: account.maskedNumber,
      verificationStatus: account.status,
    });
    return account;
  }

  verifyBankAccount(accountId: Ulid, by: UserId, at: IsoDateTime, makePrimary = true): SupplierBankAccount {
    const index = this.props.bankAccounts.findIndex((account) => account.id === accountId);
    if (index === -1) {
      throw new InvalidStateError(`Bank account ${accountId} does not belong to supplier ${this.props.code}`);
    }
    const current = this.props.bankAccounts[index]!;
    if (current.status !== "unverified") {
      throw new InvalidStateError(`Bank account ${current.maskedNumber} is ${current.status}`);
    }
    if (makePrimary) {
      this.props.bankAccounts = this.props.bankAccounts.map((account) =>
        account.isPrimary ? { ...account, isPrimary: false } : account,
      );
    }
    const updated: SupplierBankAccount = {
      ...current,
      status: "verified",
      verifiedAt: at,
      verifiedBy: by,
      isPrimary: makePrimary,
    };
    this.props.bankAccounts[index] = updated;
    this.raiseSupplierEvent(SrmEventTypes.SupplierBankAccountVerified, {
      accountId: updated.id,
      currency: updated.currency,
      maskedNumber: updated.maskedNumber,
      verificationStatus: updated.status,
    });
    return updated;
  }

  // --- diversity -----------------------------------------------------------

  declareDiversity(flag: DiversityFlag, at: IsoDateTime): DiversityDeclaration {
    if (!isDiversityFlag(flag)) {
      throw ValidationError.single("flag", `unknown diversity flag "${flag}"`);
    }
    const existing = this.props.diversity.find((entry) => entry.flag === flag);
    if (existing) return existing;
    const declaration: DiversityDeclaration = { flag, declaredAt: at, verified: false };
    this.props.diversity.push(declaration);
    this.touch();
    return declaration;
  }

  /** Called once the matching diversity certificate has been verified. */
  markDiversityVerified(flag: DiversityFlag, certificationId: Ulid, at: IsoDateTime): void {
    const index = this.props.diversity.findIndex((entry) => entry.flag === flag);
    if (index === -1) {
      throw new InvalidStateError(`Supplier ${this.props.code} has not declared "${flag}"`);
    }
    this.props.diversity[index] = {
      ...this.props.diversity[index]!,
      verified: true,
      certificationId,
      verifiedAt: at,
    };
    this.touch();
  }

  // --- helpers -------------------------------------------------------------

  /** Terminal states are read-only: no back-dated edits on dead records. */
  private assertMutable(action: string): void {
    if (this.props.status === "inactive" || this.props.status === "blocked") {
      throw new InvalidStateError(`Cannot ${action}: supplier ${this.props.code} is ${this.props.status}`);
    }
  }

  private raiseSupplierEvent(eventType: string, payload: Record<string, unknown>): void {
    this.raise(
      envelope({
        eventType,
        aggregateType: "Supplier",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { supplierId: this.id, supplierCode: this.props.code, ...payload },
      }),
    );
  }
}
