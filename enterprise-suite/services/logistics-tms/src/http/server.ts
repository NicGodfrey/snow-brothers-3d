import { buildApp, createHttpServer } from "./app.js";

const port = Number(process.env.PORT ?? 3007);
const app = buildApp();
const server = createHttpServer(app);

server.listen(port, () => {
  console.log(`[logistics-tms] listening on :${port}`);
});

// Outbox relay: in production this publishes to the suite event bus; the
// standalone server logs the envelopes so integration behavior is visible.
const relay = setInterval(() => {
  void app.outbox.drain((envelope) => {
    console.log(`[logistics-tms] event ${envelope.eventType} (${envelope.aggregateId})`);
  });
}, 1000);
relay.unref();
