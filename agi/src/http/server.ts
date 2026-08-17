import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { AgiError } from "../errors.ts";
import type { ControlPlane } from "../plane.ts";
import type { AskRequest, QaMode } from "../types.ts";

export function startServer(plane: ControlPlane): Promise<{
  close: () => Promise<void>;
  url: string;
}> {
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
    if (!authorize(plane, req)) {
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
        fleet: plane.registry.snapshot({
          transport: plane.config.transport,
          maxInFlight: plane.config.maxInFlight,
          inFlight: plane.scheduler.global.inFlight,
        }),
      });
      return;
    }
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
      json(res, 200, await plane.scheduler.submit(await readAsk(req, "ask")));
      return;
    }
    if (req.method === "POST" && path === "/v1/fanout") {
      json(res, 200, await plane.scheduler.submit(await readAsk(req, "fanout")));
      return;
    }
    if (req.method === "POST" && path === "/v1/debate") {
      json(res, 200, await plane.scheduler.submit(await readAsk(req, "debate")));
      return;
    }
    if (req.method === "POST" && path === "/v1/vote") {
      json(res, 200, await plane.scheduler.submit(await readAsk(req, "vote")));
      return;
    }
    if (req.method === "POST" && path === "/v1/broadcast") {
      json(res, 200, await plane.scheduler.submit(await readAsk(req, "broadcast")));
      return;
    }
    if (req.method === "POST" && path === "/v1/specialist") {
      json(res, 200, await plane.scheduler.submit(await readAsk(req, "specialist")));
      return;
    }
    if (req.method === "POST" && path === "/v1/fleet/provision") {
      const body = (await readJson(req)) as { limit?: number };
      json(res, 200, await plane.scheduler.provision(body.limit ?? 101));
      return;
    }
    json(res, 404, { error: { code: "not_found", message: path } });
  } catch (error) {
    if (error instanceof AgiError) {
      json(res, error.status, {
        error: { code: error.code, message: error.message },
      });
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

function authorize(plane: ControlPlane, req: IncomingMessage): boolean {
  const token = plane.config.controlToken;
  if (!token) return true;
  return req.headers.authorization === `Bearer ${token}`;
}

async function readAsk(req: IncomingMessage, mode: QaMode): Promise<AskRequest> {
  const body = (await readJson(req)) as AskRequest;
  return { ...body, mode: body.mode ?? mode };
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}
