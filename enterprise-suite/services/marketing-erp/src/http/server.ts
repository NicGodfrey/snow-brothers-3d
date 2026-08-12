import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { DomainError } from "@enterprise-suite/shared-kernel";
import type { MarketingModule } from "../infrastructure/container.js";
import { tenantContextFromHeaders } from "./context.js";
import { registerAttributionRoutes } from "./handlers/attribution.js";
import { registerCampaignRoutes } from "./handlers/campaigns.js";
import { registerChannelRoutes } from "./handlers/channels.js";
import { registerContentRoutes } from "./handlers/content.js";
import { registerLeadRoutes } from "./handlers/leads.js";
import { registerSegmentRoutes } from "./handlers/segments.js";
import { registerSendJobRoutes } from "./handlers/send-jobs.js";
import { registerTrackedLinkRoutes } from "./handlers/tracked-links.js";
import { Router } from "./router.js";

const MAX_BODY_BYTES = 1_048_576; // 1 MiB

export function buildRouter(module: MarketingModule): Router {
  const router = new Router();
  const { services } = module;
  registerChannelRoutes(router, services.channels);
  registerCampaignRoutes(router, services.campaigns, services.budgets, services.sendJobs);
  registerSegmentRoutes(router, services.segments, services.audiences);
  registerLeadRoutes(router, services.leads, services.scoring, services.handoff);
  registerContentRoutes(router, services.content);
  registerSendJobRoutes(router, services.sendJobs);
  registerAttributionRoutes(router, services.attribution, services.budgets);
  registerTrackedLinkRoutes(router, services.trackedLinks);
  return router;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) {
      throw new DomainError("Request body exceeds 1 MiB", "PAYLOAD_TOO_LARGE", 413);
    }
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return undefined;
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (raw === "") return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    throw new DomainError("Request body is not valid JSON", "INVALID_JSON", 400);
  }
}

function writeJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers?: Readonly<Record<string, string>>,
): void {
  const payload = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    ...headers,
  });
  res.end(payload);
}

/**
 * Wraps the module in a plain node:http server. Routes are synchronous
 * request/response; domain events flow through the module's outbox.
 */
export function createMarketingServer(module: MarketingModule): Server {
  const router = buildRouter(module);

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (req.method === "GET" && url.pathname === "/health") {
        writeJson(res, 200, { status: "ok", service: "marketing-erp" });
        return;
      }
      const match = router.match(req.method ?? "GET", url.pathname);
      if (!match) {
        writeJson(res, 404, {
          error: "NOT_FOUND",
          message: `No route for ${req.method} ${url.pathname}`,
        });
        return;
      }
      const ctx = tenantContextFromHeaders(req.headers);
      const body = await readJsonBody(req);
      const result = await match.handler({ ctx, params: match.params, query: url.searchParams, body });
      writeJson(res, result.status ?? 200, result.body, result.headers);
    } catch (error) {
      if (error instanceof DomainError) {
        writeJson(res, error.status, {
          error: error.code,
          message: error.message,
          details: error.details,
        });
        return;
      }
      writeJson(res, 500, {
        error: "INTERNAL",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });
}
