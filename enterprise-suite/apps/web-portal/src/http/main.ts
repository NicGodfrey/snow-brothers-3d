import { createContainer } from "../infrastructure/container.js";
import { createPortalServer } from "./server.js";

const container = createContainer();
const server = createPortalServer(container);

server.listen(container.config.port, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[web-portal] listening on http://127.0.0.1:${container.config.port} ` +
      `(transport=${container.config.transport}, tenant=${container.config.defaultTenantId})`,
  );
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
