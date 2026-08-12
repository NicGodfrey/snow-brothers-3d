import { DomainError } from "@enterprise-suite/shared-kernel";
import type { Logger } from "../../application/ports.js";
import type { Middleware } from "../router.js";

/**
 * Maps thrown errors to the shared error envelope
 * `{ code, message, details, requestId }`. Domain errors keep their declared
 * status; anything else becomes a 500 whose message is deliberately generic
 * while the full error goes to the log.
 */
export function errorHandler(options: { logger?: Logger; service?: string } = {}): Middleware {
  const service = options.service ?? "api-gateway";
  return async (req, next) => {
    try {
      return await next();
    } catch (error) {
      const requestId = String(req.ctx.requestId);
      if (error instanceof DomainError) {
        if (error.status >= 500) {
          options.logger?.log("error", error.message, {
            requestId,
            code: error.code,
            path: req.path,
          });
        }
        return {
          status: error.status,
          body: { code: error.code, message: error.message, details: error.details, requestId },
        };
      }
      if (error instanceof SyntaxError) {
        return {
          status: 400,
          body: { code: "BAD_JSON", message: "Request body is not valid JSON", requestId },
        };
      }
      options.logger?.log("error", "unhandled error", {
        requestId,
        service,
        path: req.path,
        method: req.method,
        error: error instanceof Error ? error.stack ?? error.message : String(error),
      });
      return {
        status: 500,
        body: { code: "INTERNAL", message: "Internal server error", requestId },
      };
    }
  };
}
