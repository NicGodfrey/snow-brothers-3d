import type { Middleware } from "../router.js";

/**
 * Minimal CORS for browser callers (the admin console UI, docs viewers).
 * Credentials are never enabled: browser API clients use bearer tokens, so
 * wildcard origins do not imply cross-origin cookie access.
 */
export function cors(options: {
  origins?: readonly string[];
  methods?: readonly string[];
  headers?: readonly string[];
  maxAgeSeconds?: number;
} = {}): Middleware {
  const origins = options.origins ?? ["*"];
  const methods = (options.methods ?? ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]).join(", ");
  const allowedHeaders = (
    options.headers ?? [
      "authorization",
      "content-type",
      "x-tenant-id",
      "x-user-id",
      "x-roles",
      "x-request-id",
    ]
  ).join(", ");
  const maxAge = String(options.maxAgeSeconds ?? 600);

  return async (req, next) => {
    const requestOrigin = req.headers["origin"];
    const allowOrigin = origins.includes("*")
      ? "*"
      : requestOrigin && origins.includes(requestOrigin)
        ? requestOrigin
        : undefined;

    const corsHeaders: Record<string, string> = allowOrigin
      ? {
          "access-control-allow-origin": allowOrigin,
          "access-control-allow-methods": methods,
          "access-control-allow-headers": allowedHeaders,
          "access-control-expose-headers": "x-request-id, x-ratelimit-remaining, x-ratelimit-reset",
          "access-control-max-age": maxAge,
          vary: "origin",
        }
      : {};

    if (req.method === "OPTIONS" && req.headers["access-control-request-method"]) {
      return { status: 204, headers: corsHeaders };
    }

    const response = await next();
    return { ...response, headers: { ...(response.headers ?? {}), ...corsHeaders } };
  };
}
