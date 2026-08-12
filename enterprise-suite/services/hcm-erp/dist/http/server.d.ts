import { type Server } from "node:http";
import type { HcmModule } from "../module.js";
/** Node HTTP server wrapping the HCM router. Caller owns listen/close. */
export declare function createHcmServer(module: HcmModule): Server;
//# sourceMappingURL=server.d.ts.map