import type { IncomingMessage, ServerResponse } from "node:http";
import { type TenantContext } from "@enterprise-suite/shared-kernel";
export interface HttpRequest {
    readonly ctx: TenantContext;
    readonly params: Readonly<Record<string, string>>;
    readonly query: Readonly<Record<string, string>>;
    readonly body: unknown;
}
export interface HttpResponse {
    readonly status: number;
    readonly body: unknown;
}
export type RouteHandler = (req: HttpRequest) => Promise<HttpResponse>;
export declare class Router {
    private readonly routes;
    add(method: string, path: string, handler: RouteHandler, options?: {
        anonymous?: boolean;
    }): this;
    get(path: string, handler: RouteHandler, options?: {
        anonymous?: boolean;
    }): this;
    post(path: string, handler: RouteHandler): this;
    put(path: string, handler: RouteHandler): this;
    delete(path: string, handler: RouteHandler): this;
    dispatch(req: IncomingMessage, res: ServerResponse): Promise<void>;
    private match;
}
//# sourceMappingURL=router.d.ts.map