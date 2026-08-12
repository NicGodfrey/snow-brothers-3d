import {
  AggregateRoot,
  envelope,
  newId,
  type EntityProps,
  type IsoDateTime,
  type Money,
  type TenantId,
  type Ulid,
  type UserId,
} from "@enterprise-suite/shared-kernel";
import { normalizeAddress, type AddressInput, type PostalAddress } from "./address.js";
import { requireCurrency } from "./currency.js";
import { InvalidStateError, ValidationError } from "./errors.js";
import { MdmEventTypes } from "./events.js";
import { validateIdentifier, type IdentifierScheme, type PartyIdentifier } from "./identifiers.js";

/**
 * Customer master (the "sold-to" party).
 *
 * The aggregate owns everything that must change atomically with the party
 * itself: its status, registered address, tax/registration identifiers,
 * contacts, commercial defaults and credit limit. Locations live outside as
 * `Site` aggregates, because a large customer has hundreds of them and they
 * are edited independently.
 *
 * Status is a small state machine rather than a boolean because the reasons
 * for refusing an order differ: `on_hold` is a credit decision that Finance
 * releases, `blocked` is a compliance decision that Legal releases, and
 * `inactive` is simply retired master data.
 */

export type PartyType = "organization" | "person";

export const PARTY_TYPES: readonly PartyType[] = ["organization", "person"];

export type CustomerStatus = "draft" | "active" | "on_hold" | "blocked" | "inactive" | "merged";

export const CUSTOMER_STATUSES: readonly CustomerStatus[] = [
  "draft",
  "active",
  "on_hold",
  "blocked",
  "inactive",
  "merged",
];

const ALLOWED_TRANSITIONS: Readonly<Record<CustomerStatus, readonly CustomerStatus[]>> = {
  draft: ["active", "inactive"],
  active: ["on_hold", "blocked", "inactive"],
  on_hold: ["active", "blocked", "inactive"],
  blocked: ["active", "inactive"],
  inactive: ["active"],
  merged: [],
};

export function canTransition(from: CustomerStatus, to: CustomerStatus): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

export function assertTransition(from: CustomerStatus, to: CustomerStatus): void {
  if (from === to) {
    throw new InvalidStateError(`Customer is already ${to}`);
  }
  if (!canTransition(from, to)) {
    throw new InvalidStateError(
      `Illegal customer status transition ${from} -> ${to}; allowed: [${(
        ALLOWED_TRANSITIONS[from] ?? []
      ).join(", ")}]`,
    );
  }
}

/** Statuses that permit new sales documents. */
export function canTransact(status: CustomerStatus): boolean {
  return status === "active";
}

export type CustomerClassification =
  | "enterprise"
  | "mid_market"
  | "small_business"
  | "government"
  | "education"
  | "non_profit"
  | "individual"
  | "intercompany";

export const CUSTOMER_CLASSIFICATIONS: readonly CustomerClassification[] = [
  "enterprise",
  "mid_market",
  "small_business",
  "government",
  "education",
  "non_profit",
  "individual",
  "intercompany",
];

export type ContactRole = "primary" | "billing" | "shipping" | "technical" | "executive" | "legal";

export const CONTACT_ROLES: readonly ContactRole[] = [
  "primary",
  "billing",
  "shipping",
  "technical",
  "executive",
  "legal",
];

export interface CustomerContact {
  readonly id: Ulid;
  readonly name: string;
  readonly email?: string;
  readonly phone?: string;
  readonly jobTitle?: string;
  readonly roles: readonly ContactRole[];
  readonly siteId?: Ulid;
  readonly createdAt: IsoDateTime;
}

export interface CommercialTerms {
  readonly paymentTermCode?: string;
  readonly shippingTermCode?: string;
  readonly priceListCode?: string;
  readonly incotermPlace?: string;
}

export interface CreditProfile {
  readonly limit?: Money;
  readonly currency: string;
  readonly riskRating?: string;
  readonly approvedBy?: UserId;
  readonly approvedAt?: IsoDateTime;
  readonly reviewDue?: IsoDateTime;
}

export interface CustomerProps {
  number: string;
  legalName: string;
  tradingName?: string;
  partyType: PartyType;
  classification: CustomerClassification;
  status: CustomerStatus;
  statusReason?: string;
  registeredAddress: PostalAddress;
  currency: string;
  /** Code-list references resolved by the code-list service, kept as codes. */
  industryCode?: string;
  segmentCode?: string;
  taxCategoryCode?: string;
  identifiers: PartyIdentifier[];
  contacts: CustomerContact[];
  terms: CommercialTerms;
  credit: CreditProfile;
  parentId?: Ulid;
  /** Set when this record lost a merge; reads should follow the survivor. */
  mergedIntoId?: Ulid;
  tags: string[];
  externalIds: Record<string, string>;
  activatedAt?: IsoDateTime;
}

export interface CreateCustomerInput {
  readonly number: string;
  readonly legalName: string;
  readonly tradingName?: string;
  readonly partyType?: PartyType;
  readonly classification: CustomerClassification;
  readonly registeredAddress: AddressInput | PostalAddress;
  readonly currency?: string;
  readonly industryCode?: string;
  readonly segmentCode?: string;
  readonly taxCategoryCode?: string;
  readonly parentId?: Ulid;
  readonly tags?: readonly string[];
  readonly externalIds?: Readonly<Record<string, string>>;
}

export const CUSTOMER_NUMBER_PATTERN = /^[A-Z0-9][A-Z0-9-]{2,31}$/;

/** Normalization is idempotent, so an already-normalized address passes through. */
function asAddress(value: AddressInput | PostalAddress): PostalAddress {
  return normalizeAddress(value as AddressInput);
}

export class Customer extends AggregateRoot<CustomerProps> {
  static create(tenantId: TenantId, input: CreateCustomerInput): Customer {
    const number = input.number.trim().toUpperCase();
    if (!CUSTOMER_NUMBER_PATTERN.test(number)) {
      throw ValidationError.single("number", `invalid customer number "${input.number}"`);
    }
    if (input.legalName.trim().length === 0) {
      throw ValidationError.single("legalName", "legal name is required");
    }
    if (!CUSTOMER_CLASSIFICATIONS.includes(input.classification)) {
      throw ValidationError.single("classification", `unknown classification "${input.classification}"`);
    }
    const address = asAddress(input.registeredAddress);
    const currency = String(requireCurrency(input.currency ?? "USD").code);

    const customer = new Customer(tenantId, {
      number,
      legalName: input.legalName.trim(),
      tradingName: input.tradingName?.trim() || undefined,
      partyType: input.partyType ?? "organization",
      classification: input.classification,
      status: "draft",
      registeredAddress: address,
      currency,
      industryCode: input.industryCode,
      segmentCode: input.segmentCode,
      taxCategoryCode: input.taxCategoryCode,
      identifiers: [],
      contacts: [],
      terms: {},
      credit: { currency },
      parentId: input.parentId,
      tags: [...(input.tags ?? [])].map((t) => t.trim().toLowerCase()).filter(Boolean),
      externalIds: { ...(input.externalIds ?? {}) },
    });

    customer.raise(
      envelope({
        eventType: MdmEventTypes.CustomerCreated,
        aggregateType: "Customer",
        aggregateId: customer.id,
        tenantId,
        payload: {
          customerId: customer.id,
          number,
          legalName: customer.props.legalName,
          classification: customer.props.classification,
          countryCode: String(address.countryCode),
          currency,
          status: customer.props.status,
        },
      }),
    );
    return customer;
  }

  static fromSnapshot(snapshot: EntityProps & CustomerProps): Customer {
    const { id, tenantId, createdAt, updatedAt, version, ...props } = snapshot;
    return new Customer(
      tenantId,
      {
        ...props,
        identifiers: [...props.identifiers],
        contacts: [...props.contacts],
        tags: [...props.tags],
        externalIds: { ...props.externalIds },
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
  get tradingName(): string | undefined {
    return this.props.tradingName;
  }
  get displayName(): string {
    return this.props.tradingName ?? this.props.legalName;
  }
  get partyType(): PartyType {
    return this.props.partyType;
  }
  get classification(): CustomerClassification {
    return this.props.classification;
  }
  get status(): CustomerStatus {
    return this.props.status;
  }
  get registeredAddress(): PostalAddress {
    return this.props.registeredAddress;
  }
  get currency(): string {
    return this.props.currency;
  }
  get identifiers(): readonly PartyIdentifier[] {
    return this.props.identifiers;
  }
  get contacts(): readonly CustomerContact[] {
    return this.props.contacts;
  }
  get terms(): CommercialTerms {
    return this.props.terms;
  }
  get credit(): CreditProfile {
    return this.props.credit;
  }
  get parentId(): Ulid | undefined {
    return this.props.parentId;
  }
  get mergedIntoId(): Ulid | undefined {
    return this.props.mergedIntoId;
  }
  get tags(): readonly string[] {
    return this.props.tags;
  }
  get industryCode(): string | undefined {
    return this.props.industryCode;
  }
  get segmentCode(): string | undefined {
    return this.props.segmentCode;
  }
  get taxCategoryCode(): string | undefined {
    return this.props.taxCategoryCode;
  }
  get externalIds(): Readonly<Record<string, string>> {
    return this.props.externalIds;
  }

  identifierOf(scheme: IdentifierScheme): PartyIdentifier | undefined {
    return this.props.identifiers.find((i) => i.scheme === scheme);
  }

  canTransact(): boolean {
    return canTransact(this.props.status);
  }

  private assertMutable(): void {
    if (this.props.status === "merged") {
      throw new InvalidStateError(
        `Customer ${this.props.number} was merged into ${this.props.mergedIntoId}; edit the survivor instead`,
      );
    }
  }

  // --- commands --------------------------------------------------------------

  updateProfile(patch: {
    readonly legalName?: string;
    readonly tradingName?: string | null;
    readonly classification?: CustomerClassification;
    readonly industryCode?: string | null;
    readonly segmentCode?: string | null;
    readonly taxCategoryCode?: string | null;
    readonly registeredAddress?: AddressInput | PostalAddress;
    readonly tags?: readonly string[];
  }): void {
    this.assertMutable();
    if (patch.legalName !== undefined) {
      if (patch.legalName.trim().length === 0) {
        throw ValidationError.single("legalName", "legal name cannot be blank");
      }
      this.props.legalName = patch.legalName.trim();
    }
    if (patch.tradingName !== undefined) {
      this.props.tradingName = patch.tradingName?.trim() || undefined;
    }
    if (patch.classification !== undefined) {
      if (!CUSTOMER_CLASSIFICATIONS.includes(patch.classification)) {
        throw ValidationError.single("classification", `unknown classification "${patch.classification}"`);
      }
      this.props.classification = patch.classification;
    }
    if (patch.industryCode !== undefined) this.props.industryCode = patch.industryCode ?? undefined;
    if (patch.segmentCode !== undefined) this.props.segmentCode = patch.segmentCode ?? undefined;
    if (patch.taxCategoryCode !== undefined) {
      this.props.taxCategoryCode = patch.taxCategoryCode ?? undefined;
    }
    if (patch.registeredAddress !== undefined) {
      this.props.registeredAddress = asAddress(patch.registeredAddress);
    }
    if (patch.tags !== undefined) {
      this.props.tags = [...new Set(patch.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
    }
    this.raise(
      envelope({
        eventType: MdmEventTypes.CustomerUpdated,
        aggregateType: "Customer",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          customerId: this.id,
          number: this.props.number,
          legalName: this.props.legalName,
          classification: this.props.classification,
          countryCode: String(this.props.registeredAddress.countryCode),
        },
      }),
    );
  }

  changeStatus(to: CustomerStatus, actor: UserId, reason?: string): void {
    this.assertMutable();
    assertTransition(this.props.status, to);
    if ((to === "blocked" || to === "on_hold") && !reason?.trim()) {
      throw ValidationError.single("reason", `a reason is required to move a customer to ${to}`);
    }
    if (to === "active" && this.props.identifiers.length === 0 && this.props.status === "draft") {
      throw new InvalidStateError(
        `Customer ${this.props.number} needs at least one registration identifier before activation`,
      );
    }
    const from = this.props.status;
    this.props.status = to;
    this.props.statusReason = reason?.trim();
    if (to === "active" && !this.props.activatedAt) {
      this.props.activatedAt = this.updatedAt;
    }
    this.raise(
      envelope({
        eventType: MdmEventTypes.CustomerStatusChanged,
        aggregateType: "Customer",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          customerId: this.id,
          number: this.props.number,
          from,
          to,
          reason: reason?.trim(),
          changedBy: actor,
        },
      }),
    );
  }

  /** Adds a validated identifier; the canonical form is what gets stored. */
  addIdentifier(identifier: PartyIdentifier, at: IsoDateTime): PartyIdentifier {
    this.assertMutable();
    const verdict = validateIdentifier(identifier);
    if (!verdict.valid) {
      throw ValidationError.single(
        `identifiers.${identifier.scheme}`,
        verdict.reason ?? `invalid ${identifier.scheme} identifier`,
      );
    }
    const stored: PartyIdentifier = {
      scheme: identifier.scheme,
      value: verdict.normalized,
      countryCode: identifier.countryCode?.toUpperCase(),
      verifiedAt: verdict.checkedDigits ? at : undefined,
    };
    const duplicate = this.props.identifiers.some(
      (existing) => existing.scheme === stored.scheme && existing.value === stored.value,
    );
    if (duplicate) {
      throw new InvalidStateError(`${stored.scheme} ${stored.value} is already on ${this.props.number}`);
    }
    this.props.identifiers.push(stored);
    this.raise(
      envelope({
        eventType: MdmEventTypes.CustomerIdentifierAdded,
        aggregateType: "Customer",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          customerId: this.id,
          scheme: stored.scheme,
          value: stored.value,
          countryCode: stored.countryCode,
          checkedDigits: verdict.checkedDigits,
        },
      }),
    );
    return stored;
  }

  removeIdentifier(scheme: IdentifierScheme, value: string): void {
    this.assertMutable();
    const normalized = value.trim().toUpperCase();
    const index = this.props.identifiers.findIndex(
      (i) => i.scheme === scheme && i.value === normalized,
    );
    if (index === -1) {
      throw new InvalidStateError(`${scheme} ${normalized} is not registered on ${this.props.number}`);
    }
    this.props.identifiers.splice(index, 1);
    this.raise(
      envelope({
        eventType: MdmEventTypes.CustomerIdentifierRemoved,
        aggregateType: "Customer",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { customerId: this.id, scheme, value: normalized },
      }),
    );
  }

  addContact(input: {
    readonly name: string;
    readonly email?: string;
    readonly phone?: string;
    readonly jobTitle?: string;
    readonly roles?: readonly ContactRole[];
    readonly siteId?: Ulid;
    readonly at: IsoDateTime;
  }): CustomerContact {
    this.assertMutable();
    if (input.name.trim().length === 0) {
      throw ValidationError.single("name", "contact name is required");
    }
    if (input.email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(input.email.trim())) {
      throw ValidationError.single("email", `"${input.email}" is not a valid email address`);
    }
    const roles: ContactRole[] = [...new Set<ContactRole>(input.roles ?? ["primary"])];
    for (const role of roles) {
      if (!CONTACT_ROLES.includes(role)) {
        throw ValidationError.single("roles", `unknown contact role "${role}"`);
      }
    }
    // One primary contact per customer: the newest primary takes the badge.
    if (roles.includes("primary")) {
      this.props.contacts = this.props.contacts.map((contact) =>
        contact.roles.includes("primary")
          ? { ...contact, roles: contact.roles.filter((r) => r !== "primary") }
          : contact,
      );
    }
    const contact: CustomerContact = {
      id: newId("contact"),
      name: input.name.trim(),
      email: input.email?.trim().toLowerCase(),
      phone: input.phone?.trim(),
      jobTitle: input.jobTitle?.trim(),
      roles,
      siteId: input.siteId,
      createdAt: input.at,
    };
    this.props.contacts.push(contact);
    this.raise(
      envelope({
        eventType: MdmEventTypes.CustomerContactAdded,
        aggregateType: "Customer",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          customerId: this.id,
          contactId: contact.id,
          name: contact.name,
          email: contact.email,
          roles: contact.roles,
        },
      }),
    );
    return contact;
  }

  removeContact(contactId: Ulid): void {
    this.assertMutable();
    const index = this.props.contacts.findIndex((c) => c.id === contactId);
    if (index === -1) {
      throw new InvalidStateError(`Contact ${contactId} is not on customer ${this.props.number}`);
    }
    this.props.contacts.splice(index, 1);
    this.raise(
      envelope({
        eventType: MdmEventTypes.CustomerContactRemoved,
        aggregateType: "Customer",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { customerId: this.id, contactId },
      }),
    );
  }

  primaryContact(): CustomerContact | undefined {
    return this.props.contacts.find((c) => c.roles.includes("primary"));
  }

  /** Term codes are validated against the term catalog by the service. */
  assignTerms(terms: CommercialTerms): void {
    this.assertMutable();
    this.props.terms = {
      paymentTermCode: terms.paymentTermCode ?? this.props.terms.paymentTermCode,
      shippingTermCode: terms.shippingTermCode ?? this.props.terms.shippingTermCode,
      priceListCode: terms.priceListCode ?? this.props.terms.priceListCode,
      incotermPlace: terms.incotermPlace ?? this.props.terms.incotermPlace,
    };
    this.raise(
      envelope({
        eventType: MdmEventTypes.CustomerTermsAssigned,
        aggregateType: "Customer",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          customerId: this.id,
          paymentTermCode: this.props.terms.paymentTermCode,
          shippingTermCode: this.props.terms.shippingTermCode,
          priceListCode: this.props.terms.priceListCode,
        },
      }),
    );
  }

  setCreditLimit(limit: Money, actor: UserId, at: IsoDateTime, riskRating?: string): void {
    this.assertMutable();
    if (limit.amountMinor < 0) {
      throw ValidationError.single("limit", "credit limit cannot be negative");
    }
    if (String(limit.currency) !== this.props.currency) {
      throw ValidationError.single(
        "limit.currency",
        `credit limit must be in the customer currency ${this.props.currency}`,
      );
    }
    const previous = this.props.credit.limit;
    this.props.credit = {
      ...this.props.credit,
      limit,
      approvedBy: actor,
      approvedAt: at,
      riskRating: riskRating ?? this.props.credit.riskRating,
    };
    this.raise(
      envelope({
        eventType: MdmEventTypes.CustomerCreditLimitChanged,
        aggregateType: "Customer",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          customerId: this.id,
          limitMinor: limit.amountMinor,
          currency: String(limit.currency),
          previousLimitMinor: previous?.amountMinor,
          approvedBy: actor,
        },
      }),
    );
  }

  /** Cycle prevention lives in the service, which can walk the whole tree. */
  setParent(parentId: Ulid | undefined): void {
    this.assertMutable();
    if (parentId === this.id) {
      throw new InvalidStateError("A customer cannot be its own parent");
    }
    this.props.parentId = parentId;
    this.raise(
      envelope({
        eventType: MdmEventTypes.CustomerHierarchyChanged,
        aggregateType: "Customer",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { customerId: this.id, parentId },
      }),
    );
  }

  /** Marks this record as the loser of a merge; it becomes read-only. */
  markMerged(survivorId: Ulid, actor: UserId, moved: { sites: number; identifiers: number }): void {
    this.assertMutable();
    if (survivorId === this.id) {
      throw new InvalidStateError("A customer cannot be merged into itself");
    }
    this.props.status = "merged";
    this.props.mergedIntoId = survivorId;
    this.raise(
      envelope({
        eventType: MdmEventTypes.CustomerMerged,
        aggregateType: "Customer",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          survivorId,
          mergedId: this.id,
          mergedNumber: this.props.number,
          movedSites: moved.sites,
          movedIdentifiers: moved.identifiers,
          mergedBy: actor,
        },
      }),
    );
  }

  setExternalId(system: string, value: string): void {
    this.assertMutable();
    const key = system.trim().toLowerCase();
    if (key.length === 0) throw ValidationError.single("system", "external system key is required");
    this.props.externalIds[key] = value.trim();
    this.touch();
  }
}
