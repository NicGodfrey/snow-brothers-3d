import type { IncomingMessage, ServerResponse } from "node:http";
import { AgiError } from "../errors.ts";
import type { LucyAskRequest } from "../lucy/types.ts";
import type { ControlPlane } from "../plane.ts";
import { readJsonBody } from "./body.ts";
import { json } from "./json.ts";

export async function handleLucy(
  plane: ControlPlane,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  const path = url.pathname;
  if (!path.startsWith("/v1/lucy")) return false;

  if (req.method === "GET" && path === "/v1/lucy/pool") {
    json(res, 200, plane.lucy.health());
    return true;
  }
  if (req.method === "GET" && path === "/v1/lucy/pending") {
    json(res, 200, { items: plane.lucy.pending() });
    return true;
  }
  if (req.method === "GET" && path === "/v1/lucy/jobs") {
    json(res, 200, { items: plane.lucy.list() });
    return true;
  }

  const stream = path.match(/^\/v1\/lucy\/stream\/([^/]+)$/);
  if (req.method === "GET" && stream) {
    plane.lucy.attach(stream[1]!, req, res);
    return true;
  }

  const jobGet = path.match(/^\/v1\/lucy\/jobs\/([^/]+)$/);
  if (req.method === "GET" && jobGet) {
    json(res, 200, plane.lucy.get(jobGet[1]!));
    return true;
  }

  const tokens = path.match(/^\/v1\/lucy\/jobs\/([^/]+)\/tokens$/);
  if (req.method === "POST" && tokens) {
    const body = (await readJsonBody(req, plane.config.maxBodyBytes)) as {
      text?: string;
    };
    json(res, 200, plane.lucy.injectTokens(tokens[1]!, body.text ?? ""));
    return true;
  }

  const complete = path.match(/^\/v1\/lucy\/jobs\/([^/]+)\/complete$/);
  if (req.method === "POST" && complete) {
    const body = (await readJsonBody(req, plane.config.maxBodyBytes)) as {
      text?: string;
    };
    json(res, 200, plane.lucy.complete(complete[1]!, body.text));
    return true;
  }

  const fail = path.match(/^\/v1\/lucy\/jobs\/([^/]+)\/fail$/);
  if (req.method === "POST" && fail) {
    const body = (await readJsonBody(req, plane.config.maxBodyBytes)) as {
      code?: string;
      message?: string;
    };
    json(
      res,
      200,
      plane.lucy.fail(
        fail[1]!,
        body.code ?? "failed",
        body.message ?? "lucy job failed",
      ),
    );
    return true;
  }

  if (
    req.method === "POST" &&
    (path === "/v1/lucy/ask" || path === "/v1/lucy/chat")
  ) {
    await handleAsk(plane, req, res, url);
    return true;
  }

  throw new AgiError("not_found", path, 404);
}

async function handleAsk(
  plane: ControlPlane,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  const body = (await readJsonBody(req, plane.config.maxBodyBytes)) as LucyAskRequest;
  const job = plane.lucy.create(body);
  const stream = wantsStream(req, url, body);
  if (!stream) {
    if (job.fulfill === "queue") {
      json(res, 202, {
        ...job,
        pending: true,
        stream: `/v1/lucy/stream/${job.id}`,
        tokens: `/v1/lucy/jobs/${job.id}/tokens`,
        complete: `/v1/lucy/jobs/${job.id}/complete`,
      });
      plane.lucy.start(job.id, body.conversationMode);
      return;
    }
    plane.lucy.start(job.id, body.conversationMode);
    json(res, 200, await plane.lucy.wait(job.id));
    return;
  }
  plane.lucy.attach(job.id, req, res);
  plane.lucy.start(job.id, body.conversationMode);
}

function wantsStream(
  req: IncomingMessage,
  url: URL,
  body: LucyAskRequest,
): boolean {
  if (body.stream === false) return false;
  if (url.searchParams.get("stream") === "0") return false;
  const accept = String(req.headers.accept ?? "");
  if (accept.includes("application/json") && !accept.includes("text/event-stream")) {
    return body.stream === true;
  }
  return true;
}
