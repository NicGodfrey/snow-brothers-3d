import { createServer, type Server } from "node:http";
import { createContainer, type MesContainer } from "../infrastructure/container.js";
import { registerCapacityRoutes } from "./routes/capacity.js";
import { registerMaterialRoutes } from "./routes/materials.js";
import { registerRoutingRoutes } from "./routes/routings.js";
import { registerScrapRoutes } from "./routes/scrap.js";
import { registerWorkCenterRoutes } from "./routes/work-centers.js";
import { registerWorkOrderRoutes } from "./routes/work-orders.js";
import { Router } from "./router.js";

export function buildRouter(container: MesContainer): Router {
  const router = new Router();

  router.get("/health", async () => ({
    service: "manufacturing-mes",
    status: "ok",
    eventsBuffered: container.outbox.all().length,
  }));

  registerWorkCenterRoutes(router, container);
  registerCapacityRoutes(router, container);
  registerRoutingRoutes(router, container);
  registerWorkOrderRoutes(router, container);
  registerMaterialRoutes(router, container);
  registerScrapRoutes(router, container);
  return router;
}

export function createMesServer(container: MesContainer = createContainer()): {
  server: Server;
  container: MesContainer;
} {
  const router = buildRouter(container);
  const server = createServer((req, res) => {
    void router.listener()(req, res);
  });
  return { server, container };
}

/** Entry point: `npm start` (or `node --import tsx src/http/server.ts`). */
const isMain = process.argv[1]?.endsWith("server.ts") || process.argv[1]?.endsWith("server.js");
if (isMain) {
  const port = Number(process.env.PORT ?? 3007);
  const { server } = createMesServer();
  server.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`[manufacturing-mes] listening on :${port}`);
  });
}
