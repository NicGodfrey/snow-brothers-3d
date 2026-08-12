import type { SendJobService } from "../../application/send-job-service.js";
import type { Router } from "../router.js";
import { asRecord, optionalString, requireString } from "../validation.js";

export function registerSendJobRoutes(router: Router, sendJobs: SendJobService): void {
  router.post("/send-jobs", ({ ctx, body }) => {
    const b = asRecord(body);
    return {
      status: 201,
      body: sendJobs.create(ctx, {
        campaignId: requireString(b, "campaignId"),
        channelId: requireString(b, "channelId"),
        audienceId: requireString(b, "audienceId"),
        contentAssetId: requireString(b, "contentAssetId"),
      }),
    };
  });

  router.get("/send-jobs/:id", ({ ctx, params }) => ({
    body: sendJobs.get(ctx, params.id!),
  }));

  router.post("/send-jobs/:id/queue", ({ ctx, params, body }) => {
    const b = asRecord(body ?? {});
    return { body: sendJobs.queue(ctx, params.id!, optionalString(b, "scheduledAt")) };
  });

  router.post("/send-jobs/:id/run", ({ ctx, params }) => {
    const { job, stats } = sendJobs.run(ctx, params.id!);
    return { body: { job, stats } };
  });

  router.post("/send-jobs/:id/cancel", ({ ctx, params }) => ({
    body: sendJobs.cancel(ctx, params.id!),
  }));

  router.get("/send-jobs/:id/stats", ({ ctx, params }) => ({
    body: sendJobs.stats(ctx, params.id!),
  }));
}
