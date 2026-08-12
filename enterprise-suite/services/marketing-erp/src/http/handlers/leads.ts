import type { HandoffAcknowledgementDto } from "../../application/dto.js";
import type { HandoffService } from "../../application/handoff-service.js";
import type { LeadService } from "../../application/lead-service.js";
import type { LeadScoringService } from "../../application/lead-scoring-service.js";
import type { DemographicRule } from "../../domain/lead-scoring.js";
import type { Router } from "../router.js";
import {
  asRecord,
  optionalBoolean,
  optionalNumber,
  optionalString,
  optionalStringArray,
  optionalStringRecord,
  pageFromQuery,
  requireBoolean,
  requireNumber,
  requireString,
  utmFromBody,
} from "../validation.js";

export function registerLeadRoutes(
  router: Router,
  leads: LeadService,
  scoring: LeadScoringService,
  handoff: HandoffService,
): void {
  router.post("/leads", ({ ctx, body }) => {
    const b = asRecord(body);
    const lead = leads.capture(ctx, {
      email: requireString(b, "email"),
      source: requireString(b, "source"),
      firstName: optionalString(b, "firstName"),
      lastName: optionalString(b, "lastName"),
      phone: optionalString(b, "phone"),
      company: optionalString(b, "company"),
      jobTitle: optionalString(b, "jobTitle"),
      industry: optionalString(b, "industry"),
      companySize: optionalNumber(b, "companySize"),
      country: optionalString(b, "country"),
      tags: optionalStringArray(b, "tags"),
      consentEmail: optionalBoolean(b, "consentEmail"),
      consentSms: optionalBoolean(b, "consentSms"),
      utm: utmFromBody(b, "utm", false),
      landingUrl: optionalString(b, "landingUrl"),
    });
    return { status: 201, body: lead };
  });

  router.get("/leads", ({ ctx, query }) => ({
    body: leads.list(
      ctx,
      {
        stage: query.get("stage") ?? undefined,
        minScore: query.get("minScore") ? Number(query.get("minScore")) : undefined,
        tag: query.get("tag") ?? undefined,
      },
      pageFromQuery(query),
    ),
  }));

  router.get("/leads/:id", ({ ctx, params }) => ({ body: leads.get(ctx, params.id!) }));

  router.patch("/leads/:id", ({ ctx, params, body }) => {
    const b = asRecord(body);
    return {
      body: leads.enrich(ctx, params.id!, {
        firstName: optionalString(b, "firstName"),
        lastName: optionalString(b, "lastName"),
        phone: optionalString(b, "phone"),
        company: optionalString(b, "company"),
        jobTitle: optionalString(b, "jobTitle"),
        industry: optionalString(b, "industry"),
        companySize: optionalNumber(b, "companySize"),
        country: optionalString(b, "country"),
        ownerUserId: optionalString(b, "ownerUserId"),
      }),
    };
  });

  router.post("/leads/:id/activities", ({ ctx, params, body }) => {
    const b = asRecord(body);
    return {
      status: 201,
      body: leads.recordActivity(ctx, params.id!, {
        type: requireString(b, "type"),
        occurredAt: optionalString(b, "occurredAt"),
        campaignId: optionalString(b, "campaignId"),
        channelId: optionalString(b, "channelId"),
        utm: utmFromBody(b, "utm", false),
        metadata: optionalStringRecord(b, "metadata"),
      }),
    };
  });

  router.get("/leads/:id/timeline", ({ ctx, params }) => ({
    body: leads.timeline(ctx, params.id!),
  }));

  router.post("/leads/:id/tags", ({ ctx, params, body }) => {
    const b = asRecord(body);
    return { body: leads.addTag(ctx, params.id!, requireString(b, "tag")) };
  });

  router.delete("/leads/:id/tags/:tag", ({ ctx, params }) => ({
    body: leads.removeTag(ctx, params.id!, params.tag!),
  }));

  router.post("/leads/:id/consent", ({ ctx, params, body }) => {
    const b = asRecord(body);
    const channel = requireString(b, "channel");
    if (channel !== "email" && channel !== "sms") {
      return { status: 400, body: { error: "channel must be email or sms" } };
    }
    return { body: leads.setConsent(ctx, params.id!, channel, requireBoolean(b, "granted")) };
  });

  router.post("/leads/:id/unsubscribe", ({ ctx, params }) => ({
    body: leads.unsubscribe(ctx, params.id!),
  }));

  router.post("/leads/:id/mql", ({ ctx, params, body }) => {
    const b = asRecord(body ?? {});
    return { body: leads.markMql(ctx, params.id!, optionalString(b, "reason")) };
  });

  router.post("/leads/:id/sql", ({ ctx, params, body }) => {
    const b = asRecord(body ?? {});
    return { body: leads.markSql(ctx, params.id!, optionalString(b, "reason")) };
  });

  router.post("/leads/:id/disqualify", ({ ctx, params, body }) => {
    const b = asRecord(body);
    return { body: leads.disqualify(ctx, params.id!, requireString(b, "reason")) };
  });

  router.post("/leads/:id/requalify", ({ ctx, params }) => ({
    body: leads.requalify(ctx, params.id!),
  }));

  // --- Scoring ---------------------------------------------------------------

  router.get("/scoring/model", ({ ctx }) => ({ body: scoring.getModel(ctx) }));

  router.put("/scoring/model", ({ ctx, body }) => {
    const b = asRecord(body);
    return {
      body: scoring.updateModel(ctx, {
        activityWeights: b.activityWeights as { activity: string; points: number }[] | undefined,
        demographicRules: b.demographicRules as DemographicRule[] | undefined,
        mqlThreshold: optionalNumber(b, "mqlThreshold"),
        sqlThreshold: optionalNumber(b, "sqlThreshold"),
      }),
    };
  });

  router.post("/scoring/rescore-all", ({ ctx }) => ({ body: scoring.rescoreAll(ctx) }));

  router.post("/leads/:id/rescore", ({ ctx, params }) => ({
    body: scoring.rescoreLead(ctx, params.id!),
  }));

  router.get("/leads/:id/score", ({ ctx, params }) => ({
    body: scoring.explainScore(ctx, params.id!),
  }));

  // --- Handoff to Sales -------------------------------------------------------

  router.post("/leads/:id/handoff", ({ ctx, params, body }) => {
    const b = asRecord(body);
    return {
      status: 201,
      body: handoff.handOff(ctx, params.id!, {
        estimatedValueMinor: requireNumber(b, "estimatedValueMinor"),
        currency: requireString(b, "currency"),
        attributionModel: optionalString(b, "attributionModel"),
        notes: optionalString(b, "notes"),
        suggestedOwnerUserId: optionalString(b, "suggestedOwnerUserId"),
      }),
    };
  });

  router.post("/handoffs/acknowledge", ({ ctx, body }) => ({
    body: handoff.acknowledge(ctx, asRecord(body) as unknown as HandoffAcknowledgementDto),
  }));

  router.post("/leads/:id/deal-won", ({ ctx, params, body }) => {
    const b = asRecord(body);
    return {
      body: handoff.recordDealWon(
        ctx,
        params.id!,
        requireNumber(b, "actualValueMinor"),
        requireString(b, "currency"),
      ),
    };
  });

  router.get("/funnel", ({ ctx }) => ({ body: leads.funnel(ctx) }));
}
