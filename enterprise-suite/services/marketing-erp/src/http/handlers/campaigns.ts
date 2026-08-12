import type { BudgetService } from "../../application/budget-service.js";
import type { CampaignService } from "../../application/campaign-service.js";
import type { SendJobService } from "../../application/send-job-service.js";
import type { Router } from "../router.js";
import {
  asRecord,
  optionalObject,
  optionalString,
  pageFromQuery,
  requireString,
} from "../validation.js";

export function registerCampaignRoutes(
  router: Router,
  campaigns: CampaignService,
  budgets: BudgetService,
  sendJobs: SendJobService,
): void {
  router.post("/campaigns", ({ ctx, body }) => {
    const b = asRecord(body);
    const utmRaw = optionalObject(b, "utmDefaults");
    const campaign = campaigns.create(ctx, {
      name: requireString(b, "name"),
      code: requireString(b, "code"),
      objective: requireString(b, "objective"),
      startsAt: optionalString(b, "startsAt"),
      endsAt: optionalString(b, "endsAt"),
      description: optionalString(b, "description"),
      ownerUserId: optionalString(b, "ownerUserId"),
      utmDefaults: utmRaw
        ? {
            source: requireString(utmRaw, "source"),
            medium: requireString(utmRaw, "medium"),
            term: optionalString(utmRaw, "term"),
            content: optionalString(utmRaw, "content"),
          }
        : undefined,
    });
    return { status: 201, body: campaign };
  });

  router.get("/campaigns", ({ ctx, query }) => ({
    body: campaigns.list(
      ctx,
      { status: query.get("status") ?? undefined },
      pageFromQuery(query),
    ),
  }));

  router.get("/campaigns/:id", ({ ctx, params }) => ({
    body: campaigns.get(ctx, params.id!),
  }));

  router.post("/campaigns/:id/schedule", ({ ctx, params, body }) => {
    const b = asRecord(body);
    return {
      body: campaigns.schedule(ctx, params.id!, requireString(b, "startsAt"), optionalString(b, "endsAt")),
    };
  });

  router.post("/campaigns/:id/activate", ({ ctx, params }) => ({
    body: campaigns.activate(ctx, params.id!),
  }));

  router.post("/campaigns/:id/pause", ({ ctx, params }) => ({
    body: campaigns.pause(ctx, params.id!),
  }));

  router.post("/campaigns/:id/complete", ({ ctx, params }) => ({
    body: campaigns.complete(ctx, params.id!),
  }));

  router.post("/campaigns/:id/archive", ({ ctx, params }) => ({
    body: campaigns.archive(ctx, params.id!),
  }));

  router.post("/campaigns/:id/channels", ({ ctx, params, body }) => {
    const b = asRecord(body);
    return { body: campaigns.attachChannel(ctx, params.id!, requireString(b, "channelId")) };
  });

  router.delete("/campaigns/:id/channels/:channelId", ({ ctx, params }) => ({
    body: campaigns.detachChannel(ctx, params.id!, params.channelId!),
  }));

  router.put("/campaigns/:id/utm-defaults", ({ ctx, params, body }) => {
    const b = asRecord(body);
    return {
      body: campaigns.setUtmDefaults(ctx, params.id!, {
        source: requireString(b, "source"),
        medium: requireString(b, "medium"),
        term: optionalString(b, "term"),
        content: optionalString(b, "content"),
      }),
    };
  });

  router.get("/campaigns/:id/roi", ({ ctx, params, query }) => ({
    body: budgets.campaignRoi(ctx, params.id!, query.get("model") ?? "linear"),
  }));

  router.get("/campaigns/:id/budget", ({ ctx, params }) => {
    const budget = budgets.forCampaign(ctx, params.id!);
    return budget ? { body: budget } : { status: 404, body: { error: "No budget for campaign" } };
  });

  router.get("/campaigns/:id/send-jobs", ({ ctx, params }) => ({
    body: sendJobs.listByCampaign(ctx, params.id!),
  }));
}
