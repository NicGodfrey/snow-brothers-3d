import type { Ulid } from "@enterprise-suite/shared-kernel";
import { CONTRACT_TYPES, type ContractStatus, type ContractType } from "../../domain/contract.js";
import {
  MEASUREMENT_WINDOWS,
  SLA_METRIC_SPECS,
  SLA_METRICS,
  type MeasurementWindow,
  type PenaltyModel,
  type SlaEscalation,
  type SlaMetric,
} from "../../domain/sla.js";
import { ValidationError } from "../../domain/errors.js";
import type { SrmContainer } from "../../infrastructure/container.js";
import { jsonResponse, type Router } from "../router.js";
import {
  asRecord,
  optionalArray,
  optionalBoolean,
  optionalDate,
  optionalEnum,
  optionalId,
  optionalIdArray,
  optionalNumber,
  optionalString,
  pageFromQuery,
  queryDate,
  queryEnum,
  queryId,
  queryNumber,
  requiredDate,
  requiredEnum,
  requiredId,
  requiredNumber,
  requiredString,
} from "../validate.js";

const CONTRACT_STATUSES = [
  "draft",
  "pending_signature",
  "signed",
  "active",
  "expired",
  "terminated",
  "superseded",
] as const satisfies readonly ContractStatus[];

const PENALTY_KINDS = ["none", "service_credit_percent", "fixed_credit"] as const;

function parsePenalty(raw: Record<string, unknown>): PenaltyModel {
  const kind = requiredEnum(raw, "kind", PENALTY_KINDS);
  switch (kind) {
    case "none":
      return { kind };
    case "service_credit_percent":
      return { kind, percent: requiredNumber(raw, "percent") };
    case "fixed_credit":
      return {
        kind,
        amountMinor: requiredNumber(raw, "amountMinor"),
        currency: requiredString(raw, "currency"),
      };
  }
}

function parseEscalations(raw: readonly unknown[]): SlaEscalation[] {
  return raw.map((entry) => {
    const escalation = asRecord(entry);
    return {
      afterBreaches: requiredNumber(escalation, "afterBreaches"),
      action: requiredString(escalation, "action"),
    };
  });
}

export function registerContractRoutes(router: Router, container: SrmContainer): void {
  const { services } = container;

  /** The measurable service levels a commitment can be written against. */
  router.get("/sla-metrics", () => jsonResponse(200, SLA_METRICS.map((metric) => SLA_METRIC_SPECS[metric])));

  router.post("/contracts", async (req) => {
    const body = asRecord(req.body);
    const contract = await services.contract.draft(req.ctx, {
      supplierId: requiredId(body, "supplierId"),
      type: requiredEnum<ContractType>(body, "type", CONTRACT_TYPES),
      title: requiredString(body, "title"),
      currency: optionalString(body, "currency"),
      effectiveFrom: optionalDate(body, "effectiveFrom"),
      effectiveTo: optionalDate(body, "effectiveTo"),
      autoRenew: optionalBoolean(body, "autoRenew"),
      renewalTermMonths: optionalNumber(body, "renewalTermMonths"),
      noticeDays: optionalNumber(body, "noticeDays"),
      paymentTermsCode: optionalString(body, "paymentTermsCode"),
      incoterm: optionalString(body, "incoterm"),
      categoryIds: optionalIdArray(body, "categoryIds"),
      minimumCommitmentMinor: optionalNumber(body, "minimumCommitmentMinor"),
      spendCapMinor: optionalNumber(body, "spendCapMinor"),
      parentContractId: optionalId(body, "parentContractId"),
      documentRef: optionalString(body, "documentRef"),
    });
    return jsonResponse(201, contract.toJSON());
  });

  router.get("/contracts", async (req) => {
    const page = await services.contract.list(
      req.ctx,
      {
        supplierId: queryId(req.query, "supplierId"),
        status: queryEnum<ContractStatus>(req.query, "status", CONTRACT_STATUSES),
        type: queryEnum<ContractType>(req.query, "type", CONTRACT_TYPES),
        categoryId: queryId(req.query, "categoryId"),
        expiringBefore: queryDate(req.query, "expiringBefore"),
      },
      pageFromQuery(req.query),
    );
    return jsonResponse(200, { ...page, items: page.items.map((entry) => entry.toJSON()) });
  });

  router.get("/contracts/expiring", async (req) => {
    const contracts = await services.contract.expiringSoon(req.ctx, queryNumber(req.query, "withinDays") ?? 90);
    return jsonResponse(200, contracts.map((contract) => contract.toJSON()));
  });

  router.get("/contracts/:id", async (req) =>
    jsonResponse(200, (await services.contract.get(req.ctx, req.params["id"] as Ulid)).toJSON()),
  );

  // --- execution -----------------------------------------------------------

  router.post("/contracts/:id/signatories", async (req) => {
    const body = asRecord(req.body);
    const signatory = await services.contract.addSignatory(req.ctx, req.params["id"] as Ulid, {
      party: requiredEnum(body, "party", ["buyer", "supplier"] as const),
      name: requiredString(body, "name"),
      title: optionalString(body, "title"),
      email: optionalString(body, "email"),
    });
    return jsonResponse(201, signatory);
  });

  router.post("/contracts/:id/send-for-signature", async (req) =>
    jsonResponse(200, (await services.contract.sendForSignature(req.ctx, req.params["id"] as Ulid)).toJSON()),
  );

  router.post("/contracts/:id/sign", async (req) => {
    const body = asRecord(req.body);
    const contract = await services.contract.sign(req.ctx, req.params["id"] as Ulid, requiredId(body, "signatoryId"));
    return jsonResponse(200, contract.toJSON());
  });

  router.post("/contracts/:id/activate", async (req) =>
    jsonResponse(200, (await services.contract.activate(req.ctx, req.params["id"] as Ulid)).toJSON()),
  );

  // --- pricing -------------------------------------------------------------

  router.post("/contracts/:id/price-lines", async (req) => {
    const body = asRecord(req.body);
    const line = await services.contract.addPriceLine(req.ctx, req.params["id"] as Ulid, {
      description: requiredString(body, "description"),
      uom: requiredString(body, "uom"),
      unitPriceMinor: requiredNumber(body, "unitPriceMinor"),
      itemCode: optionalString(body, "itemCode"),
      categoryId: optionalId(body, "categoryId"),
      minQuantity: optionalNumber(body, "minQuantity"),
      leadTimeDays: optionalNumber(body, "leadTimeDays"),
      validFrom: requiredDate(body, "validFrom"),
      validTo: optionalDate(body, "validTo"),
    });
    return jsonResponse(201, line);
  });

  router.post("/contracts/:id/price-lines/:lineId/expire", async (req) => {
    const body = asRecord(req.body);
    const line = await services.contract.expirePriceLine(
      req.ctx,
      req.params["id"] as Ulid,
      req.params["lineId"] as Ulid,
      requiredDate(body, "validTo"),
    );
    return jsonResponse(200, line);
  });

  /** Best contracted price for a quantity across the supplier's contracts. */
  router.get("/suppliers/:id/price-quote", async (req) => {
    const quantity = queryNumber(req.query, "quantity");
    if (quantity === undefined) throw ValidationError.single("quantity", "is required");
    const quote = await services.contract.quote(req.ctx, req.params["id"] as Ulid, {
      itemCode: req.query.get("itemCode") ?? undefined,
      categoryId: queryId(req.query, "categoryId"),
      quantity,
      asOf: queryDate(req.query, "asOf"),
    });
    return quote ? jsonResponse(200, quote) : jsonResponse(404, { code: "NO_CONTRACTED_PRICE", message: "No active contracted price covers this request" });
  });

  // --- service levels ------------------------------------------------------

  router.post("/contracts/:id/commitments", async (req) => {
    const body = asRecord(req.body);
    const penalty = body["penalty"] === undefined ? undefined : parsePenalty(asRecord(body["penalty"]));
    const escalations = optionalArray(body, "escalations");
    const commitment = await services.contract.addCommitment(req.ctx, req.params["id"] as Ulid, {
      metric: requiredEnum<SlaMetric>(body, "metric", SLA_METRICS),
      target: requiredNumber(body, "target"),
      tolerance: optionalNumber(body, "tolerance"),
      window: optionalEnum<MeasurementWindow>(body, "window", MEASUREMENT_WINDOWS),
      graceBreaches: optionalNumber(body, "graceBreaches"),
      penalty,
      creditCapPercent: optionalNumber(body, "creditCapPercent"),
      escalations: escalations ? parseEscalations(escalations) : undefined,
      description: optionalString(body, "description"),
      effectiveFrom: optionalDate(body, "effectiveFrom"),
    });
    return jsonResponse(201, commitment);
  });

  /** Manual SLA result entry; published scorecards feed the same path. */
  router.post("/contracts/:id/sla-results", async (req) => {
    const body = asRecord(req.body);
    const breach = await services.contract.recordSlaResult(req.ctx, req.params["id"] as Ulid, {
      commitmentId: requiredId(body, "commitmentId"),
      periodCode: requiredString(body, "periodCode"),
      measured: requiredNumber(body, "measured"),
      periodSpendMinor: optionalNumber(body, "periodSpendMinor"),
      note: optionalString(body, "note"),
    });
    return jsonResponse(200, { breached: breach !== undefined, breach });
  });

  router.post("/contracts/:id/breaches/:breachId/acknowledge", async (req) => {
    const body = asRecord(req.body ?? {});
    const breach = await services.contract.acknowledgeBreach(
      req.ctx,
      req.params["id"] as Ulid,
      req.params["breachId"] as Ulid,
      optionalString(body, "note"),
    );
    return jsonResponse(200, breach);
  });

  router.post("/contracts/:id/breaches/:breachId/credit", async (req) => {
    const body = asRecord(req.body ?? {});
    const breach = await services.contract.creditBreach(
      req.ctx,
      req.params["id"] as Ulid,
      req.params["breachId"] as Ulid,
      optionalString(body, "note"),
    );
    return jsonResponse(200, breach);
  });

  router.post("/contracts/:id/breaches/:breachId/waive", async (req) => {
    const body = asRecord(req.body);
    const breach = await services.contract.waiveBreach(
      req.ctx,
      req.params["id"] as Ulid,
      req.params["breachId"] as Ulid,
      requiredString(body, "reason"),
    );
    return jsonResponse(200, breach);
  });

  // --- change control ------------------------------------------------------

  router.post("/contracts/:id/amendments", async (req) => {
    const body = asRecord(req.body);
    const amendment = await services.contract.amend(req.ctx, req.params["id"] as Ulid, requiredString(body, "changeNote"), {
      title: optionalString(body, "title"),
      effectiveTo: optionalDate(body, "effectiveTo"),
      autoRenew: optionalBoolean(body, "autoRenew"),
      noticeDays: optionalNumber(body, "noticeDays"),
      minimumCommitmentMinor: optionalNumber(body, "minimumCommitmentMinor"),
      spendCapMinor: optionalNumber(body, "spendCapMinor"),
      categoryIds: optionalIdArray(body, "categoryIds"),
    });
    return jsonResponse(201, amendment);
  });

  router.post("/contracts/:id/renew", async (req) => {
    const body = asRecord(req.body ?? {});
    const renewal = await services.contract.renew(req.ctx, req.params["id"] as Ulid, optionalNumber(body, "termMonths"));
    return jsonResponse(200, renewal);
  });

  router.post("/contracts/:id/terminate", async (req) => {
    const body = asRecord(req.body);
    const contract = await services.contract.terminate(req.ctx, req.params["id"] as Ulid, {
      reason: requiredString(body, "reason"),
      terminationDate: requiredDate(body, "terminationDate"),
      waiveNotice: optionalBoolean(body, "waiveNotice"),
    });
    return jsonResponse(200, contract.toJSON());
  });

  router.post("/contracts/:id/supersede", async (req) => {
    const body = asRecord(req.body);
    const contract = await services.contract.supersede(
      req.ctx,
      req.params["id"] as Ulid,
      requiredId(body, "successorContractId"),
    );
    return jsonResponse(200, contract.toJSON());
  });

  /** Nightly term sweep: warn, auto-renew, expire, hold uncovered categories. */
  router.post("/jobs/contract-term-sweep", async (req) => {
    const body = asRecord(req.body ?? {});
    const result = await services.contract.runTermSweep(req.ctx, optionalNumber(body, "horizonDays"));
    return jsonResponse(200, result);
  });
}
