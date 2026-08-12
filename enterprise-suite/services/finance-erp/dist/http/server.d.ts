import { type Server } from "node:http";
import { type FinanceApp } from "./app.js";
export interface RunningServer {
    readonly server: Server;
    readonly app: FinanceApp;
    readonly port: number;
    close(): Promise<void>;
}
export declare function startServer(port?: number): Promise<RunningServer>;
//# sourceMappingURL=server.d.ts.map