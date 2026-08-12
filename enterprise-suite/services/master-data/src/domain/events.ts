import type { IsoDateTime, Ulid, UserId } from "@enterprise-suite/shared-kernel";

/**
 * Domain event catalog for the master-data bounded context.
 *
 * Master data is read by nearly every other context, so payloads are written
 * for replication: they carry the changed values, not just ids, letting Sales,
 * Finance or Logistics maintain a local projection without calling back.
 * Event types are namespaced `mdm.<aggregate>.<event>`; the envelope's
 * schemaVersion covers payload evolution.
 */

export const MdmEventTypes = {
  CustomerCreated: "mdm.customer.created",
  CustomerUpdated: "mdm.customer.updated",
  CustomerStatusChanged: "mdm.customer.status-changed",
  CustomerIdentifierAdded: "mdm.customer.identifier-added",
  CustomerIdentifierRemoved: "mdm.customer.identifier-removed",
  CustomerContactAdded: "mdm.customer.contact-added",
  CustomerContactRemoved: "mdm.customer.contact-removed",
  CustomerTermsAssigned: "mdm.customer.terms-assigned",
  CustomerCreditLimitChanged: "mdm.customer.credit-limit-changed",
  CustomerHierarchyChanged: "mdm.customer.hierarchy-changed",
  CustomerMerged: "mdm.customer.merged",

  SiteCreated: "mdm.site.created",
  SiteUpdated: "mdm.site.updated",
  SiteAddressChanged: "mdm.site.address-changed",
  SiteRolesChanged: "mdm.site.roles-changed",
  SiteDeactivated: "mdm.site.deactivated",
  SiteReactivated: "mdm.site.reactivated",
  SitePrimaryChanged: "mdm.site.primary-changed",

  CurrencyEnabled: "mdm.currency.enabled",
  CurrencyDisabled: "mdm.currency.disabled",
  FxRateQuoted: "mdm.fx-rate.quoted",
  FxRateCorrected: "mdm.fx-rate.corrected",

  UomCreated: "mdm.uom.created",
  UomConversionDefined: "mdm.uom.conversion-defined",

  PaymentTermCreated: "mdm.payment-term.created",
  PaymentTermRetired: "mdm.payment-term.retired",
  ShippingTermCreated: "mdm.shipping-term.created",
  ShippingTermRetired: "mdm.shipping-term.retired",

  CodeListCreated: "mdm.code-list.created",
  CodeListVersionDrafted: "mdm.code-list.version-drafted",
  CodeListVersionPublished: "mdm.code-list.version-published",
  CodeListVersionRetired: "mdm.code-list.version-retired",
  CodeListEntryDeprecated: "mdm.code-list.entry-deprecated",
} as const;

export type MdmEventType = (typeof MdmEventTypes)[keyof typeof MdmEventTypes];

export interface CustomerCreatedPayload {
  readonly customerId: Ulid;
  readonly number: string;
  readonly legalName: string;
  readonly classification: string;
  readonly countryCode: string;
  readonly currency: string;
  readonly status: string;
}

export interface CustomerStatusChangedPayload {
  readonly customerId: Ulid;
  readonly number: string;
  readonly from: string;
  readonly to: string;
  readonly reason?: string;
  readonly changedBy: UserId;
}

export interface CustomerTermsAssignedPayload {
  readonly customerId: Ulid;
  readonly paymentTermCode?: string;
  readonly shippingTermCode?: string;
  readonly priceListCode?: string;
}

export interface CustomerCreditLimitChangedPayload {
  readonly customerId: Ulid;
  readonly limitMinor: number;
  readonly currency: string;
  readonly previousLimitMinor?: number;
  readonly approvedBy: UserId;
}

export interface CustomerMergedPayload {
  readonly survivorId: Ulid;
  readonly mergedId: Ulid;
  readonly mergedNumber: string;
  readonly movedSites: number;
  readonly movedIdentifiers: number;
  readonly mergedBy: UserId;
}

export interface SiteCreatedPayload {
  readonly siteId: Ulid;
  readonly customerId: Ulid;
  readonly code: string;
  readonly name: string;
  readonly roles: readonly string[];
  readonly countryCode: string;
  readonly city: string;
}

export interface SiteAddressChangedPayload {
  readonly siteId: Ulid;
  readonly customerId: Ulid;
  readonly countryCode: string;
  readonly city: string;
  readonly postalCode?: string;
  readonly effectiveFrom: IsoDateTime;
}

export interface SiteRolesChangedPayload {
  readonly siteId: Ulid;
  readonly customerId: Ulid;
  readonly roles: readonly string[];
}

export interface FxRateQuotedPayload {
  readonly base: string;
  readonly quote: string;
  readonly rate: number;
  readonly rateType: string;
  readonly validFrom: IsoDateTime;
  readonly source: string;
}

export interface FxRateCorrectedPayload extends FxRateQuotedPayload {
  readonly previousRate: number;
  readonly correctedBy: UserId;
}

export interface UomConversionDefinedPayload {
  readonly fromCode: string;
  readonly toCode: string;
  readonly factor: number;
  /** Set when the conversion only applies to one product (e.g. a pallet of X). */
  readonly productCode?: string;
}

export interface PaymentTermCreatedPayload {
  readonly code: string;
  readonly name: string;
  readonly netDays: number;
  readonly baseline: string;
  readonly discountPercent?: number;
  readonly discountDays?: number;
}

export interface ShippingTermCreatedPayload {
  readonly code: string;
  readonly incoterm: string;
  readonly namedPlace?: string;
  readonly freightPaidBy: string;
}

export interface CodeListVersionPayload {
  readonly codeListId: Ulid;
  readonly listCode: string;
  readonly version: number;
  readonly entryCount: number;
  readonly effectiveFrom?: IsoDateTime;
  readonly effectiveTo?: IsoDateTime;
}

export interface CodeListEntryDeprecatedPayload {
  readonly codeListId: Ulid;
  readonly listCode: string;
  readonly version: number;
  readonly entryCode: string;
  readonly replacedBy?: string;
}
