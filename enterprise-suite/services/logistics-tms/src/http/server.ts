import { buildApp, createHttpServer } from "./app.js";

const port = Number(process.env.PORT ?? 3007);
const app = buildApp();
const server = createHttpServer(app);

server.listen(port, () => {
  console.log(`[logistics-tms] listening on :${port}`);
});

// Outbox draining is owned by the suite outbox-relay (POST /outbox/drain),
// which forwards envelopes to integration-hub. A local drain loop here would
// race it and consume the events before they leave the process.
