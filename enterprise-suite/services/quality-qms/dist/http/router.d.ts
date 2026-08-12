/**
 * Dependency-free HTTP router over node:http.
 *
 * - path patterns with :params ("/ncrs/:id/containment/actions/:actionId")
 * - tenant context extracted from x-tenant-id / x-user-id / x-roles headers
 * - JSON bodies (1 MiB limit), JSON responses
 * - DomainError subclasses map to their HTTP status; everything else is 500
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { type TenantContext } from "@enterprise-suite/shared-kernel";
export interface RequestContext {
    readonly ctx: TenantContext;
    readonly params: Record<string, string>;
    readonly query: URLSearchParams;
    readonly body: unknown;
}
export interface HandlerResult {
    readonly status?: number;
    readonly body: unknown;
}
export type RouteHandler = (req: RequestContext) => Promise<HandlerResult> | HandlerResult;
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export declare class Router {
    private readonly routes;
    register(method: Method, pattern: string, handler: RouteHandler): void;
    get(pattern: string, handler: RouteHandler): void;
    post(pattern: string, handler: RouteHandler): void;
    put(pattern: string, handler: RouteHandler): void;
    delete(pattern: string, handler: RouteHandler): void;
    private match;
    dispatch(req: IncomingMessage, res: ServerResponse): Promise<void>;
}
export declare function sendJson(res: ServerResponse, status: number, body: unknown): void;
export {};
//# sourceMappingURL=router.d.ts.map