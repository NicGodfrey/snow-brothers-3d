import type { IncomingMessage } from "node:http";
import type { AgiConfig } from "../config.ts";

export function authorize(
  config: Pick<AgiConfig, "controlToken">,
  req: IncomingMessage,
): boolean {
  const token = config.controlToken;
  if (!token) return true;
  return req.headers.authorization === `Bearer ${token}`;
}
