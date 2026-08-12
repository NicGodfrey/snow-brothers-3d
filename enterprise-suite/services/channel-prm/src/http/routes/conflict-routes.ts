import type { Ulid, UserId } from "@enterprise-suite/shared-kernel";
import { conflictView, pageView } from "../../application/dto.js";
import {
  CONFLICT_KINDS,
  CONFLICT_OUTCOMES,
  type ConflictEvidence,
  type ConflictKind,
  type ConflictOutcome,
  type ConflictStatus,
} from "../../domain/conflict.js";
import type { ChannelContainer } from "../../infrastructure/container.js";
import { jsonResponse, type Router } from "../router.js";
import {
  asRecord,
  enumFromQuery,
  optionalNumber,
  optionalString,
  optionalStringArray,
  pageFromQuery,
  requiredEnum,
  requiredString,
} from "../validate.js";

const CONFLICT_STATUSES: readonly ConflictStatus[] = ["open", "under_review", "resolved", "withdrawn"];
const EVIDENCE_SOURCES: readonly ConflictEvidence["source"][] = ["claimant", "incumbent", "vendor"];

export function registerConflictRoutes(router: Router, container: ChannelContainer): void {
  const { services, clock } = container;

  router.get("/conflicts", async (req) => {
    const page = await services.conflict.list(
      req.ctx,
      {
        status: enumFromQuery<ConflictStatus>(req.query, "status", CONFLICT_STATUSES),
        kind: enumFromQuery<ConflictKind>(req.query, "kind", CONFLICT_KINDS),
        partnerId: (req.query.get("partnerId") as Ulid | null) ?? undefined,
        customerKey: req.query.get("customerKey") ?? undefined,
        overdueAt: req.query.get("overdue") === "true" ? clock.now() : undefined,
      },
      pageFromQuery(req.query),
    );
    return jsonResponse(200, pageView(page, (conflict) => conflictView(conflict, clock.now())));
  });

  router.get("/conflicts/:id", async (req) =>
    jsonResponse(200, conflictView(await services.conflict.get(req.ctx, req.params["id"] as Ulid), clock.now())),
  );

  router.post("/conflicts/:id/evidence", async (req) => {
    const body = asRecord(req.body);
    const entry = await services.conflict.addEvidence(req.ctx, req.params["id"] as Ulid, {
      source: requiredEnum<ConflictEvidence["source"]>(body, "source", EVIDENCE_SOURCES),
      note: requiredString(body, "note"),
    });
    return jsonResponse(201, entry);
  });

  router.post("/conflicts/:id/review", async (req) =>
    jsonResponse(200, conflictView(await services.conflict.startReview(req.ctx, req.params["id"] as Ulid), clock.now())),
  );

  router.post("/conflicts/:id/escalate", async (req) => {
    const body = asRecord(req.body);
    const conflict = await services.conflict.escalate(
      req.ctx,
      req.params["id"] as Ulid,
      requiredString(body, "reason"),
    );
    return jsonResponse(200, conflictView(conflict, clock.now()));
  });

  router.post("/conflicts/:id/resolve", async (req) => {
    const body = asRecord(req.body);
    const conflict = await services.conflict.resolve(req.ctx, req.params["id"] as Ulid, {
      outcome: requiredEnum<ConflictOutcome>(body, "outcome", CONFLICT_OUTCOMES),
      rationale: requiredString(body, "rationale"),
      splitBps: optionalNumber(body, "splitBps"),
      protectionDays: optionalNumber(body, "protectionDays"),
    });
    return jsonResponse(200, conflictView(conflict, clock.now()));
  });

  router.post("/conflicts/:id/withdraw", async (req) => {
    const body = asRecord(req.body);
    const conflict = await services.conflict.withdraw(
      req.ctx,
      req.params["id"] as Ulid,
      requiredString(body, "reason"),
    );
    return jsonResponse(200, conflictView(conflict, clock.now()));
  });

  // House accounts the channel is not allowed to register against.
  router.get("/house-accounts", async (req) => jsonResponse(200, await services.conflict.listDirectClaims(req.ctx)));

  router.post("/house-accounts", async (req) => {
    const body = asRecord(req.body);
    const claim = await services.conflict.addDirectClaim(req.ctx, {
      customerKey: requiredString(body, "customerKey"),
      reason: requiredString(body, "reason"),
      productLines: optionalStringArray(body, "productLines"),
      ownerId: optionalString(body, "ownerId") as UserId | undefined,
    });
    return jsonResponse(201, claim);
  });

  router.delete("/house-accounts/:customerKey", async (req) => {
    await services.conflict.removeDirectClaim(req.ctx, req.params["customerKey"]!);
    return jsonResponse(204);
  });
}
