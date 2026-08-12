import { renderAddress, type GeoPoint } from "../../domain/address.js";
import {
  IDENTIFIER_SCHEMES,
  validateIdentifier,
  type IdentifierScheme,
} from "../../domain/identifiers.js";
import type { MasterDataContainer } from "../../infrastructure/container.js";
import { jsonResponse, type Router } from "../router.js";
import {
  asRecord,
  optionalString,
  requiredAddress,
  requiredEnum,
  requiredNumber,
  requiredString,
} from "../validate.js";

/** Country reference data, address validation and identifier checking. */
export function registerReferenceRoutes(router: Router, container: MasterDataContainer): void {
  const { address } = container.services;

  router.get("/countries", (req) =>
    jsonResponse(
      200,
      address.listCountries({
        euOnly: req.query.get("eu") === "true",
        search: req.query.get("search") ?? undefined,
      }),
    ),
  );

  router.get("/countries/:code", (req) => jsonResponse(200, address.getCountry(req.params["code"]!)));

  router.get("/countries/:code/subdivisions", (req) =>
    jsonResponse(200, address.listSubdivisions(req.params["code"]!)),
  );

  // Normalizes and grades an address; never throws on bad input so importers
  // can post a batch and triage the issues.
  router.post("/addresses/validate", (req) => {
    const body = asRecord(req.body);
    const input = body["address"] !== undefined ? requiredAddress(body) : requiredAddress({ address: body });
    return jsonResponse(200, address.check(input));
  });

  router.post("/addresses/format", (req) => {
    const body = asRecord(req.body);
    const input = body["address"] !== undefined ? requiredAddress(body) : requiredAddress({ address: body });
    const normalized = address.require(input);
    return jsonResponse(200, {
      address: normalized,
      lines: renderAddress(normalized),
      label: address.format(normalized),
    });
  });

  /** Great-circle distance between two points, in kilometres. */
  router.post("/geo/distance", (req) => {
    const body = asRecord(req.body);
    return jsonResponse(200, {
      distanceKm: address.distanceKm(readPoint(body, "from"), readPoint(body, "to")),
    });
  });

  router.post("/identifiers/validate", (req) => {
    const body = asRecord(req.body);
    const scheme = requiredEnum<IdentifierScheme>(body, "scheme", IDENTIFIER_SCHEMES);
    return jsonResponse(
      200,
      validateIdentifier({
        scheme,
        value: requiredString(body, "value"),
        countryCode: optionalString(body, "countryCode"),
      }),
    );
  });
}

function readPoint(body: Record<string, unknown>, field: string): GeoPoint {
  const point = asRecord(body[field]);
  return {
    latitude: requiredNumber(point, "latitude"),
    longitude: requiredNumber(point, "longitude"),
  };
}
