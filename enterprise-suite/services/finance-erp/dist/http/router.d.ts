import type { IncomingMessage, ServerResponse } from "node:http";
import { type TenantContext } from "@enterprise-suite/shared-kernel";
export interface HttpRequest {
    readonly method: string;
    readonly path: string;
    readonly params: Record<string, string>;
    readonly query: URLSearchParams;
    readonly body: unknown;
    readonly ctx: TenantContext;
}
export interface HttpResponse {
    readonly status: number;
    readonly body: unknown;
}
export type Handler = (req: HttpRequest) => Promise<HttpResponse> | HttpResponse;
export declare const jsonOk: (body: unknown) => HttpResponse;
export declare const jsonCreated: (body: unknown) => HttpResponse;
/**
 * Minimal path-segment router (no external dependencies). Patterns use
 * ":name" segments, e.g. "/journals/:id/post".
 */
export declare class Router {
    private readonly routes;
    register(method: string, pattern: string, handler: Handler): void;
    get(pattern: string, handler: Handler): void;
    post(pattern: string, handler: Handler): void;
    put(pattern: string, handler: Handler): void;
    delete(pattern: string, handler: Handler): void;
    match(method: string, path: string): {
        handler: Handler;
        params: Record<string, string>;
    } | undefined;
    dispatch(input: {
        method: string;
        url: string;
        headers: Record<string, string | string[] | undefined>;
        rawBody: string;
    }): Promise<HttpResponse>;
    /** Adapter for node:http.createServer. */
    nodeListener(): (req: IncomingMessage, res: ServerResponse) => void;
}
//# sourceMappingURL=router.d.ts.map