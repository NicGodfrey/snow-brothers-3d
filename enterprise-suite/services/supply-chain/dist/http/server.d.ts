import { type Server } from "node:http";
import { type SupplyChainModule } from "../infrastructure/module.js";
import { Router } from "./router.js";
export declare function buildRouter(module: SupplyChainModule): Router;
export declare function createSupplyChainServer(module?: SupplyChainModule): Server;
//# sourceMappingURL=server.d.ts.map