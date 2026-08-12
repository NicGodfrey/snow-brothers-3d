import {
  AggregateRoot,
  ConflictError,
  DomainError,
  envelope,
  type IsoDateTime,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { LogisticsEvents, type RateCardPublishedPayload } from "./events.js";
import {
  assertIsoDateTime,
  assertNonNegativeInt,
  assertPositiveNumber,
  type Address,
} from "./values.js";

export type RateCardStatus = "draft" | "published" | "archived";

/**
 * Maps a destination to a rating zone. Rules are matched most-specific
 * first: a rule with a postal prefix beats a country-only rule, and a
 * longer prefix beats a shorter one.
 */
export interface ZoneRule {
  readonly zone: string;
  readonly country: string;
  readonly postalPrefix?: string;
}

/**
 * A weight break: the price for shipments up to `maxWeightKg`
 * (inclusive) in the given zone.
 */
export interface RateBreak {
  readonly zone: string;
  readonly maxWeightKg: number;
  readonly amountMinor: number;
}

/** Flat-fee optional service, e.g. LIFTGATE, RESIDENTIAL, HAZMAT. */
export interface Accessorial {
  readonly code: string;
  readonly name: string;
  readonly amountMinor: number;
}

export interface RateCardProps {
  carrierId: Ulid;
  serviceLevelCode: string;
  currency: string;
  status: RateCardStatus;
  effectiveFrom: IsoDateTime;
  effectiveTo?: IsoDateTime;
  /**
   * Volumetric divisor in cm3/kg (e.g. 5000). Dimensional weight is
   * volume / dimFactor; billable weight is max(actual, dimensional).
   */
  dimFactor: number;
  /** Fuel surcharge applied to the base rate, in percent (e.g. 12.5). */
  fuelSurchargePct: number;
  zones: ZoneRule[];
  breaks: RateBreak[];
  accessorials: Accessorial[];
}

export interface CreateRateCardInput {
  readonly carrierId: Ulid;
  readonly serviceLevelCode: string;
  readonly currency: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly dimFactor?: number;
  readonly fuelSurchargePct?: number;
}

const DEFAULT_DIM_FACTOR = 5000;

export class RateCard extends AggregateRoot<RateCardProps> {
  private constructor(tenantId: TenantId, props: RateCardProps) {
    super(tenantId, props);
  }

  static create(tenantId: TenantId, input: CreateRateCardInput): RateCard {
    if (typeof input.currency !== "string" || !/^[A-Za-z]{3}$/.test(input.currency)) {
      throw new DomainError("rateCard.currency must be a 3-letter ISO code", "VALIDATION");
    }
    const effectiveFrom = assertIsoDateTime(input.effectiveFrom, "rateCard.effectiveFrom");
    const effectiveTo =
      input.effectiveTo !== undefined
        ? assertIsoDateTime(input.effectiveTo, "rateCard.effectiveTo")
        : undefined;
    if (effectiveTo !== undefined && effectiveTo <= effectiveFrom) {
      throw new DomainError("rateCard.effectiveTo must be after effectiveFrom", "VALIDATION");
    }
    const dimFactor = input.dimFactor ?? DEFAULT_DIM_FACTOR;
    assertPositiveNumber(dimFactor, "rateCard.dimFactor");
    const fuelSurchargePct = input.fuelSurchargePct ?? 0;
    if (
      typeof fuelSurchargePct !== "number" ||
      fuelSurchargePct < 0 ||
      fuelSurchargePct > 100
    ) {
      throw new DomainError("rateCard.fuelSurchargePct must be 0-100", "VALIDATION");
    }
    const card = new RateCard(tenantId, {
      carrierId: input.carrierId,
      serviceLevelCode: input.serviceLevelCode.toUpperCase(),
      currency: input.currency.toUpperCase(),
      status: "draft",
      effectiveFrom: effectiveFrom as IsoDateTime,
      effectiveTo: effectiveTo as IsoDateTime | undefined,
      dimFactor,
      fuelSurchargePct,
      zones: [],
      breaks: [],
      accessorials: [],
    });
    card.raise(
      envelope({
        eventType: LogisticsEvents.RateCardCreated,
        aggregateType: "RateCard",
        aggregateId: card.id,
        tenantId,
        payload: {
          rateCardId: card.id,
          carrierId: input.carrierId,
          serviceLevelCode: card.props.serviceLevelCode,
        },
      }),
    );
    return card;
  }

  get carrierId(): Ulid {
    return this.props.carrierId;
  }

  get serviceLevelCode(): string {
    return this.props.serviceLevelCode;
  }

  get currency(): string {
    return this.props.currency;
  }

  get status(): RateCardStatus {
    return this.props.status;
  }

  get dimFactor(): number {
    return this.props.dimFactor;
  }

  get fuelSurchargePct(): number {
    return this.props.fuelSurchargePct;
  }

  get zones(): readonly ZoneRule[] {
    return this.props.zones;
  }

  get breaks(): readonly RateBreak[] {
    return this.props.breaks;
  }

  get accessorials(): readonly Accessorial[] {
    return this.props.accessorials;
  }

  private assertDraft(action: string): void {
    if (this.props.status !== "draft") {
      throw new ConflictError(`Cannot ${action}: rate card is ${this.props.status}`);
    }
  }

  addZoneRule(rule: ZoneRule): void {
    this.assertDraft("add zone rule");
    if (typeof rule.zone !== "string" || rule.zone.trim().length === 0) {
      throw new DomainError("zoneRule.zone is required", "VALIDATION");
    }
    if (!/^[A-Za-z]{2}$/.test(rule.country ?? "")) {
      throw new DomainError("zoneRule.country must be ISO alpha-2", "VALIDATION");
    }
    const normalized: ZoneRule = {
      zone: rule.zone.trim().toUpperCase(),
      country: rule.country.toUpperCase(),
      postalPrefix: rule.postalPrefix?.trim() || undefined,
    };
    const duplicate = this.props.zones.some(
      (z) =>
        z.country === normalized.country &&
        (z.postalPrefix ?? "") === (normalized.postalPrefix ?? ""),
    );
    if (duplicate) {
      throw new ConflictError(
        `Zone rule for ${normalized.country}/${normalized.postalPrefix ?? "*"} already exists`,
      );
    }
    this.props.zones.push(normalized);
    this.touch();
  }

  addBreak(rateBreak: RateBreak): void {
    this.assertDraft("add rate break");
    if (typeof rateBreak.zone !== "string" || rateBreak.zone.trim().length === 0) {
      throw new DomainError("rateBreak.zone is required", "VALIDATION");
    }
    assertPositiveNumber(rateBreak.maxWeightKg, "rateBreak.maxWeightKg");
    assertNonNegativeInt(rateBreak.amountMinor, "rateBreak.amountMinor");
    const zone = rateBreak.zone.trim().toUpperCase();
    const duplicate = this.props.breaks.some(
      (b) => b.zone === zone && b.maxWeightKg === rateBreak.maxWeightKg,
    );
    if (duplicate) {
      throw new ConflictError(
        `Rate break for zone ${zone} at ${rateBreak.maxWeightKg}kg already exists`,
      );
    }
    this.props.breaks.push({ ...rateBreak, zone });
    this.props.breaks.sort(
      (a, b) => a.zone.localeCompare(b.zone) || a.maxWeightKg - b.maxWeightKg,
    );
    this.touch();
  }

  upsertAccessorial(input: Accessorial): void {
    this.assertDraft("modify accessorials");
    if (!/^[A-Z0-9_]{2,30}$/.test(input.code?.toUpperCase() ?? "")) {
      throw new DomainError("accessorial.code must be 2-30 chars A-Z, 0-9, '_'", "VALIDATION");
    }
    assertNonNegativeInt(input.amountMinor, "accessorial.amountMinor");
    const code = input.code.toUpperCase();
    const next: Accessorial = { code, name: input.name?.trim() || code, amountMinor: input.amountMinor };
    const idx = this.props.accessorials.findIndex((a) => a.code === code);
    if (idx >= 0) {
      this.props.accessorials[idx] = next;
    } else {
      this.props.accessorials.push(next);
    }
    this.touch();
  }

  setFuelSurcharge(pct: number): void {
    this.assertDraft("set fuel surcharge");
    if (typeof pct !== "number" || pct < 0 || pct > 100) {
      throw new DomainError("fuelSurchargePct must be 0-100", "VALIDATION");
    }
    this.props.fuelSurchargePct = pct;
    this.touch();
  }

  publish(): void {
    this.assertDraft("publish");
    if (this.props.zones.length === 0) {
      throw new DomainError("Cannot publish a rate card with no zone rules", "VALIDATION");
    }
    if (this.props.breaks.length === 0) {
      throw new DomainError("Cannot publish a rate card with no rate breaks", "VALIDATION");
    }
    const zonesWithBreaks = new Set(this.props.breaks.map((b) => b.zone));
    const orphanZones = this.props.zones.filter((z) => !zonesWithBreaks.has(z.zone));
    if (orphanZones.length > 0) {
      throw new DomainError(
        `Zones without rate breaks: ${orphanZones.map((z) => z.zone).join(", ")}`,
        "VALIDATION",
      );
    }
    this.props.status = "published";
    this.raise(
      envelope<RateCardPublishedPayload>({
        eventType: LogisticsEvents.RateCardPublished,
        aggregateType: "RateCard",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          rateCardId: this.id,
          carrierId: this.props.carrierId,
          serviceLevelCode: this.props.serviceLevelCode,
          currency: this.props.currency,
          effectiveFrom: this.props.effectiveFrom,
          effectiveTo: this.props.effectiveTo,
        },
      }),
    );
  }

  archive(): void {
    if (this.props.status === "archived") {
      throw new ConflictError("Rate card is already archived");
    }
    this.props.status = "archived";
    this.raise(
      envelope({
        eventType: LogisticsEvents.RateCardArchived,
        aggregateType: "RateCard",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { rateCardId: this.id },
      }),
    );
  }

  isEffectiveOn(dateIso: string): boolean {
    if (this.props.status !== "published") return false;
    const at = new Date(dateIso).toISOString();
    if (at < this.props.effectiveFrom) return false;
    if (this.props.effectiveTo !== undefined && at > this.props.effectiveTo) return false;
    return true;
  }

  /**
   * Resolves the rating zone for a destination. Most specific rule wins:
   * matching postal prefix (longest first), then country-only rule.
   */
  resolveZone(destination: Address): string | undefined {
    const country = destination.country.toUpperCase();
    const postal = destination.postalCode.trim();
    const candidates = this.props.zones.filter((z) => z.country === country);
    const prefixed = candidates
      .filter((z) => z.postalPrefix !== undefined && postal.startsWith(z.postalPrefix))
      .sort((a, b) => (b.postalPrefix?.length ?? 0) - (a.postalPrefix?.length ?? 0));
    if (prefixed.length > 0) return prefixed[0]!.zone;
    return candidates.find((z) => z.postalPrefix === undefined)?.zone;
  }

  /**
   * Returns the base rate (minor units) for the given zone and billable
   * weight, or undefined when the weight exceeds every break.
   */
  baseRateFor(zone: string, billableWeightKg: number): number | undefined {
    const zoneBreaks = this.props.breaks.filter((b) => b.zone === zone.toUpperCase());
    // breaks are kept sorted by weight ascending
    const match = zoneBreaks.find((b) => b.maxWeightKg >= billableWeightKg);
    return match?.amountMinor;
  }

  accessorial(code: string): Accessorial | undefined {
    return this.props.accessorials.find((a) => a.code === code.toUpperCase());
  }
}
