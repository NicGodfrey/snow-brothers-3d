import type { IncomingMessage, ServerResponse } from "node:http";
import { CAPABILITIES } from "../capabilities.ts";
import { normalizeImages } from "../cursor/images.ts";
import { formatSse } from "../sse.ts";
import type { ControlPlane } from "../plane.ts";
import { readJsonBody } from "./body.ts";
import { json } from "./json.ts";

export async function handleOfficial(
  plane: ControlPlane,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  const path = url.pathname;
  const t = plane.transport;
  const q = Object.fromEntries(url.searchParams.entries());

  if (req.method === "GET" && path === "/v1/capabilities") {
    json(res, 200, CAPABILITIES);
    return true;
  }
  if (req.method === "GET" && path === "/v1/me") {
    json(res, 200, await t.me());
    return true;
  }
  if (req.method === "GET" && path === "/v1/models") {
    json(res, 200, await t.listModels());
    return true;
  }
  if (req.method === "GET" && path === "/v1/repositories") {
    json(res, 200, await t.listRepositories());
    return true;
  }
  if (req.method === "POST" && path === "/v1/sub-tokens") {
    json(
      res,
      200,
      await t.createSubToken(
        asRecord(await readJsonBody(req, plane.config.maxBodyBytes)),
      ),
    );
    return true;
  }

  if (req.method === "GET" && path === "/v0/private-workers") {
    json(res, 200, await t.listWorkers(q));
    return true;
  }
  if (req.method === "GET" && path === "/v0/private-workers/summary") {
    json(res, 200, await t.workerSummary());
    return true;
  }
  if (req.method === "GET" && path === "/v0/private-workers/pools") {
    json(res, 200, await t.listPools(q));
    return true;
  }
  if (
    req.method === "GET" &&
    (path === "/v0/private-workers/pending-requests" ||
      path === "/v0/private-workers/pools/requests")
  ) {
    json(res, 200, await t.listPoolRequests(q));
    return true;
  }
  if (
    req.method === "POST" &&
    (path === "/v0/private-workers/claim" ||
      path === "/v0/private-workers/pools/requests/claim")
  ) {
    json(
      res,
      200,
      await t.claimPoolRequest(
        asRecord(await readJsonBody(req, plane.config.maxBodyBytes)),
      ),
    );
    return true;
  }
  if (req.method === "DELETE" && path === "/v0/private-workers/pools") {
    json(
      res,
      200,
      await t.deregisterPool(
        asRecord(await readJsonBody(req, plane.config.maxBodyBytes)),
      ),
    );
    return true;
  }
  const poolDel = path.match(/^\/v0\/private-workers\/pools\/([^/]+)$/);
  if (req.method === "DELETE" && poolDel) {
    json(
      res,
      200,
      await t.deregisterPool({ poolName: poolDel[1], scope: "team" }),
    );
    return true;
  }
  const worker = path.match(/^\/v0\/private-workers\/([^/]+)$/);
  if (req.method === "GET" && worker) {
    json(res, 200, await t.getWorker(worker[1]!));
    return true;
  }

  if (req.method === "GET" && path === "/v1/agents") {
    json(res, 200, await t.listAgents(q));
    return true;
  }
  if (req.method === "POST" && path === "/v1/agents") {
    json(
      res,
      200,
      await t.createAgentRaw(
        asRecord(await readJsonBody(req, plane.config.maxBodyBytes)),
      ),
    );
    return true;
  }

  const download = path.match(/^\/v1\/agents\/([^/]+)\/artifacts\/download$/);
  if (req.method === "GET" && download) {
    json(res, 200, await t.downloadArtifact(download[1]!, q.path ?? ""));
    return true;
  }
  const artifacts = path.match(/^\/v1\/agents\/([^/]+)\/artifacts$/);
  if (req.method === "GET" && artifacts) {
    json(res, 200, await t.listArtifacts(artifacts[1]!));
    return true;
  }
  const usage = path.match(/^\/v1\/agents\/([^/]+)\/usage$/);
  if (req.method === "GET" && usage) {
    json(res, 200, await t.getUsage(usage[1]!, q.runId));
    return true;
  }
  const conversation = path.match(/^\/v1\/agents\/([^/]+)\/conversation$/);
  if (req.method === "GET" && conversation) {
    json(res, 200, await agentConversation(t, conversation[1]!, q));
    return true;
  }
  const wait = path.match(/^\/v1\/agents\/([^/]+)\/runs\/([^/]+)\/wait$/);
  if (req.method === "GET" && wait) {
    json(res, 200, await t.waitForRun(wait[1]!, wait[2]!));
    return true;
  }
  const stream = path.match(/^\/v1\/agents\/([^/]+)\/runs\/([^/]+)\/stream$/);
  if (req.method === "GET" && stream) {
    await proxyStream(plane, req, res, stream[1]!, stream[2]!);
    return true;
  }
  const cancel = path.match(/^\/v1\/agents\/([^/]+)\/runs\/([^/]+)\/cancel$/);
  if (req.method === "POST" && cancel) {
    json(res, 200, await t.cancelRun(cancel[1]!, cancel[2]!));
    return true;
  }
  const oneRun = path.match(/^\/v1\/agents\/([^/]+)\/runs\/([^/]+)$/);
  if (req.method === "GET" && oneRun) {
    json(res, 200, await t.getRun(oneRun[1]!, oneRun[2]!));
    return true;
  }
  const runs = path.match(/^\/v1\/agents\/([^/]+)\/runs$/);
  if (req.method === "GET" && runs) {
    json(res, 200, await t.listRuns(runs[1]!, q));
    return true;
  }
  if (req.method === "POST" && runs) {
    const body = asRecord(await readJsonBody(req, plane.config.maxBodyBytes));
    const prompt =
      (body.prompt as { text?: string; images?: unknown } | undefined) ?? {};
    const run = await t.createRun(runs[1]!, {
      prompt: String(prompt.text ?? ""),
      images: normalizeImages(prompt.images),
      mode: body.mode === "plan" ? "plan" : body.mode === "agent" ? "agent" : undefined,
      mcpServers: Array.isArray(body.mcpServers) ? body.mcpServers : undefined,
    });
    json(res, 200, { run });
    return true;
  }
  const archive = path.match(/^\/v1\/agents\/([^/]+)\/archive$/);
  if (req.method === "POST" && archive) {
    await t.archiveAgent(archive[1]!);
    json(res, 200, { id: archive[1] });
    return true;
  }
  const unarchive = path.match(/^\/v1\/agents\/([^/]+)\/unarchive$/);
  if (req.method === "POST" && unarchive) {
    await t.unarchiveAgent(unarchive[1]!);
    json(res, 200, { id: unarchive[1] });
    return true;
  }
  const agent = path.match(/^\/v1\/agents\/([^/]+)$/);
  if (req.method === "GET" && agent) {
    json(res, 200, await t.getAgent(agent[1]!));
    return true;
  }
  if (req.method === "DELETE" && agent) {
    json(res, 200, await t.deleteAgent(agent[1]!));
    return true;
  }
  return false;
}

async function agentConversation(
  t: ControlPlane["transport"],
  id: string,
  query: Record<string, string>,
): Promise<unknown> {
  const listed = (await t.listRuns(id, query)) as {
    items?: Array<{
      id?: string;
      status?: string;
      result?: string;
      createdAt?: string;
      updatedAt?: string;
    }>;
  };
  return {
    id,
    items: (listed.items ?? []).map((run) => ({
      runId: run.id,
      status: run.status,
      text: run.result ?? "",
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    })),
  };
}

async function proxyStream(
  plane: ControlPlane,
  req: IncomingMessage,
  res: ServerResponse,
  agentId: string,
  runId: string,
): Promise<void> {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "X-Cursor-Stream-Retention-Seconds": "86400",
  });
  const lastEventId = String(req.headers["last-event-id"] ?? "") || undefined;
  const abort = new AbortController();
  req.socket?.on("close", () => abort.abort());
  try {
    for await (const frame of plane.transport.streamRun(agentId, runId, {
      signal: abort.signal,
      lastEventId,
    })) {
      const data =
        typeof frame.data === "string" ? frame.data : (frame.data as object);
      res.write(formatSse(frame.event, data, frame.id));
      if (frame.event === "done") break;
    }
  } catch (error) {
    if (!res.writableEnded) {
      const message = error instanceof Error ? error.message : String(error);
      res.write(formatSse("error", { code: "stream_failed", message }));
      res.write(formatSse("done", {}));
    }
  }
  if (!res.writableEnded) res.end();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}
