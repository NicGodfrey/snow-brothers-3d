/**
 * Export endpoints.
 *
 * Requesting an export returns 202 with a job number, never the file: the
 * work is unbounded and the artifact must stay retrievable afterwards.
 * `POST /exports/run` is an explicit worker tick, so a deployment can drive
 * the queue from a scheduler, a test can drive it inline, and a small export
 * can be turned around in one request-response pair by calling it directly.
 */
import type { ExportService } from "../../application/export-service.js";
import { exportJobDto } from "../serializers.js";
import type { Router } from "../router.js";
import {
  exportStatusValues,
  parseExportRequest,
  parseReason,
  pathParam,
  queryEnum,
  queryInt,
} from "../validation.js";

export function registerExportRoutes(router: Router, exports: ExportService): void {
  router.post("/exports", async ({ ctx, body }) => ({
    status: 202,
    body: exportJobDto(await exports.requestExport(ctx, parseExportRequest(body))),
  }));

  router.get("/exports", async ({ ctx, query }) => ({
    body: {
      items: (
        await exports.listJobs(ctx, {
          status: queryEnum(query, "status", exportStatusValues),
          limit: queryInt(query, "limit"),
        })
      ).map(exportJobDto),
    },
  }));

  router.get("/exports/:jobNumber", async ({ ctx, params }) => ({
    body: exportJobDto(await exports.getJob(ctx, pathParam(params, "jobNumber"))),
  }));

  router.post("/exports/:jobNumber/cancel", async ({ ctx, params, body }) => ({
    body: exportJobDto(
      await exports.cancel(ctx, pathParam(params, "jobNumber"), parseReason(body)),
    ),
  }));

  router.post("/exports/:jobNumber/retry", async ({ ctx, params }) => ({
    body: exportJobDto(await exports.retry(ctx, pathParam(params, "jobNumber"))),
  }));

  /**
   * Serves the artifact verbatim with a download filename. Expired or
   * unfinished jobs are a 409 from the service, not an empty 200.
   */
  router.get("/exports/:jobNumber/download", async ({ ctx, params }) => {
    const jobNumber = pathParam(params, "jobNumber");
    const artifact = await exports.getArtifact(ctx, jobNumber);
    const extension = artifact.contentType.startsWith("text/csv") ? "csv" : "ndjson";
    return {
      raw: artifact.content,
      contentType: artifact.contentType,
      headers: {
        "content-disposition": `attachment; filename="${jobNumber}.${extension}"`,
        "x-checksum-sha256": artifact.checksum,
      },
    };
  });

  /** Worker tick: runs up to `max` queued jobs (default 25). */
  router.post("/exports/run", async ({ ctx, query }) => {
    const completed = await exports.drain(ctx, queryInt(query, "max") ?? 25);
    return { body: { ran: completed.length, items: completed.map(exportJobDto) } };
  });
}
