import { DomainError } from "@enterprise-suite/shared-kernel";
import type { AudienceService } from "../../application/audience-service.js";
import type { SegmentService } from "../../application/segment-service.js";
import type { SegmentRule } from "../../domain/segment.js";
import type { Router } from "../router.js";
import {
  asRecord,
  optionalString,
  optionalStringArray,
  pageFromQuery,
  requireString,
} from "../validation.js";

function ruleFromBody(b: Record<string, unknown>, field: string): SegmentRule {
  const raw = b[field];
  if (typeof raw !== "object" || raw === null) {
    throw new DomainError(`Field '${field}' must be a segment rule object`, "INVALID_FIELD", 400, {
      field,
    });
  }
  // Structure is validated in depth by the domain (validateSegmentRule).
  return raw as SegmentRule;
}

export function registerSegmentRoutes(
  router: Router,
  segments: SegmentService,
  audiences: AudienceService,
): void {
  router.post("/segments", ({ ctx, body }) => {
    const b = asRecord(body);
    const type = requireString(b, "type");
    if (type === "dynamic") {
      return {
        status: 201,
        body: segments.createDynamic(ctx, {
          name: requireString(b, "name"),
          rule: ruleFromBody(b, "rule"),
          description: optionalString(b, "description"),
        }),
      };
    }
    if (type === "static") {
      return {
        status: 201,
        body: segments.createStatic(ctx, {
          name: requireString(b, "name"),
          memberIds: optionalStringArray(b, "memberIds"),
          description: optionalString(b, "description"),
        }),
      };
    }
    throw new DomainError(`Segment type must be dynamic or static, got: ${type}`, "INVALID_FIELD");
  });

  router.get("/segments", ({ ctx, query }) => ({
    body: segments.list(ctx, pageFromQuery(query)),
  }));

  router.get("/segments/:id", ({ ctx, params }) => ({
    body: segments.get(ctx, params.id!),
  }));

  router.put("/segments/:id/rule", ({ ctx, params, body }) => {
    const b = asRecord(body);
    return { body: segments.updateRule(ctx, params.id!, ruleFromBody(b, "rule")) };
  });

  router.post("/segments/:id/members", ({ ctx, params, body }) => {
    const b = asRecord(body);
    return { body: segments.addStaticMember(ctx, params.id!, requireString(b, "leadId")) };
  });

  router.delete("/segments/:id/members/:leadId", ({ ctx, params }) => ({
    body: segments.removeStaticMember(ctx, params.id!, params.leadId!),
  }));

  router.post("/segments/:id/archive", ({ ctx, params }) => ({
    body: segments.archive(ctx, params.id!),
  }));

  router.get("/segments/:id/preview", ({ ctx, params, query }) => ({
    body: segments.preview(ctx, params.id!, Number(query.get("sampleSize") ?? 10)),
  }));

  router.post("/audiences", ({ ctx, body }) => {
    const b = asRecord(body);
    return {
      status: 201,
      body: audiences.build(ctx, {
        segmentId: requireString(b, "segmentId"),
        channelKind: requireString(b, "channelKind"),
        campaignId: optionalString(b, "campaignId"),
      }),
    };
  });

  router.get("/audiences", ({ ctx }) => ({ body: audiences.list(ctx) }));

  router.get("/audiences/:id", ({ ctx, params }) => ({
    body: audiences.get(ctx, params.id!),
  }));
}
