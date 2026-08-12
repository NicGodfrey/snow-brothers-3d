import { DomainError, type Ulid } from "@enterprise-suite/shared-kernel";
import type { Carrier, ServiceLevel } from "./carrier.js";
import type { RateCard } from "./rate-card.js";
import { volumeCm3, type Address, type Dimensions } from "./values.js";

/** The subset of package data rating cares about. */
export interface RatablePackage {
  readonly weightKg: number;
  readonly dimensions?: Dimensions;
}

export interface RateQuote {
  readonly rateCardId: Ulid;
  readonly carrierId: Ulid;
  readonly carrierCode: string;
  readonly carrierName: string;
  readonly serviceLevelCode: string;
  readonly serviceLevelName: string;
  readonly transitDays: number;
  readonly currency: string;
  readonly zone: string;
  readonly billableWeightKg: number;
  readonly baseMinor: number;
  readonly fuelMinor: number;
  readonly accessorialsMinor: number;
  readonly totalMinor: number;
  readonly appliedAccessorials: readonly string[];
}

/**
 * Billable weight for one package: max of actual and dimensional weight
 * (volume / dimFactor), rounded UP to the nearest 0.5 kg — the common
 * parcel-industry convention.
 */
export function billablePackageWeightKg(pkg: RatablePackage, dimFactor: number): number {
  if (typeof pkg.weightKg !== "number" || pkg.weightKg <= 0) {
    throw new DomainError("package.weightKg must be positive", "VALIDATION");
  }
  const dimensionalKg = pkg.dimensions ? volumeCm3(pkg.dimensions) / dimFactor : 0;
  const raw = Math.max(pkg.weightKg, dimensionalKg);
  return Math.ceil(raw * 2) / 2;
}

/** Billable weight for a whole shipment: sum of per-package billable weights. */
export function billableShipmentWeightKg(
  packages: readonly RatablePackage[],
  dimFactor: number,
): number {
  if (packages.length === 0) {
    throw new DomainError("At least one package is required to rate a shipment", "VALIDATION");
  }
  return packages.reduce((sum, pkg) => sum + billablePackageWeightKg(pkg, dimFactor), 0);
}

/**
 * Computes a quote for one (carrier, service level, rate card) combination.
 * Returns undefined when the card cannot rate the shipment (no zone match,
 * weight beyond the highest break, or a requested accessorial the card does
 * not offer).
 */
export function computeQuote(input: {
  carrier: Carrier;
  serviceLevel: ServiceLevel;
  rateCard: RateCard;
  destination: Address;
  packages: readonly RatablePackage[];
  accessorialCodes?: readonly string[];
}): RateQuote | undefined {
  const { carrier, serviceLevel, rateCard, destination, packages } = input;

  const zone = rateCard.resolveZone(destination);
  if (zone === undefined) return undefined;

  const billableWeightKg = billableShipmentWeightKg(packages, rateCard.dimFactor);
  const baseMinor = rateCard.baseRateFor(zone, billableWeightKg);
  if (baseMinor === undefined) return undefined;

  const applied: string[] = [];
  let accessorialsMinor = 0;
  for (const code of input.accessorialCodes ?? []) {
    const accessorial = rateCard.accessorial(code);
    if (accessorial === undefined) return undefined;
    accessorialsMinor += accessorial.amountMinor;
    applied.push(accessorial.code);
  }

  const fuelMinor = Math.round((baseMinor * rateCard.fuelSurchargePct) / 100);

  return {
    rateCardId: rateCard.id,
    carrierId: carrier.id,
    carrierCode: carrier.code,
    carrierName: carrier.name,
    serviceLevelCode: serviceLevel.code,
    serviceLevelName: serviceLevel.name,
    transitDays: serviceLevel.transitDays,
    currency: rateCard.currency,
    zone,
    billableWeightKg,
    baseMinor,
    fuelMinor,
    accessorialsMinor,
    totalMinor: baseMinor + fuelMinor + accessorialsMinor,
    appliedAccessorials: applied,
  };
}

/** Sort order for presenting quotes: cheapest first, ties broken by speed. */
export function compareQuotes(a: RateQuote, b: RateQuote): number {
  return a.totalMinor - b.totalMinor || a.transitDays - b.transitDays;
}
