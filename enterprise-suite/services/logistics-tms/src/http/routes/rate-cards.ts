import type { RateCardService } from "../../application/rate-card-service.js";
import type { RatingService } from "../../application/rating-service.js";
import type { Router } from "../router.js";
import { parseAddress, parsePackage } from "../parsers.js";
import {
  expectObject,
  idParam,
  optNumber,
  optString,
  optStringArray,
  reqArray,
  reqId,
  reqNumber,
  reqString,
} from "../validate.js";
import { isTransportMode, type TransportMode } from "../../domain/values.js";

export function registerRateCardRoutes(
  router: Router,
  rateCards: RateCardService,
  rating: RatingService,
): void {
  router.post("/rate-cards", async (rc) => {
    const body = expectObject(rc.body);
    const card = await rateCards.createRateCard(rc.tenant, {
      carrierId: reqId(body, "carrierId"),
      serviceLevelCode: reqString(body, "serviceLevelCode"),
      currency: reqString(body, "currency"),
      effectiveFrom: reqString(body, "effectiveFrom"),
      effectiveTo: optString(body, "effectiveTo"),
      dimFactor: optNumber(body, "dimFactor"),
      fuelSurchargePct: optNumber(body, "fuelSurchargePct"),
    });
    return { status: 201, body: card };
  });

  router.get("/rate-cards/:rateCardId", async (rc) => {
    const card = await rateCards.getRateCard(rc.tenant, idParam(rc.params, "rateCardId"));
    return { status: 200, body: card };
  });

  router.get("/carriers/:carrierId/rate-cards", async (rc) => {
    const cards = await rateCards.listByCarrier(rc.tenant, idParam(rc.params, "carrierId"));
    return { status: 200, body: { items: cards } };
  });

  router.post("/rate-cards/:rateCardId/zones", async (rc) => {
    const body = expectObject(rc.body);
    const card = await rateCards.addZoneRule(rc.tenant, idParam(rc.params, "rateCardId"), {
      zone: reqString(body, "zone"),
      country: reqString(body, "country"),
      postalPrefix: optString(body, "postalPrefix"),
    });
    return { status: 200, body: card };
  });

  router.post("/rate-cards/:rateCardId/breaks", async (rc) => {
    const body = expectObject(rc.body);
    const card = await rateCards.addBreak(rc.tenant, idParam(rc.params, "rateCardId"), {
      zone: reqString(body, "zone"),
      maxWeightKg: reqNumber(body, "maxWeightKg"),
      amountMinor: reqNumber(body, "amountMinor"),
    });
    return { status: 200, body: card };
  });

  router.post("/rate-cards/:rateCardId/accessorials", async (rc) => {
    const body = expectObject(rc.body);
    const card = await rateCards.upsertAccessorial(rc.tenant, idParam(rc.params, "rateCardId"), {
      code: reqString(body, "code"),
      name: reqString(body, "name"),
      amountMinor: reqNumber(body, "amountMinor"),
    });
    return { status: 200, body: card };
  });

  router.post("/rate-cards/:rateCardId/fuel-surcharge", async (rc) => {
    const body = expectObject(rc.body);
    const card = await rateCards.setFuelSurcharge(
      rc.tenant,
      idParam(rc.params, "rateCardId"),
      reqNumber(body, "pct"),
    );
    return { status: 200, body: card };
  });

  router.post("/rate-cards/:rateCardId/publish", async (rc) => {
    const card = await rateCards.publish(rc.tenant, idParam(rc.params, "rateCardId"));
    return { status: 200, body: card };
  });

  router.post("/rate-cards/:rateCardId/archive", async (rc) => {
    const card = await rateCards.archive(rc.tenant, idParam(rc.params, "rateCardId"));
    return { status: 200, body: card };
  });

  // Rate shopping across all active carriers.
  router.post("/quotes", async (rc) => {
    const body = expectObject(rc.body);
    const modeRaw = optString(body, "mode");
    const mode =
      modeRaw !== undefined && isTransportMode(modeRaw) ? (modeRaw as TransportMode) : undefined;
    const quotes = await rating.quote(rc.tenant, {
      destination: parseAddress(body.destination, "destination"),
      packages: reqArray(body, "packages").map((p, i) => parsePackage(p, `packages[${i}]`)),
      accessorialCodes: optStringArray(body, "accessorialCodes"),
      shipDate: optString(body, "shipDate"),
      mode,
    });
    return { status: 200, body: { items: quotes } };
  });
}
