import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { DomainError } from "@enterprise-suite/shared-kernel";
import type { InventoryModule } from "../infrastructure/container.js";
import { tenantContextFromHeaders } from "./context.js";
import { Router, toErrorResponse, type HttpMethod, type HttpResponse } from "./router.js";
import { cycleCountRoutes } from "./routes/cycle-count-routes.js";
import { reservationRoutes } from "./routes/reservation-routes.js";
import { stockRoutes } from "./routes/stock-routes.js";
import { taskRoutes } from "./routes/task-routes.js";
import { warehouseRoutes } from "./routes/warehouse-routes.js";

const MAX_BODY_BYTES = 1_048_576; // 1 MiB

export function buildRouter(module: InventoryModule): Router {
  const router = new Router();

  // Outbox integration endpoints for the suite outbox-relay (integration-hub).
  router.get("/outbox/pending", () => ({
    status: 200,
    body: { items: module.outbox.events },
  }));
  router.post("/outbox/drain", () => {
    const items = module.outbox.drain();
    return { status: 200, body: { count: items.length, items } };
  });

  router.addAll(warehouseRoutes(module.warehouseService));
  router.addAll(stockRoutes(module.stockService));
  router.addAll(reservationRoutes(module.reservationService));
  router.addAll(cycleCountRoutes(module.cycleCountService));
  router.addAll(taskRoutes(module.taskService));
  return router;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) {
      throw new DomainError("Request body too large", "PAYLOAD_TOO_LARGE", 413);
    }
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return undefined;
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (raw.length === 0) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    throw new DomainError("Request body is not valid JSON", "INVALID_JSON", 400);
  }
}

function writeResponse(res: ServerResponse, response: HttpResponse): void {
  const payload = JSON.stringify(response.body ?? null);
  res.writeHead(response.status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

/**
 * Bind the router to a node:http server. Health probe is unauthenticated;
 * everything else requires the tenant headers.
 */
export function createInventoryHttpServer(module: InventoryModule): Server {
  const router = buildRouter(module);
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "GET" && url.pathname === "/health") {
        writeResponse(res, {
          status: 200,
          body: { status: "ok", service: "inventory-wms", time: new Date().toISOString() },
        });
        return;
      }
      const ctx = tenantContextFromHeaders(req.headers);
      const body = await readJsonBody(req);
      const response = await router.dispatch(
        (req.method ?? "GET") as HttpMethod,
        url.pathname,
        url.searchParams,
        body,
        ctx,
      );
      writeResponse(res, response);
    } catch (error) {
      writeResponse(res, toErrorResponse(error));
    }
  });
}

export function startServer(module: InventoryModule, port: number): Promise<Server> {
  const server = createInventoryHttpServer(module);
  return new Promise((resolve) => {
    server.listen(port, () => resolve(server));
  });
}
