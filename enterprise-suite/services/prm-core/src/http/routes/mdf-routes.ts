import type { Ulid } from "@enterprise-suite/shared-kernel";
import { MDF_BUDGET_STATUSES, type MdfBudgetStatus } from "../../domain/mdf-budget.js";
import { MDF_CLAIM_STATUSES, PROOF_KINDS, type MdfClaimStatus, type ProofKind } from "../../domain/mdf-claim.js";
import {
  MDF_ACTIVITY_TYPES,
  MDF_REQUEST_STATUSES,
  type MdfActivityType,
  type MdfRequestStatus,
} from "../../domain/mdf-request.js";
import type { PrmContainer } from "../../infrastructure/container.js";
import { jsonResponse, type Router } from "../router.js";
import {
  asRecord,
  enumFromQuery,
  idFromQuery,
  optionalDate,
  optionalMoney,
  optionalNumber,
  optionalRecord,
  optionalString,
  pageFromQuery,
  requiredDate,
  requiredEnum,
  requiredMoney,
  requiredString,
} from "../validate.js";

export function registerMdfRoutes(router: Router, container: PrmContainer): void {
  const { mdfBudget, mdf } = container.services;

  // --- budgets ---------------------------------------------------------------

  router.post("/mdf/budgets", async (req) => {
    const body = asRecord(req.body);
    const budget = await mdfBudget.create(req.ctx, {
      code: requiredString(body, "code"),
      name: requiredString(body, "name"),
      period: requiredString(body, "period"),
      fiscalYearStartMonth: optionalNumber(body, "fiscalYearStartMonth"),
      total: requiredMoney(body, "total"),
      claimWindowDays: optionalNumber(body, "claimWindowDays"),
      matchingRateBps: optionalNumber(body, "matchingRateBps"),
    });
    return jsonResponse(201, budget.toJSON());
  });

  router.get("/mdf/budgets", async (req) => {
    const page = await mdfBudget.list(
      req.ctx,
      {
        status: enumFromQuery<MdfBudgetStatus>(req.query, "status", MDF_BUDGET_STATUSES),
        period: req.query.get("period") ?? undefined,
        partnerId: idFromQuery(req.query, "partnerId"),
      },
      pageFromQuery(req.query),
    );
    return jsonResponse(200, {
      ...page,
      items: page.items.map((b) => ({ ...b.toJSON(), summary: b.summary() })),
    });
  });

  router.get("/mdf/budgets/:id", async (req) => {
    const budget = await mdfBudget.get(req.ctx, req.params["id"] as Ulid);
    return jsonResponse(200, { ...budget.toJSON(), summary: budget.summary() });
  });

  router.post("/mdf/budgets/:id/open", async (req) =>
    jsonResponse(200, (await mdfBudget.open(req.ctx, req.params["id"] as Ulid)).toJSON()),
  );

  router.post("/mdf/budgets/:id/top-up", async (req) => {
    const body = asRecord(req.body);
    const budget = await mdfBudget.topUp(
      req.ctx,
      req.params["id"] as Ulid,
      requiredMoney(body, "amount"),
      requiredString(body, "reason"),
    );
    return jsonResponse(200, { ...budget.toJSON(), summary: budget.summary() });
  });

  router.post("/mdf/budgets/:id/close", async (req) =>
    jsonResponse(200, (await mdfBudget.close(req.ctx, req.params["id"] as Ulid)).toJSON()),
  );

  router.post("/mdf/budgets/:id/allocations", async (req) => {
    const body = asRecord(req.body);
    const allocation = await mdfBudget.allocate(req.ctx, req.params["id"] as Ulid, {
      partnerId: requiredString(body, "partnerId") as Ulid,
      amount: requiredMoney(body, "amount"),
      note: optionalString(body, "note"),
    });
    return jsonResponse(201, allocation);
  });

  router.patch("/mdf/budgets/:id/allocations/:allocationId", async (req) => {
    const body = asRecord(req.body);
    const allocation = await mdfBudget.adjustAllocation(
      req.ctx,
      req.params["id"] as Ulid,
      req.params["allocationId"] as Ulid,
      requiredMoney(body, "amount"),
      requiredString(body, "reason"),
    );
    return jsonResponse(200, allocation);
  });

  router.get("/partners/:id/mdf/balance", async (req) =>
    jsonResponse(200, await mdfBudget.partnerBalance(req.ctx, req.params["id"] as Ulid)),
  );

  router.get("/partners/:id/mdf/eligibility", async (req) =>
    jsonResponse(200, await mdf.eligibility(req.ctx, req.params["id"] as Ulid)),
  );

  // --- fund requests ---------------------------------------------------------

  router.post("/mdf/requests", async (req) => {
    const body = asRecord(req.body);
    const request = await mdf.createRequest(req.ctx, {
      partnerId: requiredString(body, "partnerId") as Ulid,
      budgetId: requiredString(body, "budgetId") as Ulid,
      activityType: requiredEnum<MdfActivityType>(body, "activityType", MDF_ACTIVITY_TYPES),
      title: requiredString(body, "title"),
      description: requiredString(body, "description"),
      activityStart: requiredDate(body, "activityStart"),
      activityEnd: requiredDate(body, "activityEnd"),
      requestedAmount: requiredMoney(body, "requestedAmount"),
      expectedLeads: optionalNumber(body, "expectedLeads"),
      expectedPipeline: optionalMoney(body, "expectedPipeline"),
    });
    return jsonResponse(201, request.toJSON());
  });

  router.get("/mdf/requests", async (req) => {
    const page = await mdf.listRequests(
      req.ctx,
      {
        partnerId: idFromQuery(req.query, "partnerId"),
        budgetId: idFromQuery(req.query, "budgetId"),
        status: enumFromQuery<MdfRequestStatus>(req.query, "status", MDF_REQUEST_STATUSES),
        activityType: enumFromQuery<MdfActivityType>(req.query, "activityType", MDF_ACTIVITY_TYPES),
      },
      pageFromQuery(req.query),
    );
    return jsonResponse(200, { ...page, items: page.items.map((r) => r.toJSON()) });
  });

  router.get("/mdf/requests/:id", async (req) => {
    const request = await mdf.getRequest(req.ctx, req.params["id"] as Ulid);
    return jsonResponse(200, { ...request.toJSON(), claimableRemaining: request.claimableRemaining() });
  });

  router.patch("/mdf/requests/:id", async (req) => {
    const body = asRecord(req.body);
    const request = await mdf.updateRequest(req.ctx, req.params["id"] as Ulid, {
      title: optionalString(body, "title"),
      description: optionalString(body, "description"),
      activityStart: optionalDate(body, "activityStart"),
      activityEnd: optionalDate(body, "activityEnd"),
      requestedAmount: optionalMoney(body, "requestedAmount"),
      expectedLeads: optionalNumber(body, "expectedLeads"),
      expectedPipeline: optionalMoney(body, "expectedPipeline"),
    });
    return jsonResponse(200, request.toJSON());
  });

  router.post("/mdf/requests/:id/submit", async (req) =>
    jsonResponse(200, (await mdf.submitRequest(req.ctx, req.params["id"] as Ulid)).toJSON()),
  );

  router.post("/mdf/requests/:id/approve", async (req) => {
    const body = optionalRecord(req.body);
    const request = await mdf.approveRequest(req.ctx, req.params["id"] as Ulid, {
      approvedAmount: optionalMoney(body, "approvedAmount"),
      notes: optionalString(body, "notes"),
    });
    return jsonResponse(200, request.toJSON());
  });

  router.post("/mdf/requests/:id/reject", async (req) => {
    const body = asRecord(req.body);
    const request = await mdf.rejectRequest(req.ctx, req.params["id"] as Ulid, requiredString(body, "reason"));
    return jsonResponse(200, request.toJSON());
  });

  router.post("/mdf/requests/:id/cancel", async (req) => {
    const body = asRecord(req.body);
    const request = await mdf.cancelRequest(req.ctx, req.params["id"] as Ulid, requiredString(body, "reason"));
    return jsonResponse(200, request.toJSON());
  });

  router.post("/mdf/requests/:id/close", async (req) => {
    const body = asRecord(req.body);
    const request = await mdf.closeRequest(req.ctx, req.params["id"] as Ulid, requiredString(body, "reason"));
    return jsonResponse(200, request.toJSON());
  });

  // --- claims ----------------------------------------------------------------

  router.post("/mdf/claims", async (req) => {
    const body = asRecord(req.body);
    const claim = await mdf.createClaim(req.ctx, {
      requestId: requiredString(body, "requestId") as Ulid,
      claimedAmount: requiredMoney(body, "claimedAmount"),
      activitySummary: optionalString(body, "activitySummary"),
      actualLeads: optionalNumber(body, "actualLeads"),
      actualPipeline: optionalMoney(body, "actualPipeline"),
    });
    return jsonResponse(201, claim.toJSON());
  });

  router.get("/mdf/claims", async (req) => {
    const page = await mdf.listClaims(
      req.ctx,
      {
        partnerId: idFromQuery(req.query, "partnerId"),
        requestId: idFromQuery(req.query, "requestId"),
        status: enumFromQuery<MdfClaimStatus>(req.query, "status", MDF_CLAIM_STATUSES),
      },
      pageFromQuery(req.query),
    );
    return jsonResponse(200, { ...page, items: page.items.map((c) => c.toJSON()) });
  });

  router.get("/mdf/claims/:id", async (req) => {
    const claim = await mdf.getClaim(req.ctx, req.params["id"] as Ulid);
    return jsonResponse(200, { ...claim.toJSON(), documentedSpend: claim.documentedSpend() });
  });

  router.post("/mdf/claims/:id/proofs", async (req) => {
    const body = asRecord(req.body);
    const proof = await mdf.addProof(req.ctx, req.params["id"] as Ulid, {
      kind: requiredEnum<ProofKind>(body, "kind", PROOF_KINDS),
      reference: requiredString(body, "reference"),
      documentUrl: optionalString(body, "documentUrl"),
      amount: optionalMoney(body, "amount"),
      issuedAt: optionalDate(body, "issuedAt"),
    });
    return jsonResponse(201, proof);
  });

  router.delete("/mdf/claims/:id/proofs/:proofId", async (req) => {
    await mdf.removeProof(req.ctx, req.params["id"] as Ulid, req.params["proofId"] as Ulid);
    return jsonResponse(204);
  });

  router.post("/mdf/claims/:id/submit", async (req) =>
    jsonResponse(200, (await mdf.submitClaim(req.ctx, req.params["id"] as Ulid)).toJSON()),
  );

  router.post("/mdf/claims/:id/review", async (req) =>
    jsonResponse(200, (await mdf.startClaimReview(req.ctx, req.params["id"] as Ulid)).toJSON()),
  );

  router.post("/mdf/claims/:id/approve", async (req) => {
    const body = optionalRecord(req.body);
    const claim = await mdf.approveClaim(req.ctx, req.params["id"] as Ulid, {
      approvedAmount: optionalMoney(body, "approvedAmount"),
      notes: optionalString(body, "notes"),
    });
    return jsonResponse(200, claim.toJSON());
  });

  router.post("/mdf/claims/:id/reject", async (req) => {
    const body = asRecord(req.body);
    const claim = await mdf.rejectClaim(req.ctx, req.params["id"] as Ulid, requiredString(body, "reason"));
    return jsonResponse(200, claim.toJSON());
  });

  router.post("/mdf/claims/:id/pay", async (req) => {
    const body = asRecord(req.body);
    const claim = await mdf.payClaim(req.ctx, req.params["id"] as Ulid, requiredString(body, "reference"));
    return jsonResponse(200, claim.toJSON());
  });
}
