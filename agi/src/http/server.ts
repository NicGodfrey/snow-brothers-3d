import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { AgiError } from "../errors.ts";
import type { ControlPlane } from "../plane.ts";
import type { AskRequest, QaMode } from "../types.ts";
import { authorize } from "./auth.ts";
import { assertBindAuth } from "./bind.ts";
import { readJsonBody } from "./body.ts";
import { json } from "./json.ts";
import { handleLucy } from "./lucy-routes.ts";

export function startServer(plane: ControlPlane): Promise<{
  close: () => Promise<void>;
  url: string;
}> {
  assertBindAuth(plane.config);
  const server = createServer((req, res) => {
    void handle(plane, req, res);
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(plane.config.port, plane.config.bind, () => {
      const addr = server.address();
      const port =
        typeof addr === "object" && addr ? addr.port : plane.config.port;
      resolve({
        url: `http://${plane.config.bind}:${port}`,
        close: () =>
          new Promise((done, fail) => {
            plane.lucy.abortAll();
            server.close((err) => (err ? fail(err) : done()));
          }),
      });
    });
  });
}

async function handle(
  plane: ControlPlane,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders(req));
      res.end();
      return;
    }
    if (!authorize(plane.config, req)) {
      json(res, 401, { error: { code: "unauthorized", message: "Bearer token required" } });
      return;
    }
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
    const path = url.pathname;
    if (req.method === "GET" && path === "/health") {
      json(res, 200, {
        ok: true,
        transport: plane.config.transport,
        hasApiKey: Boolean(plane.config.apiKey),
        sessionMode: plane.config.sessionMode,
        modelId: plane.config.modelId,
        modelParams: plane.config.modelParams,
        lucy: plane.lucy.health(),
        fleet: plane.registry.snapshot({
          transport: plane.config.transport,
          maxInFlight: plane.config.maxInFlight,
          inFlight: plane.scheduler.global.inFlight,
        }),
      });
      return;
    }
    if (await handleLucy(plane, req, res, url)) return;
    if (req.method === "GET" && path === "/v1/fleet") {
      json(
        res,
        200,
        plane.registry.snapshot({
          transport: plane.config.transport,
          maxInFlight: plane.config.maxInFlight,
          inFlight: plane.scheduler.global.inFlight,
        }),
      );
      return;
    }
    if (req.method === "GET" && path.startsWith("/v1/fleet/")) {
      json(res, 200, plane.registry.get(path.slice("/v1/fleet/".length)));
      return;
    }
    if (req.method === "GET" && path === "/v1/metrics") {
      json(res, 200, plane.scheduler.metrics());
      return;
    }
    if (req.method === "GET" && path === "/v1/jobs") {
      json(res, 200, { items: plane.scheduler.jobs.list() });
      return;
    }
    if (req.method === "GET" && path.startsWith("/v1/jobs/")) {
      json(res, 200, plane.scheduler.jobs.get(path.slice("/v1/jobs/".length)));
      return;
    }
    if (req.method === "POST" && path === "/v1/ask") {
      json(res, 200, await plane.scheduler.submit(await readAsk(req, "ask", plane)));
      return;
    }
    if (req.method === "POST" && path === "/v1/fanout") {
      json(res, 200, await plane.scheduler.submit(await readAsk(req, "fanout", plane)));
      return;
    }
    if (req.method === "POST" && path === "/v1/debate") {
      json(res, 200, await plane.scheduler.submit(await readAsk(req, "debate", plane)));
      return;
    }
    if (req.method === "POST" && path === "/v1/vote") {
      json(res, 200, await plane.scheduler.submit(await readAsk(req, "vote", plane)));
      return;
    }
    if (req.method === "POST" && path === "/v1/broadcast") {
      json(res, 200, await plane.scheduler.submit(await readAsk(req, "broadcast", plane)));
      return;
    }
    if (req.method === "POST" && path === "/v1/specialist") {
      json(res, 200, await plane.scheduler.submit(await readAsk(req, "specialist", plane)));
      return;
    }
    if (req.method === "POST" && path === "/v1/fleet/provision") {
      const body = (await readJsonBody(req, plane.config.maxBodyBytes)) as {
        limit?: number;
      };
      json(res, 200, await plane.scheduler.provision(body.limit ?? 101));
      return;
    }
    json(res, 404, { error: { code: "not_found", message: path } });
  } catch (error) {
    if (error instanceof AgiError) {
      json(res, error.status, {
        error: { code: error.code, message: error.message },
      }, error.status === 503 ? { "retry-after": "2" } : {});
      return;
    }
    json(res, 500, {
      error: {
        code: "internal",
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

async function readAsk(
  req: IncomingMessage,
  mode: QaMode,
  plane: ControlPlane,
): Promise<AskRequest> {
  const body = (await readJsonBody(req, plane.config.maxBodyBytes)) as AskRequest;
  return { ...body, mode: body.mode ?? mode };
}

function corsHeaders(req: IncomingMessage): Record<string, string> {
  return {
    "access-control-allow-origin": String(req.headers.origin ?? "*"),
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-max-age": "600",
  };
}
