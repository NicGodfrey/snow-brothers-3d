import { type Server } from "node:http";
import { type MesContainer } from "../infrastructure/container.js";
import { Router } from "./router.js";
export declare function buildRouter(container: MesContainer): Router;
export declare function createMesServer(container?: MesContainer): {
    server: Server;
    container: MesContainer;
};
//# sourceMappingURL=server.d.ts.map