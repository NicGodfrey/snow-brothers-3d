import {
  DomainError,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import {
  compareQuotes,
  computeQuote,
  type RatablePackage,
  type RateQuote,
} from "../domain/rating.js";
import { validateAddress, type Address, type TransportMode } from "../domain/values.js";
import type { CarrierRepository, RateCardRepository } from "../infrastructure/repositories.js";

export interface QuoteRequest {
  readonly destination: Address;
  readonly packages: readonly RatablePackage[];
  readonly accessorialCodes?: readonly string[];
  /** Rating date; defaults to "now". Drives rate-card effectivity. */
  readonly shipDate?: string;
  /** Restrict shopping to one mode (e.g. only parcel carriers). */
  readonly mode?: TransportMode;
}

/**
 * Rate shopping: evaluates every active carrier's service levels against
 * their effective published rate cards and returns viable quotes sorted
 * cheapest-first. Carriers that cannot serve the destination, weight, or
 * requested accessorials are silently skipped — an empty result means
 * "no capacity", not an error.
 */
export class RatingService {
  constructor(
    private readonly carriers: CarrierRepository,
    private readonly rateCards: RateCardRepository,
  ) {}

  async quote(ctx: TenantContext, request: QuoteRequest): Promise<RateQuote[]> {
    const destination = validateAddress(request.destination, "destination");
    if (!Array.isArray(request.packages) || request.packages.length === 0) {
      throw new DomainError("At least one package is required for a quote", "VALIDATION");
    }
    const atIso =
      request.shipDate !== undefined
        ? new Date(request.shipDate).toISOString()
        : new Date().toISOString();
    if (Number.isNaN(Date.parse(atIso))) {
      throw new DomainError("shipDate must be a valid date", "VALIDATION");
    }

    const activeCarriers = await this.carriers.list(ctx.tenantId, {
      status: "active",
      mode: request.mode,
    });

    const quotes: RateQuote[] = [];
    for (const carrier of activeCarriers) {
      for (const serviceLevel of carrier.serviceLevels) {
        const cards = await this.rateCards.findEffective(
          ctx.tenantId,
          carrier.id,
          serviceLevel.code,
          atIso,
        );
        const card = cards[0];
        if (card === undefined) continue;
        const quote = computeQuote({
          carrier,
          serviceLevel,
          rateCard: card,
          destination,
          packages: request.packages,
          accessorialCodes: request.accessorialCodes,
        });
        if (quote !== undefined) quotes.push(quote);
      }
    }
    return quotes.sort(compareQuotes);
  }

  /**
   * Rates one specific carrier + service level. Used by shipment booking,
   * where "no rate available" is an error rather than an empty list.
   */
  async quoteFor(
    ctx: TenantContext,
    input: {
      carrierId: Ulid;
      serviceLevelCode: string;
      destination: Address;
      packages: readonly RatablePackage[];
      accessorialCodes?: readonly string[];
      shipDate?: string;
    },
  ): Promise<RateQuote> {
    const carrier = await this.carriers.findById(ctx.tenantId, input.carrierId);
    if (carrier === undefined || !carrier.isActive()) {
      throw new DomainError(
        `Carrier ${input.carrierId} is not available for booking`,
        "CARRIER_UNAVAILABLE",
        422,
      );
    }
    const serviceLevel = carrier.serviceLevel(input.serviceLevelCode);
    if (serviceLevel === undefined) {
      throw new DomainError(
        `Carrier ${carrier.code} does not offer service level '${input.serviceLevelCode}'`,
        "VALIDATION",
        422,
      );
    }
    const atIso =
      input.shipDate !== undefined
        ? new Date(input.shipDate).toISOString()
        : new Date().toISOString();
    const cards = await this.rateCards.findEffective(
      ctx.tenantId,
      carrier.id,
      serviceLevel.code,
      atIso,
    );
    const card = cards[0];
    if (card === undefined) {
      throw new DomainError(
        `No effective rate card for ${carrier.code}/${serviceLevel.code}`,
        "NO_RATE",
        422,
      );
    }
    const quote = computeQuote({
      carrier,
      serviceLevel,
      rateCard: card,
      destination: validateAddress(input.destination, "destination"),
      packages: input.packages,
      accessorialCodes: input.accessorialCodes,
    });
    if (quote === undefined) {
      throw new DomainError(
        `${carrier.code}/${serviceLevel.code} cannot rate this shipment (zone, weight, or accessorial not covered)`,
        "NO_RATE",
        422,
      );
    }
    return quote;
  }
}
