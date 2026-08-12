import type { ContentService } from "../../application/content-service.js";
import type { Router } from "../router.js";
import {
  asRecord,
  optionalString,
  optionalStringArray,
  optionalStringRecord,
  pageFromQuery,
  requireString,
} from "../validation.js";

export function registerContentRoutes(router: Router, content: ContentService): void {
  router.post("/content-assets", ({ ctx, body }) => {
    const b = asRecord(body);
    return {
      status: 201,
      body: content.create(ctx, {
        title: requireString(b, "title"),
        slug: requireString(b, "slug"),
        kind: requireString(b, "kind"),
        body: requireString(b, "body"),
        subject: optionalString(b, "subject"),
        locale: optionalString(b, "locale"),
        tags: optionalStringArray(b, "tags"),
      }),
    };
  });

  router.get("/content-assets", ({ ctx, query }) => ({
    body: content.list(
      ctx,
      {
        kind: query.get("kind") ?? undefined,
        status: query.get("status") ?? undefined,
      },
      pageFromQuery(query),
    ),
  }));

  router.get("/content-assets/:id", ({ ctx, params }) => ({
    body: content.get(ctx, params.id!),
  }));

  router.post("/content-assets/:id/submit", ({ ctx, params }) => ({
    body: content.submitForReview(ctx, params.id!),
  }));

  router.post("/content-assets/:id/approve", ({ ctx, params }) => ({
    body: content.approve(ctx, params.id!),
  }));

  router.post("/content-assets/:id/reject", ({ ctx, params, body }) => {
    const b = asRecord(body);
    return { body: content.reject(ctx, params.id!, requireString(b, "reason")) };
  });

  router.post("/content-assets/:id/retire", ({ ctx, params }) => ({
    body: content.retire(ctx, params.id!),
  }));

  router.post("/content-assets/:id/revise", ({ ctx, params, body }) => {
    const b = asRecord(body);
    return {
      body: content.revise(ctx, params.id!, {
        body: requireString(b, "body"),
        subject: optionalString(b, "subject"),
        changeNote: optionalString(b, "changeNote"),
      }),
    };
  });

  router.post("/content-assets/:id/preview", ({ ctx, params, body }) => {
    const b = asRecord(body);
    return { body: content.preview(ctx, params.id!, optionalStringRecord(b, "vars") ?? {}) };
  });
}
