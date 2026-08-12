/**
 * HTTP server assembly: builds a node:http server exposing the full
 * quality-qms API on top of a QualityQmsModule.
 */
import { type Server } from "node:http";
import type { QualityQmsModule } from "../infrastructure/module.js";
import { Router } from "./router.js";
export declare function buildRouter(module: QualityQmsModule): Router;
export declare function createQualityQmsServer(module: QualityQmsModule): Server;
//# sourceMappingURL=server.d.ts.map