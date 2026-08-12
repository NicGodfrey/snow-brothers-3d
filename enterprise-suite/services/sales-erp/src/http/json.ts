import type { IncomingMessage, ServerResponse } from "node:http";
import { DomainError } from "../kernel/index.js";

const MAX_BODY_BYTES = 1_048_576; // 1 MiB

export class PayloadTooLargeError extends DomainError {
  constructor() {
    super("Request body too large", "PAYLOAD_TOO_LARGE", 413);
    this.name = "PayloadTooLargeError";
  }
}

export class BadJsonError extends DomainError {
  constructor() {
    super("Request body is not valid JSON", "BAD_JSON", 400);
    this.name = "BadJsonError";
  }
}

export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw new PayloadTooLargeError();
    chunks.push(buf);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new BadJsonError();
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

export function sendError(res: ServerResponse, error: unknown): void {
  if (error instanceof DomainError) {
    sendJson(res, error.status, {
      error: { code: error.code, message: error.message, details: error.details ?? null },
    });
    return;
  }
  sendJson(res, 500, {
    error: {
      code: "INTERNAL",
      message: error instanceof Error ? error.message : "Internal server error",
      details: null,
    },
  });
}
