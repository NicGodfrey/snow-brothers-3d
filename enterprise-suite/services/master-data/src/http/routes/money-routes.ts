import type { Ulid } from "@enterprise-suite/shared-kernel";
import { ROUNDING_MODES, moneyFromMinor, type RoundingMode } from "../../domain/currency.js";
import { ValidationError } from "../../domain/errors.js";
import { FX_RATE_TYPES, type FxRateInput, type FxRateType } from "../../domain/fx.js";
import type { MasterDataContainer } from "../../infrastructure/container.js";
import { jsonResponse, type Router } from "../router.js";
import {
  asRecord,
  optionalBoolean,
  optionalEnum,
  optionalInteger,
  optionalString,
  requiredInteger,
  requiredNumber,
  requiredQuery,
  requiredString,
} from "../validate.js";

/** Currency configuration, FX maintenance and conversion. */
export function registerMoneyRoutes(router: Router, container: MasterDataContainer): void {
  const { currency, fx } = container.services;

  // --- currencies ------------------------------------------------------------

  /** ISO 4217 reference data, unfiltered by tenant configuration. */
  router.get("/currencies/iso", () => jsonResponse(200, currency.listIsoCurrencies()));

  router.get("/currencies", async (req) =>
    jsonResponse(
      200,
      req.query.get("enabled") === "true"
        ? await currency.listEnabled(req.ctx)
        : await currency.list(req.ctx),
    ),
  );

  router.get("/currencies/functional", async (req) =>
    jsonResponse(200, { code: await currency.functionalCurrency(req.ctx) }),
  );

  router.post("/currencies", async (req) => {
    const body = asRecord(req.body);
    const enabled = await currency.enable(req.ctx, {
      code: requiredString(body, "code"),
      roundingMode: optionalEnum<RoundingMode>(body, "roundingMode", ROUNDING_MODES),
      displaySymbol: optionalString(body, "displaySymbol"),
      functional: optionalBoolean(body, "functional"),
    });
    return jsonResponse(201, enabled);
  });

  router.post("/currencies/:code/functional", async (req) =>
    jsonResponse(200, await currency.setFunctional(req.ctx, req.params["code"]!)),
  );

  router.delete("/currencies/:code", async (req) =>
    jsonResponse(200, await currency.disable(req.ctx, req.params["code"]!)),
  );

  /**
   * Splits an amount across weights without losing minor units — the same
   * routine instalments and tax apportionment use.
   */
  router.post("/currencies/:code/allocate", async (req) => {
    const body = asRecord(req.body);
    const amount = moneyFromMinor(requiredInteger(body, "amountMinor"), req.params["code"]!);
    const weights = body["weights"];
    if (!Array.isArray(weights) || weights.some((weight) => typeof weight !== "number")) {
      throw ValidationError.single("weights", "must be an array of numbers");
    }
    const parts = currency.allocate(amount, weights as number[]);
    return jsonResponse(200, {
      amount,
      parts,
      formatted: parts.map((part) => currency.format(part, { withSymbol: true })),
    });
  });

  // --- fx rates --------------------------------------------------------------

  router.get("/fx/rates", async (req) =>
    jsonResponse(
      200,
      await fx.list(req.ctx, {
        base: req.query.get("base") ?? undefined,
        quote: req.query.get("quote") ?? undefined,
        rateType: (req.query.get("rateType") as FxRateType | null) ?? undefined,
        asOf: req.query.get("asOf") ?? undefined,
      }),
    ),
  );

  router.post("/fx/rates", async (req) => {
    const body = asRecord(req.body);
    const quoted = await fx.quote(req.ctx, readRateInput(body));
    return jsonResponse(201, quoted);
  });

  /** Provider feed load: accepted rows and per-row rejection reasons. */
  router.post("/fx/rates/bulk", async (req) => {
    const body = asRecord(req.body);
    const rows = body["rates"];
    if (!Array.isArray(rows) || rows.length === 0) {
      throw ValidationError.single("rates", "must be a non-empty array of rate objects");
    }
    const result = await fx.quoteMany(
      req.ctx,
      rows.map((row) => readRateInput(asRecord(row))),
    );
    return jsonResponse(result.rejected.length === 0 ? 201 : 207, result);
  });

  router.get("/fx/history", async (req) =>
    jsonResponse(
      200,
      await fx.history(
        req.ctx,
        requiredQuery(req.query, "base"),
        requiredQuery(req.query, "quote"),
        (req.query.get("rateType") as FxRateType | null) ?? undefined,
      ),
    ),
  );

  /** Shows the resolution path (direct, inverse or triangulated) and factor. */
  router.get("/fx/resolve", async (req) =>
    jsonResponse(
      200,
      await fx.resolve(req.ctx, requiredQuery(req.query, "base"), requiredQuery(req.query, "quote"), {
        asOf: req.query.get("asOf") ?? undefined,
        rateType: (req.query.get("rateType") as FxRateType | null) ?? undefined,
        directOnly: req.query.get("directOnly") === "true",
      }),
    ),
  );

  router.post("/fx/convert", async (req) => {
    const body = asRecord(req.body);
    const conversion = await fx.convert(req.ctx, {
      amountMinor: requiredInteger(body, "amountMinor"),
      from: requiredString(body, "from"),
      to: requiredString(body, "to"),
      asOf: optionalString(body, "asOf"),
      rateType: optionalEnum<FxRateType>(body, "rateType", FX_RATE_TYPES),
      rounding: optionalEnum<RoundingMode>(body, "rounding", ROUNDING_MODES),
    });
    return jsonResponse(200, conversion);
  });

  /** Transaction, functional and reporting views of one amount. */
  router.post("/fx/express", async (req) => {
    const body = asRecord(req.body);
    const amounts = await fx.expressInAll(
      req.ctx,
      moneyFromMinor(requiredInteger(body, "amountMinor"), requiredString(body, "currency")),
      requiredString(body, "reportingCurrency"),
      {
        asOf: optionalString(body, "asOf"),
        rateType: optionalEnum<FxRateType>(body, "rateType", FX_RATE_TYPES),
      },
    );
    return jsonResponse(200, amounts);
  });

  router.post("/fx/rates/:id/correction", async (req) => {
    const body = asRecord(req.body);
    const corrected = await fx.correct(
      req.ctx,
      req.params["id"] as Ulid,
      requiredNumber(body, "rate"),
      requiredString(body, "reason"),
    );
    return jsonResponse(200, corrected);
  });
}

function readRateInput(body: Record<string, unknown>): FxRateInput {
  return {
    base: requiredString(body, "base"),
    quote: requiredString(body, "quote"),
    rate: requiredNumber(body, "rate"),
    unit: optionalInteger(body, "unit"),
    rateType: optionalEnum<FxRateType>(body, "rateType", FX_RATE_TYPES),
    validFrom: requiredString(body, "validFrom"),
    validTo: optionalString(body, "validTo"),
    source: optionalString(body, "source"),
  };
}
