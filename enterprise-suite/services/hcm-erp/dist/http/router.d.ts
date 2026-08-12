import { type TenantContext } from "@enterprise-suite/shared-kernel";
export interface HttpRequest {
    readonly method: string;
    readonly path: string;
    readonly params: Readonly<Record<string, string>>;
    readonly query: URLSearchParams;
    readonly body: unknown;
    readonly ctx: TenantContext;
}
export interface HttpResponse {
    readonly status: number;
    readonly body: unknown;
}
export type RouteHandler = (req: HttpRequest) => HttpResponse | Promise<HttpResponse>;
export declare function jsonOk(body: unknown, status?: number): HttpResponse;
export declare function created(body: unknown): HttpResponse;
/**
 * Minimal dependency-free router: exact-segment matching with `:param`
 * captures, header-based tenant context, and DomainError → HTTP mapping.
 */
export declare class Router {
    private readonly routes;
    register(method: string, pattern: string, handler: RouteHandler): void;
    get(pattern: string, handler: RouteHandler): void;
    post(pattern: string, handler: RouteHandler): void;
    patch(pattern: string, handler: RouteHandler): void;
    delete(pattern: string, handler: RouteHandler): void;
    /**
     * Dispatches a request. `headers` must carry `x-tenant-id` (401 otherwise);
     * `x-user-id` and `x-roles` (comma-separated) are optional.
     */
    dispatch(input: {
        method: string;
        url: string;
        headers: Record<string, string | string[] | undefined>;
        body?: unknown;
    }): Promise<HttpResponse>;
    private match;
}
export declare function errorToResponse(error: unknown): HttpResponse;
//# sourceMappingURL=router.d.ts.map