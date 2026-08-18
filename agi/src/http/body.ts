import type { IncomingMessage } from "node:http";
import { AgiError } from "../errors.ts";

export async function readJsonBody(
  req: IncomingMessage,
  maxBytes: number,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > maxBytes) {
      throw new AgiError(
        "payload_too_large",
        `Request body exceeds ${maxBytes} bytes`,
        413,
      );
    }
    chunks.push(buf);
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new AgiError("invalid_json", "Request body is not valid JSON", 400);
  }
}
