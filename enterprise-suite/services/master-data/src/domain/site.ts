import {
  AggregateRoot,
  envelope,
  type EntityProps,
  type IsoDateTime,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import {
  normalizeAddress,
  validateAddress,
  type AddressInput,
  type GeoPoint,
  type PostalAddress,
} from "./address.js";
import { AddressValidationError, InvalidStateError, ValidationError } from "./errors.js";
import { MdmEventTypes } from "./events.js";

/**
 * Customer sites: the physical and functional locations a customer transacts
 * through. One site can hold several roles (a branch that both receives goods
 * and pays invoices), and a customer designates one primary site per role,
 * which is what order entry defaults to.
 *
 * Addresses are effective-dated. A relocation announced in advance is recorded
 * with a future `effectiveFrom`; documents dated before the move must still
 * resolve the old address, so history is kept rather than overwritten.
 */

export type SiteRole = "sold_to" | "ship_to" | "bill_to" | "payer" | "service" | "return_to";

export const SITE_ROLES: readonly SiteRole[] = [
  "sold_to",
  "ship_to",
  "bill_to",
  "payer",
  "service",
  "return_to",
];

/** Roles whose address must actually be deliverable. */
const PHYSICAL_ROLES: readonly SiteRole[] = ["ship_to", "service", "return_to"];

export interface AddressPeriod {
  readonly address: PostalAddress;
  readonly effectiveFrom: IsoDateTime;
  readonly effectiveTo?: IsoDateTime;
  readonly reason?: string;
}

export interface SiteProps {
  customerId: Ulid;
  code: string;
  name: string;
  roles: SiteRole[];
  primaryForRoles: SiteRole[];
  addressHistory: AddressPeriod[];
  timezone: string;
  active: boolean;
  deactivationReason?: string;
  taxJurisdictionCode?: string;
  deliveryInstructions?: string;
  /** GS1 location number, when the customer exchanges EDI. */
  gln?: string;
  externalIds: Record<string, string>;
}

export interface CreateSiteInput {
  readonly customerId: Ulid;
  readonly code: string;
  readonly name: string;
  readonly roles: readonly SiteRole[];
  readonly address: AddressInput | PostalAddress;
  readonly effectiveFrom: IsoDateTime;
  readonly timezone?: string;
  readonly taxJurisdictionCode?: string;
  readonly deliveryInstructions?: string;
  readonly gln?: string;
  readonly externalIds?: Readonly<Record<string, string>>;
}

export const SITE_CODE_PATTERN = /^[A-Z0-9][A-Z0-9-_]{1,31}$/;

function normalizeRoles(roles: readonly SiteRole[]): SiteRole[] {
  const unique = [...new Set(roles)];
  if (unique.length === 0) {
    throw ValidationError.single("roles", "a site needs at least one role");
  }
  for (const role of unique) {
    if (!SITE_ROLES.includes(role)) {
      throw ValidationError.single("roles", `unknown site role "${role}"`);
    }
  }
  return unique.sort((a, b) => SITE_ROLES.indexOf(a) - SITE_ROLES.indexOf(b));
}

/** Sites that receive physical goods must have a fully valid address. */
function assertDeliverable(address: PostalAddress, roles: readonly SiteRole[]): void {
  if (!roles.some((role) => PHYSICAL_ROLES.includes(role))) return;
  const issues = validateAddress(address);
  if (issues.length > 0) {
    throw new AddressValidationError(
      `A ${roles.filter((r) => PHYSICAL_ROLES.includes(r)).join("/")} site needs a deliverable address`,
      issues,
    );
  }
}

export class Site extends AggregateRoot<SiteProps> {
  static create(tenantId: TenantId, input: CreateSiteInput): Site {
    const code = input.code.trim().toUpperCase();
    if (!SITE_CODE_PATTERN.test(code)) {
      throw ValidationError.single("code", `invalid site code "${input.code}"`);
    }
    if (input.name.trim().length === 0) {
      throw ValidationError.single("name", "site name is required");
    }
    const roles = normalizeRoles(input.roles);
    const address = normalizeAddress(input.address as AddressInput);
    assertDeliverable(address, roles);

    const site = new Site(tenantId, {
      customerId: input.customerId,
      code,
      name: input.name.trim(),
      roles,
      primaryForRoles: [],
      addressHistory: [{ address, effectiveFrom: input.effectiveFrom }],
      timezone: input.timezone ?? "UTC",
      active: true,
      taxJurisdictionCode: input.taxJurisdictionCode,
      deliveryInstructions: input.deliveryInstructions?.trim() || undefined,
      gln: input.gln,
      externalIds: { ...(input.externalIds ?? {}) },
    });

    site.raise(
      envelope({
        eventType: MdmEventTypes.SiteCreated,
        aggregateType: "Site",
        aggregateId: site.id,
        tenantId,
        payload: {
          siteId: site.id,
          customerId: input.customerId,
          code,
          name: site.props.name,
          roles,
          countryCode: String(address.countryCode),
          city: address.city,
        },
      }),
    );
    return site;
  }

  static fromSnapshot(snapshot: EntityProps & SiteProps): Site {
    const { id, tenantId, createdAt, updatedAt, version, ...props } = snapshot;
    return new Site(
      tenantId,
      {
        ...props,
        roles: [...props.roles],
        primaryForRoles: [...props.primaryForRoles],
        addressHistory: [...props.addressHistory],
        externalIds: { ...props.externalIds },
      },
      { id, createdAt, updatedAt, version },
    );
  }

  // --- accessors -------------------------------------------------------------

  get customerId(): Ulid {
    return this.props.customerId;
  }
  get code(): string {
    return this.props.code;
  }
  get name(): string {
    return this.props.name;
  }
  get roles(): readonly SiteRole[] {
    return this.props.roles;
  }
  get primaryForRoles(): readonly SiteRole[] {
    return this.props.primaryForRoles;
  }
  get active(): boolean {
    return this.props.active;
  }
  get timezone(): string {
    return this.props.timezone;
  }
  get gln(): string | undefined {
    return this.props.gln;
  }
  get taxJurisdictionCode(): string | undefined {
    return this.props.taxJurisdictionCode;
  }
  get addressHistory(): readonly AddressPeriod[] {
    return this.props.addressHistory;
  }

  hasRole(role: SiteRole): boolean {
    return this.props.roles.includes(role);
  }

  isPrimaryFor(role: SiteRole): boolean {
    return this.props.primaryForRoles.includes(role);
  }

  /** The address in force on a date; falls back to the earliest known one. */
  addressAt(at: IsoDateTime | string): PostalAddress {
    const instant = Date.parse(String(at));
    const periods = [...this.props.addressHistory].sort(
      (a, b) => Date.parse(a.effectiveFrom) - Date.parse(b.effectiveFrom),
    );
    const match = [...periods]
      .reverse()
      .find(
        (period) =>
          Date.parse(period.effectiveFrom) <= instant &&
          (period.effectiveTo === undefined || Date.parse(period.effectiveTo) > instant),
      );
    return (match ?? periods[0]!).address;
  }

  /** The latest address, including one that has not taken effect yet. */
  get address(): PostalAddress {
    const periods = [...this.props.addressHistory].sort(
      (a, b) => Date.parse(a.effectiveFrom) - Date.parse(b.effectiveFrom),
    );
    return periods[periods.length - 1]!.address;
  }

  get coordinates(): GeoPoint | undefined {
    return this.address.coordinates;
  }

  // --- commands --------------------------------------------------------------

  updateDetails(patch: {
    readonly name?: string;
    readonly timezone?: string;
    readonly taxJurisdictionCode?: string | null;
    readonly deliveryInstructions?: string | null;
    readonly gln?: string | null;
  }): void {
    this.assertActive();
    if (patch.name !== undefined) {
      if (patch.name.trim().length === 0) throw ValidationError.single("name", "name cannot be blank");
      this.props.name = patch.name.trim();
    }
    if (patch.timezone !== undefined) this.props.timezone = patch.timezone;
    if (patch.taxJurisdictionCode !== undefined) {
      this.props.taxJurisdictionCode = patch.taxJurisdictionCode ?? undefined;
    }
    if (patch.deliveryInstructions !== undefined) {
      this.props.deliveryInstructions = patch.deliveryInstructions?.trim() || undefined;
    }
    if (patch.gln !== undefined) this.props.gln = patch.gln ?? undefined;
    this.raise(
      envelope({
        eventType: MdmEventTypes.SiteUpdated,
        aggregateType: "Site",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { siteId: this.id, customerId: this.props.customerId, name: this.props.name },
      }),
    );
  }

  /**
   * Records a relocation. The current period is closed at the new start date
   * and the new address opens there, so `addressAt` keeps returning the right
   * address for back-dated documents.
   */
  changeAddress(
    input: AddressInput | PostalAddress,
    effectiveFrom: IsoDateTime,
    reason?: string,
  ): PostalAddress {
    this.assertActive();
    const address = normalizeAddress(input as AddressInput);
    assertDeliverable(address, this.props.roles);

    const start = Date.parse(effectiveFrom);
    if (Number.isNaN(start)) {
      throw ValidationError.single("effectiveFrom", "must be an ISO timestamp");
    }
    const latest = [...this.props.addressHistory].sort(
      (a, b) => Date.parse(a.effectiveFrom) - Date.parse(b.effectiveFrom),
    )[this.props.addressHistory.length - 1]!;
    if (Date.parse(latest.effectiveFrom) >= start) {
      throw new InvalidStateError(
        `Address change must start after the current period (${latest.effectiveFrom})`,
      );
    }
    this.props.addressHistory = this.props.addressHistory.map((period) =>
      period.effectiveTo === undefined && period.effectiveFrom === latest.effectiveFrom
        ? { ...period, effectiveTo: effectiveFrom }
        : period,
    );
    this.props.addressHistory.push({ address, effectiveFrom, reason: reason?.trim() });

    this.raise(
      envelope({
        eventType: MdmEventTypes.SiteAddressChanged,
        aggregateType: "Site",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          siteId: this.id,
          customerId: this.props.customerId,
          countryCode: String(address.countryCode),
          city: address.city,
          postalCode: address.postalCode,
          effectiveFrom,
        },
      }),
    );
    return address;
  }

  setRoles(roles: readonly SiteRole[]): void {
    this.assertActive();
    const next = normalizeRoles(roles);
    assertDeliverable(this.address, next);
    const dropped = this.props.primaryForRoles.filter((role) => !next.includes(role));
    this.props.roles = next;
    // A site cannot stay the primary for a role it no longer performs.
    this.props.primaryForRoles = this.props.primaryForRoles.filter((role) => next.includes(role));
    this.raise(
      envelope({
        eventType: MdmEventTypes.SiteRolesChanged,
        aggregateType: "Site",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          siteId: this.id,
          customerId: this.props.customerId,
          roles: next,
          droppedPrimaryRoles: dropped,
        },
      }),
    );
  }

  /** Uniqueness of the primary flag across sites is enforced by the service. */
  markPrimaryFor(role: SiteRole, primary: boolean): void {
    this.assertActive();
    if (primary && !this.props.roles.includes(role)) {
      throw new InvalidStateError(`Site ${this.props.code} does not have the ${role} role`);
    }
    const has = this.props.primaryForRoles.includes(role);
    if (has === primary) return;
    this.props.primaryForRoles = primary
      ? [...this.props.primaryForRoles, role]
      : this.props.primaryForRoles.filter((r) => r !== role);
    this.raise(
      envelope({
        eventType: MdmEventTypes.SitePrimaryChanged,
        aggregateType: "Site",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { siteId: this.id, customerId: this.props.customerId, role, primary },
      }),
    );
  }

  deactivate(reason: string): void {
    this.assertActive();
    if (reason.trim().length === 0) {
      throw ValidationError.single("reason", "a reason is required to deactivate a site");
    }
    if (this.props.primaryForRoles.length > 0) {
      throw new InvalidStateError(
        `Site ${this.props.code} is still primary for [${this.props.primaryForRoles.join(", ")}]; reassign first`,
      );
    }
    this.props.active = false;
    this.props.deactivationReason = reason.trim();
    this.raise(
      envelope({
        eventType: MdmEventTypes.SiteDeactivated,
        aggregateType: "Site",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { siteId: this.id, customerId: this.props.customerId, reason: reason.trim() },
      }),
    );
  }

  reactivate(): void {
    if (this.props.active) throw new InvalidStateError(`Site ${this.props.code} is already active`);
    this.props.active = true;
    this.props.deactivationReason = undefined;
    this.raise(
      envelope({
        eventType: MdmEventTypes.SiteReactivated,
        aggregateType: "Site",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { siteId: this.id, customerId: this.props.customerId },
      }),
    );
  }

  /** Re-codes the site; used when a merge collides with an existing code. */
  recode(code: string): void {
    const normalized = code.trim().toUpperCase();
    if (!SITE_CODE_PATTERN.test(normalized)) {
      throw ValidationError.single("code", `invalid site code "${code}"`);
    }
    this.props.code = normalized;
    this.touch();
  }

  /** Re-parents the site during a customer merge. */
  reassignTo(customerId: Ulid): void {
    if (customerId === this.props.customerId) return;
    this.props.customerId = customerId;
    this.touch();
  }

  private assertActive(): void {
    if (!this.props.active) {
      throw new InvalidStateError(`Site ${this.props.code} is inactive; reactivate it first`);
    }
  }
}
