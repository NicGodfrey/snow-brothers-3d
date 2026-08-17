import { AgiError } from "../errors.ts";
import type { AgiConfig } from "../config.ts";

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

export function isLoopbackBind(bind: string): boolean {
  return LOOPBACK.has(bind.trim().toLowerCase());
}

export function assertBindAuth(config: Pick<AgiConfig, "bind" | "controlToken">): void {
  if (!isLoopbackBind(config.bind) && !config.controlToken) {
    throw new AgiError(
      "remote_auth_required",
      "AGI_CONTROL_TOKEN is required when AGI_BIND is not loopback (remote access).",
      500,
    );
  }
}
