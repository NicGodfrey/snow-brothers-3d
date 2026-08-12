import type { IncomingMessage, ServerResponse } from "node:http";
import { type TenantContext } from "@enterprise-suite/shared-kernel";
/**
 * Minimal dependency-free HTTP router. Patterns use `:name` path params
 * (e.g. `/work-orders/:id/release`). Handlers return either a plain body
 * (200) or `{ status, body }`.
 */
export interface HttpRequest {
    readonly method: string;
    readonly path: string;
    readonly params: Readonly<Record<string, string>>;
    readonly query: URLSearchParams;
    readonly body: unknown;
    readonly ctx: TenantContext;
}
export interface HandlerResult {
    status: number;
    body: unknown;
}
export type Handler = (req: HttpRequest) => Promise<HandlerResult | unknown>;
export declare class Router {
    private readonly routes;
    get(pattern: string, handler: Handler): this;
    post(pattern: string, handler: Handler): this;
    patch(pattern: string, handler: Handler): this;
    delete(pattern: string, handler: Handler): this;
    register(method: string, pattern: string, handler: Handler): this;
    /** Find a route and extract path params; null if nothing matches. */
    match(method: string, path: string): {
        handler: Handler;
        params: Record<string, string>;
    } | null;
    /** Node http request listener with body parsing and error mapping. */
    listener(): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
}
//# sourceMappingURL=router.d.ts.map