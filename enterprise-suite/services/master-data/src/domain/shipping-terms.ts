import { HolidayCalendar, compareDates, isoDate, type IsoDate } from "./calendar.js";
import { InvalidStateError, ValidationError } from "./errors.js";

/**
 * Shipping terms.
 *
 * The Incoterms rule fixes who does what: export and import clearance, main
 * carriage, insurance, and the point where risk passes from seller to buyer.
 * Those allocations are not tenant-configurable — they are the published 2020
 * rules — so they live in a lookup table and a tenant's shipping term simply
 * names one, adds the named place and the freight payer, and carries carrier
 * defaults for transit planning.
 *
 * Getting this wrong is expensive: under DDP the seller clears import and
 * pays duty, under EXW the buyer even loads the truck, and the four maritime
 * rules (FAS/FOB/CFR/CIF) are invalid for air or road shipments.
 */

export type Incoterm =
  | "EXW"
  | "FCA"
  | "CPT"
  | "CIP"
  | "DAP"
  | "DPU"
  | "DDP"
  | "FAS"
  | "FOB"
  | "CFR"
  | "CIF";

export const INCOTERMS: readonly Incoterm[] = [
  "EXW",
  "FCA",
  "CPT",
  "CIP",
  "DAP",
  "DPU",
  "DDP",
  "FAS",
  "FOB",
  "CFR",
  "CIF",
];

export type Party = "seller" | "buyer";

export type TransportMode = "any" | "sea";

export interface IncotermRule {
  readonly code: Incoterm;
  readonly name: string;
  /** "sea" rules are only valid for sea and inland waterway transport. */
  readonly mode: TransportMode;
  readonly group: "E" | "F" | "C" | "D";
  readonly exportClearance: Party;
  readonly importClearance: Party;
  readonly mainCarriage: Party;
  readonly insurance?: Party;
  readonly unloadingAtDestination: Party;
  /** Where risk passes, in plain language for the document footer. */
  readonly riskTransfer: string;
  /** What the named place after the code means for this rule. */
  readonly namedPlaceMeaning: string;
}

export const INCOTERMS_2020: readonly IncotermRule[] = [
  {
    code: "EXW",
    name: "Ex Works",
    mode: "any",
    group: "E",
    exportClearance: "buyer",
    importClearance: "buyer",
    mainCarriage: "buyer",
    unloadingAtDestination: "buyer",
    riskTransfer: "when the goods are placed at the buyer's disposal at the named premises, not loaded",
    namedPlaceMeaning: "seller's premises where the goods are made available",
  },
  {
    code: "FCA",
    name: "Free Carrier",
    mode: "any",
    group: "F",
    exportClearance: "seller",
    importClearance: "buyer",
    mainCarriage: "buyer",
    unloadingAtDestination: "buyer",
    riskTransfer: "on delivery to the buyer's carrier at the named place",
    namedPlaceMeaning: "place of delivery to the buyer's carrier",
  },
  {
    code: "CPT",
    name: "Carriage Paid To",
    mode: "any",
    group: "C",
    exportClearance: "seller",
    importClearance: "buyer",
    mainCarriage: "seller",
    unloadingAtDestination: "buyer",
    riskTransfer: "on handover to the first carrier, although the seller pays carriage onward",
    namedPlaceMeaning: "destination to which the seller pays carriage",
  },
  {
    code: "CIP",
    name: "Carriage and Insurance Paid To",
    mode: "any",
    group: "C",
    exportClearance: "seller",
    importClearance: "buyer",
    mainCarriage: "seller",
    insurance: "seller",
    unloadingAtDestination: "buyer",
    riskTransfer: "on handover to the first carrier; the seller insures to Institute Cargo Clauses (A)",
    namedPlaceMeaning: "destination to which the seller pays carriage and insurance",
  },
  {
    code: "DAP",
    name: "Delivered at Place",
    mode: "any",
    group: "D",
    exportClearance: "seller",
    importClearance: "buyer",
    mainCarriage: "seller",
    unloadingAtDestination: "buyer",
    riskTransfer: "when the goods arrive at the named place ready for unloading",
    namedPlaceMeaning: "destination where the goods are placed at the buyer's disposal",
  },
  {
    code: "DPU",
    name: "Delivered at Place Unloaded",
    mode: "any",
    group: "D",
    exportClearance: "seller",
    importClearance: "buyer",
    mainCarriage: "seller",
    unloadingAtDestination: "seller",
    riskTransfer: "once the goods are unloaded at the named destination",
    namedPlaceMeaning: "destination where the seller unloads the goods",
  },
  {
    code: "DDP",
    name: "Delivered Duty Paid",
    mode: "any",
    group: "D",
    exportClearance: "seller",
    importClearance: "seller",
    mainCarriage: "seller",
    unloadingAtDestination: "buyer",
    riskTransfer: "on arrival at the named destination, cleared for import and duty paid",
    namedPlaceMeaning: "destination where the seller delivers duty paid",
  },
  {
    code: "FAS",
    name: "Free Alongside Ship",
    mode: "sea",
    group: "F",
    exportClearance: "seller",
    importClearance: "buyer",
    mainCarriage: "buyer",
    unloadingAtDestination: "buyer",
    riskTransfer: "when the goods are placed alongside the vessel at the named port",
    namedPlaceMeaning: "port of shipment",
  },
  {
    code: "FOB",
    name: "Free on Board",
    mode: "sea",
    group: "F",
    exportClearance: "seller",
    importClearance: "buyer",
    mainCarriage: "buyer",
    unloadingAtDestination: "buyer",
    riskTransfer: "once the goods are on board the vessel at the named port of shipment",
    namedPlaceMeaning: "port of shipment",
  },
  {
    code: "CFR",
    name: "Cost and Freight",
    mode: "sea",
    group: "C",
    exportClearance: "seller",
    importClearance: "buyer",
    mainCarriage: "seller",
    unloadingAtDestination: "buyer",
    riskTransfer: "once the goods are on board at the port of shipment, though freight runs to destination",
    namedPlaceMeaning: "port of destination to which freight is paid",
  },
  {
    code: "CIF",
    name: "Cost, Insurance and Freight",
    mode: "sea",
    group: "C",
    exportClearance: "seller",
    importClearance: "buyer",
    mainCarriage: "seller",
    insurance: "seller",
    unloadingAtDestination: "buyer",
    riskTransfer: "once the goods are on board at the port of shipment; the seller insures to Clauses (C)",
    namedPlaceMeaning: "port of destination to which freight and insurance are paid",
  },
];

const INCOTERM_BY_CODE = new Map(INCOTERMS_2020.map((rule) => [String(rule.code), rule]));

export function findIncoterm(code: string): IncotermRule | undefined {
  return INCOTERM_BY_CODE.get(code.trim().toUpperCase());
}

export function requireIncoterm(code: string): IncotermRule {
  const rule = findIncoterm(code);
  if (!rule) throw ValidationError.single("incoterm", `unknown Incoterm "${code}"`);
  return rule;
}

export type FreightPayer = "seller" | "buyer" | "third_party";

export const FREIGHT_PAYERS: readonly FreightPayer[] = ["seller", "buyer", "third_party"];

/** How freight appears on the invoice, independent of who bears the cost. */
export type FreightBilling = "prepaid" | "collect" | "prepaid_and_charged";

export const FREIGHT_BILLINGS: readonly FreightBilling[] = [
  "prepaid",
  "collect",
  "prepaid_and_charged",
];

export type ShipmentMode = "road" | "rail" | "sea" | "air" | "inland_waterway" | "multimodal";

export const SHIPMENT_MODES: readonly ShipmentMode[] = [
  "road",
  "rail",
  "sea",
  "air",
  "inland_waterway",
  "multimodal",
];

export interface ShippingTerm {
  readonly code: string;
  readonly name: string;
  readonly incoterm: Incoterm;
  readonly namedPlace?: string;
  readonly mode: ShipmentMode;
  readonly freightPaidBy: FreightPayer;
  readonly freightBilling: FreightBilling;
  readonly carrierCode?: string;
  readonly serviceLevel?: string;
  /** Planned transit in business days on the shipping calendar. */
  readonly transitDays: number;
  /** Days between order release and dispatch. */
  readonly handlingDays: number;
  readonly calendarCode?: string;
  readonly partialShipmentsAllowed: boolean;
  readonly active: boolean;
  readonly validFrom?: IsoDate;
  readonly validTo?: IsoDate;
}

export interface CreateShippingTermInput {
  readonly code: string;
  readonly name: string;
  readonly incoterm: string;
  readonly namedPlace?: string;
  readonly mode?: ShipmentMode;
  readonly freightPaidBy?: FreightPayer;
  readonly freightBilling?: FreightBilling;
  readonly carrierCode?: string;
  readonly serviceLevel?: string;
  readonly transitDays?: number;
  readonly handlingDays?: number;
  readonly calendarCode?: string;
  readonly partialShipmentsAllowed?: boolean;
  readonly validFrom?: string;
  readonly validTo?: string;
}

export const SHIPPING_TERM_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,23}$/;

const SEA_MODES: readonly ShipmentMode[] = ["sea", "inland_waterway"];

export function createShippingTerm(input: CreateShippingTermInput): ShippingTerm {
  const code = input.code.trim().toUpperCase();
  if (!SHIPPING_TERM_CODE_PATTERN.test(code)) {
    throw ValidationError.single("code", `invalid shipping term code "${input.code}"`);
  }
  if (input.name.trim().length === 0) throw ValidationError.single("name", "name is required");

  const rule = requireIncoterm(input.incoterm);
  const mode = input.mode ?? (rule.mode === "sea" ? "sea" : "road");
  if (!SHIPMENT_MODES.includes(mode)) {
    throw ValidationError.single("mode", `unknown transport mode "${mode}"`);
  }
  if (rule.mode === "sea" && !SEA_MODES.includes(mode)) {
    throw ValidationError.single(
      "mode",
      `${rule.code} is a maritime rule and cannot be used for ${mode} transport (use FCA/CPT/CIP/DAP instead)`,
    );
  }
  // Every rule except EXW and the F group names a place the seller ships to.
  if (rule.group !== "E" && !input.namedPlace?.trim()) {
    throw ValidationError.single(
      "namedPlace",
      `${rule.code} requires a named ${rule.namedPlaceMeaning}`,
    );
  }
  const freightPaidBy = input.freightPaidBy ?? (rule.mainCarriage === "seller" ? "seller" : "buyer");
  if (!FREIGHT_PAYERS.includes(freightPaidBy)) {
    throw ValidationError.single("freightPaidBy", `unknown freight payer "${freightPaidBy}"`);
  }
  if (freightPaidBy === "buyer" && rule.mainCarriage === "seller") {
    throw ValidationError.single(
      "freightPaidBy",
      `${rule.code} makes the seller responsible for main carriage, so the buyer cannot be the freight payer`,
    );
  }
  const freightBilling = input.freightBilling ?? (freightPaidBy === "seller" ? "prepaid" : "collect");
  if (!FREIGHT_BILLINGS.includes(freightBilling)) {
    throw ValidationError.single("freightBilling", `unknown freight billing "${freightBilling}"`);
  }
  if (freightBilling === "collect" && rule.mainCarriage === "seller") {
    throw ValidationError.single(
      "freightBilling",
      `${rule.code} freight is paid by the seller and cannot be billed collect`,
    );
  }

  const transitDays = input.transitDays ?? 0;
  const handlingDays = input.handlingDays ?? 0;
  for (const [field, value] of [
    ["transitDays", transitDays],
    ["handlingDays", handlingDays],
  ] as const) {
    if (!Number.isInteger(value) || value < 0 || value > 365) {
      throw ValidationError.single(field, "must be a whole number of days between 0 and 365");
    }
  }

  const validFrom = input.validFrom ? isoDate(input.validFrom) : undefined;
  const validTo = input.validTo ? isoDate(input.validTo) : undefined;
  if (validFrom && validTo && compareDates(validFrom, validTo) >= 0) {
    throw ValidationError.single("validTo", "must be after validFrom");
  }

  return {
    code,
    name: input.name.trim(),
    incoterm: rule.code,
    namedPlace: input.namedPlace?.trim(),
    mode,
    freightPaidBy,
    freightBilling,
    carrierCode: input.carrierCode?.trim().toUpperCase(),
    serviceLevel: input.serviceLevel?.trim(),
    transitDays,
    handlingDays,
    calendarCode: input.calendarCode,
    partialShipmentsAllowed: input.partialShipmentsAllowed ?? true,
    active: true,
    validFrom,
    validTo,
  };
}

export function isShippingTermEffective(term: ShippingTerm, on: IsoDate): boolean {
  if (!term.active) return false;
  if (term.validFrom && compareDates(on, term.validFrom) < 0) return false;
  if (term.validTo && compareDates(on, term.validTo) > 0) return false;
  return true;
}

export interface Responsibilities {
  readonly incoterm: Incoterm;
  readonly namedPlace?: string;
  readonly exportClearance: Party;
  readonly importClearance: Party;
  readonly mainCarriage: Party;
  readonly insurance: Party | "not_required";
  readonly unloadingAtDestination: Party;
  readonly freightPaidBy: FreightPayer;
  readonly freightBilling: FreightBilling;
  readonly riskTransfer: string;
  /** Rendered form for order confirmations and invoices: "DAP Rotterdam". */
  readonly clause: string;
}

export function resolveResponsibilities(term: ShippingTerm): Responsibilities {
  const rule = requireIncoterm(term.incoterm);
  return {
    incoterm: rule.code,
    namedPlace: term.namedPlace,
    exportClearance: rule.exportClearance,
    importClearance: rule.importClearance,
    mainCarriage: rule.mainCarriage,
    insurance: rule.insurance ?? "not_required",
    unloadingAtDestination: rule.unloadingAtDestination,
    freightPaidBy: term.freightPaidBy,
    freightBilling: term.freightBilling,
    riskTransfer: rule.riskTransfer,
    clause: term.namedPlace ? `${rule.code} ${term.namedPlace} (Incoterms 2020)` : `${rule.code} (Incoterms 2020)`,
  };
}

/** True when the seller is on the hook for duties and import formalities. */
export function sellerBearsImportDuty(term: ShippingTerm): boolean {
  return requireIncoterm(term.incoterm).importClearance === "seller";
}

export interface DeliveryEstimate {
  readonly shipDate: IsoDate;
  readonly dispatchDate: IsoDate;
  readonly estimatedDelivery: IsoDate;
  readonly transitDays: number;
  readonly handlingDays: number;
}

/**
 * Projects a delivery date from an order date: handling days to get the goods
 * out of the door, then transit days, both counted on business days of the
 * shipping calendar.
 */
export function estimateDelivery(
  term: ShippingTerm,
  orderDate: string,
  calendar: HolidayCalendar = HolidayCalendar.standard(),
): DeliveryEstimate {
  const start = isoDate(orderDate);
  if (!term.active) {
    throw new InvalidStateError(`Shipping term ${term.code} is retired and cannot be used for planning`);
  }
  const dispatchDate = calendar.addBusinessDays(calendar.nextBusinessDay(start), term.handlingDays);
  const estimatedDelivery = calendar.addBusinessDays(dispatchDate, term.transitDays);
  return {
    shipDate: start,
    dispatchDate,
    estimatedDelivery,
    transitDays: term.transitDays,
    handlingDays: term.handlingDays,
  };
}

export const STANDARD_SHIPPING_TERMS: readonly CreateShippingTermInput[] = [
  {
    code: "EXW-PLANT",
    name: "Ex Works, shipping plant",
    incoterm: "EXW",
    mode: "road",
    freightPaidBy: "buyer",
    handlingDays: 1,
  },
  {
    code: "FCA-DOCK",
    name: "Free Carrier, seller's dock",
    incoterm: "FCA",
    namedPlace: "Seller's loading dock",
    mode: "road",
    freightPaidBy: "buyer",
    handlingDays: 1,
  },
  {
    code: "DAP-CUST",
    name: "Delivered at Place, customer site",
    incoterm: "DAP",
    namedPlace: "Customer delivery address",
    mode: "road",
    freightPaidBy: "seller",
    transitDays: 3,
    handlingDays: 1,
  },
  {
    code: "DDP-CUST",
    name: "Delivered Duty Paid, customer site",
    incoterm: "DDP",
    namedPlace: "Customer delivery address",
    mode: "road",
    freightPaidBy: "seller",
    transitDays: 5,
    handlingDays: 2,
  },
  {
    code: "CIF-PORT",
    name: "Cost, Insurance and Freight, destination port",
    incoterm: "CIF",
    namedPlace: "Port of destination",
    mode: "sea",
    freightPaidBy: "seller",
    transitDays: 25,
    handlingDays: 3,
  },
  {
    code: "FOB-PORT",
    name: "Free on Board, origin port",
    incoterm: "FOB",
    namedPlace: "Port of shipment",
    mode: "sea",
    freightPaidBy: "buyer",
    transitDays: 25,
    handlingDays: 3,
  },
];
