import type { IncomingMessage } from "node:http";
import type { AgiConfig } from "../config.ts";

export function authorize(
  config: Pick<AgiConfig, "controlToken">,
  req: IncomingMessage,
): boolean {
  const token = config.controlToken;
  if (!token) return true;
  const header = String(req.headers.authorization ?? "");
  if (header === `Bearer ${token}`) return true;
  if (!header.startsWith("Basic ")) return false;
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const colon = decoded.indexOf(":");
    const user = colon === -1 ? decoded : decoded.slice(0, colon);
    const pass = colon === -1 ? "" : decoded.slice(colon + 1);
    return user === token || pass === token;
  } catch {
    return false;
  }
}
