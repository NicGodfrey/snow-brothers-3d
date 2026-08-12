import type { Ulid } from "@enterprise-suite/shared-kernel";
import {
  CONTRACT_STATUSES,
  CONTRACT_TYPES,
  type ContractStatus,
  type ContractType,
  type ObligationStatus,
  type SignatureParty,
} from "../../domain/contract.js";
import type { PrmContainer } from "../../infrastructure/container.js";
import { jsonResponse, type Router } from "../router.js";
import {
  asRecord,
  enumFromQuery,
  idFromQuery,
  optionalBoolean,
  optionalDate,
  optionalMoney,
  optionalNumber,
  optionalRecord,
  optionalString,
  pageFromQuery,
  requiredDate,
  requiredEnum,
  requiredNumber,
  requiredString,
} from "../validate.js";

const OBLIGATION_OUTCOMES: readonly Exclude<ObligationStatus, "pending">[] = ["met", "waived", "breached"];
const SIGNATURE_PARTIES: readonly SignatureParty[] = ["partner", "vendor"];

export function registerContractRoutes(router: Router, container: PrmContainer): void {
  const { contract } = container.services;

  router.post("/contracts", async (req) => {
    const body = asRecord(req.body);
    const drafted = await contract.draft(req.ctx, {
      partnerId: requiredString(body, "partnerId") as Ulid,
      type: requiredEnum<ContractType>(body, "type", CONTRACT_TYPES),
      title: optionalString(body, "title"),
      currency: requiredString(body, "currency"),
      effectiveFrom: requiredDate(body, "effectiveFrom"),
      effectiveTo: requiredDate(body, "effectiveTo"),
      autoRenew: optionalBoolean(body, "autoRenew"),
      renewalTermMonths: optionalNumber(body, "renewalTermMonths"),
      noticeDays: optionalNumber(body, "noticeDays"),
      paymentTermsDays: optionalNumber(body, "paymentTermsDays"),
      baseDiscountBps: optionalNumber(body, "baseDiscountBps"),
      mdfEligible: optionalBoolean(body, "mdfEligible"),
      mdfAccrualBps: optionalNumber(body, "mdfAccrualBps"),
      revenueCommitment: optionalMoney(body, "revenueCommitment"),
      governingLaw: optionalString(body, "governingLaw"),
    });
    return jsonResponse(201, drafted.toJSON());
  });

  router.get("/contracts", async (req) => {
    const page = await contract.list(
      req.ctx,
      {
        partnerId: idFromQuery(req.query, "partnerId"),
        status: enumFromQuery<ContractStatus>(req.query, "status", CONTRACT_STATUSES),
        type: enumFromQuery<ContractType>(req.query, "type", CONTRACT_TYPES),
        expiringBefore: (req.query.get("expiringBefore") as never) ?? undefined,
      },
      pageFromQuery(req.query),
    );
    return jsonResponse(200, { ...page, items: page.items.map((c) => c.toJSON()) });
  });

  router.get("/contracts/:id", async (req) =>
    jsonResponse(200, (await contract.get(req.ctx, req.params["id"] as Ulid)).toJSON()),
  );

  router.get("/partners/:id/contracts", async (req) => {
    const contracts = await contract.forPartner(req.ctx, req.params["id"] as Ulid);
    return jsonResponse(200, contracts.map((c) => c.toJSON()));
  });

  /** Discount actually applicable to a product scope right now. */
  router.get("/partners/:id/pricing", async (req) => {
    const scope = req.query.get("scope") ?? "*";
    const effective = await contract.effectiveForPartner(req.ctx, req.params["id"] as Ulid);
    return jsonResponse(200, {
      scope,
      contracts: effective.map((c) => ({
        contractId: c.id,
        number: c.number,
        type: c.type,
        discountBps: c.effectiveDiscountBps(scope),
        baseDiscountBps: c.baseDiscountBps,
      })),
      bestDiscountBps: effective.reduce((best, c) => Math.max(best, c.effectiveDiscountBps(scope)), 0),
    });
  });

  router.patch("/contracts/:id", async (req) => {
    const body = asRecord(req.body);
    const updated = await contract.updateTerms(req.ctx, req.params["id"] as Ulid, {
      effectiveFrom: optionalDate(body, "effectiveFrom"),
      effectiveTo: optionalDate(body, "effectiveTo"),
      autoRenew: optionalBoolean(body, "autoRenew"),
      renewalTermMonths: optionalNumber(body, "renewalTermMonths"),
      noticeDays: optionalNumber(body, "noticeDays"),
      paymentTermsDays: optionalNumber(body, "paymentTermsDays"),
      baseDiscountBps: optionalNumber(body, "baseDiscountBps"),
      mdfEligible: optionalBoolean(body, "mdfEligible"),
      mdfAccrualBps: optionalNumber(body, "mdfAccrualBps"),
      revenueCommitment: optionalMoney(body, "revenueCommitment"),
      governingLaw: optionalString(body, "governingLaw"),
    });
    return jsonResponse(200, updated.toJSON());
  });

  router.post("/contracts/:id/discount-lines", async (req) => {
    const body = asRecord(req.body);
    const line = await contract.addDiscountLine(req.ctx, req.params["id"] as Ulid, {
      scope: requiredString(body, "scope"),
      discountBps: requiredNumber(body, "discountBps"),
      minAnnualVolume: optionalMoney(body, "minAnnualVolume"),
      note: optionalString(body, "note"),
    });
    return jsonResponse(201, line);
  });

  router.delete("/contracts/:id/discount-lines/:lineId", async (req) => {
    await contract.removeDiscountLine(req.ctx, req.params["id"] as Ulid, req.params["lineId"] as Ulid);
    return jsonResponse(204);
  });

  router.post("/contracts/:id/obligations", async (req) => {
    const body = asRecord(req.body);
    const obligation = await contract.addObligation(req.ctx, req.params["id"] as Ulid, {
      code: requiredString(body, "code"),
      description: requiredString(body, "description"),
      dueAt: optionalDate(body, "dueAt"),
    });
    return jsonResponse(201, obligation);
  });

  router.post("/contracts/:id/obligations/:code", async (req) => {
    const body = asRecord(req.body);
    const obligation = await contract.recordObligation(req.ctx, req.params["id"] as Ulid, {
      code: req.params["code"]!,
      status: requiredEnum(body, "status", OBLIGATION_OUTCOMES),
      evidence: optionalString(body, "evidence"),
    });
    return jsonResponse(200, obligation);
  });

  router.post("/contracts/:id/send", async (req) =>
    jsonResponse(200, (await contract.sendForSignature(req.ctx, req.params["id"] as Ulid)).toJSON()),
  );

  router.post("/contracts/:id/sign", async (req) => {
    const body = asRecord(req.body);
    const signed = await contract.sign(req.ctx, req.params["id"] as Ulid, {
      party: requiredEnum<SignatureParty>(body, "party", SIGNATURE_PARTIES),
      signatoryName: requiredString(body, "signatoryName"),
      signatoryEmail: requiredString(body, "signatoryEmail"),
      signatoryTitle: optionalString(body, "signatoryTitle"),
    });
    return jsonResponse(200, signed.toJSON());
  });

  router.post("/contracts/:id/activate", async (req) =>
    jsonResponse(200, (await contract.activate(req.ctx, req.params["id"] as Ulid)).toJSON()),
  );

  router.post("/contracts/:id/cancel", async (req) => {
    const body = asRecord(req.body);
    const cancelled = await contract.cancel(req.ctx, req.params["id"] as Ulid, requiredString(body, "reason"));
    return jsonResponse(200, cancelled.toJSON());
  });

  router.post("/contracts/:id/amendments", async (req) => {
    const body = asRecord(req.body);
    const amendment = await contract.amend(req.ctx, req.params["id"] as Ulid, {
      summary: requiredString(body, "summary"),
      effectiveFrom: requiredDate(body, "effectiveFrom"),
      baseDiscountBps: optionalNumber(body, "baseDiscountBps"),
      effectiveTo: optionalDate(body, "effectiveTo"),
    });
    return jsonResponse(201, amendment);
  });

  router.post("/contracts/:id/renew", async (req) => {
    const body = optionalRecord(req.body);
    const renewed = await contract.renew(req.ctx, req.params["id"] as Ulid, optionalNumber(body, "months"));
    return jsonResponse(200, renewed.toJSON());
  });

  router.post("/contracts/:id/terminate", async (req) => {
    const body = asRecord(req.body);
    const terminated = await contract.terminate(
      req.ctx,
      req.params["id"] as Ulid,
      requiredString(body, "reason"),
    );
    return jsonResponse(200, terminated.toJSON());
  });

  /** Batch job endpoint: roll auto-renewals forward, expire the rest. */
  router.post("/contract-sweeps", async (req) => {
    const body = optionalRecord(req.body);
    const result = await contract.sweepExpiries(req.ctx, optionalDate(body, "at"));
    return jsonResponse(200, result);
  });
}
