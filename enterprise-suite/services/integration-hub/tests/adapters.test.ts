import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConflictError, DomainError, NotFoundError } from "@enterprise-suite/shared-kernel";
import { ADAPTER_DEGRADE_THRESHOLD, validateAdapterConfig } from "../src/domain/adapter.js";
import { IntegrationEventTypes } from "../src/domain/events.js";
import { harness, otherTenantCtx, type TestHarness } from "./helpers.js";

const httpConfig = {
  endpoint: "https://3pl.example.com/api/v2/shipments",
  authScheme: "bearer",
  credentialsRef: "secret://integrations/3pl/token",
};

const sftpConfig = {
  host: "edi.partner.example.com",
  username: "acme",
  credentialsRef: "secret://integrations/edi/key",
  outboundDir: "/outbound",
  inboundDir: "/inbound",
};

const kafkaConfig = { brokers: "broker-1:9092", topic: "erp.events" };

async function registerHttp(h: TestHarness, name = "3pl-api") {
  return h.hub.services.adapters.register(h.ctx, { name, kind: "http", config: httpConfig });
}

describe("adapter config schema", () => {
  it("applies defaults and rejects unknown keys", () => {
    const schema = [
      { name: "host", type: "string", required: true },
      { name: "port", type: "number", required: false, default: 22, min: 1, max: 65_535 },
    ] as const;

    assert.deepEqual(validateAdapterConfig(schema, { host: "sftp.example.com" }), {
      host: "sftp.example.com",
      port: 22,
    });
    assert.throws(
      () => validateAdapterConfig(schema, { host: "h", porrt: 22 }),
      /unknown config key 'porrt'/,
    );
    assert.throws(() => validateAdapterConfig(schema, {}), /config 'host' is required/);
    assert.throws(() => validateAdapterConfig(schema, { host: "h", port: 0 }), /must be >= 1/);
    assert.throws(() => validateAdapterConfig(schema, { host: "h", port: 70_000 }), /must be <= 65535/);
    assert.throws(() => validateAdapterConfig(schema, { host: "  " }), /non-empty string/);
  });

  it("enforces enum, url and secret-ref shapes", () => {
    const schema = [
      { name: "endpoint", type: "url", required: true },
      { name: "mode", type: "enum", required: true, values: ["push", "pull"] },
      { name: "credentialsRef", type: "secret-ref", required: false },
      { name: "verbose", type: "boolean", required: false },
    ] as const;

    assert.throws(
      () => validateAdapterConfig(schema, { endpoint: "not-a-url", mode: "push" }),
      /not a valid URL/,
    );
    assert.throws(
      () => validateAdapterConfig(schema, { endpoint: "https://a.example.com", mode: "sideways" }),
      /must be one of: push, pull/,
    );
    assert.throws(
      () =>
        validateAdapterConfig(schema, {
          endpoint: "https://a.example.com",
          mode: "push",
          credentialsRef: "hunter2",
        }),
      /must be a secret reference/,
    );
    assert.throws(
      () =>
        validateAdapterConfig(schema, {
          endpoint: "https://a.example.com",
          mode: "push",
          verbose: "yes",
        }),
      /must be a boolean/,
    );
  });
});

describe("adapter registry", () => {
  it("exposes every bundled driver with its capabilities", () => {
    const h = harness();
    const descriptors = h.hub.services.adapters.descriptors();
    assert.deepEqual(
      descriptors.map((d) => d.kind).sort(),
      ["csv-file", "email", "http", "kafka", "s3", "sftp"],
    );
    const kafka = descriptors.find((d) => d.kind === "kafka")!;
    assert.equal(kafka.direction, "bidirectional");
    assert.equal(kafka.capabilities.supportsPull, true);
    assert.equal(descriptors.find((d) => d.kind === "http")!.capabilities.supportsPull, false);
  });

  it("registers an instance and validates its config against the driver schema", async () => {
    const h = harness();
    const adapter = await registerHttp(h);

    assert.equal(adapter.status, "registered");
    assert.equal(adapter.kind, "http");
    assert.equal(adapter.direction, "outbound");
    // Schema defaults are materialised on the registration.
    assert.equal(adapter.config["timeoutMs"], 10_000);
    assert.equal(adapter.config["batchSize"], 50);
    assert.equal(h.recorder.ofType(IntegrationEventTypes.AdapterRegistered).length, 1);

    await assert.rejects(
      () => h.hub.services.adapters.register(h.ctx, { name: "bad", kind: "http", config: {} }),
      /config 'endpoint' is required/,
    );
    await assert.rejects(
      () =>
        h.hub.services.adapters.register(h.ctx, {
          name: "bad",
          kind: "carrier-pigeon" as never,
          config: {},
        }),
      /No adapter driver registered/,
    );
  });

  it("keeps adapter names unique per tenant", async () => {
    const h = harness();
    await registerHttp(h);
    await assert.rejects(() => registerHttp(h), ConflictError);
    const other = await h.hub.services.adapters.register(otherTenantCtx(), {
      name: "3pl-api",
      kind: "http",
      config: httpConfig,
    });
    assert.equal(other.name, "3pl-api");
    assert.equal((await h.hub.services.adapters.list(h.ctx)).length, 1);
  });

  it("refuses a direction the driver does not support", async () => {
    const h = harness();
    await assert.rejects(
      () =>
        h.hub.services.adapters.register(h.ctx, {
          name: "inbound-http",
          kind: "http",
          config: httpConfig,
          direction: "inbound",
        }),
      /only supports direction 'outbound'/,
    );
    const kafka = await h.hub.services.adapters.register(h.ctx, {
      name: "erp-topic",
      kind: "kafka",
      config: kafkaConfig,
      direction: "inbound",
    });
    assert.equal(kafka.direction, "inbound");
    assert.equal(kafka.canSend, false);
    assert.equal(kafka.canPull, true);
  });

  it("rejects raw credentials in credentialsRef", async () => {
    const h = harness();
    await assert.rejects(
      () =>
        h.hub.services.adapters.register(h.ctx, {
          name: "leaky",
          kind: "http",
          config: httpConfig,
          credentialsRef: "Bearer sk-live-123",
        }),
      DomainError,
    );
  });

  it("reconfigures an adapter but not while disabled", async () => {
    const h = harness();
    const adapter = await registerHttp(h);
    const updated = await h.hub.services.adapters.configure(h.ctx, adapter.id, {
      ...httpConfig,
      timeoutMs: 2_500,
    });
    assert.equal(updated.config["timeoutMs"], 2_500);
    assert.equal(h.recorder.ofType(IntegrationEventTypes.AdapterConfigured).length, 1);

    await h.hub.services.adapters.disable(h.ctx, adapter.id, "partner migration");
    await assert.rejects(
      () => h.hub.services.adapters.configure(h.ctx, adapter.id, httpConfig),
      ConflictError,
    );
  });

  it("degrades on a blip and errors on a streak, recovering on a good check", async () => {
    const h = harness();
    const adapter = await registerHttp(h);

    assert.equal((await h.hub.services.adapters.checkHealth(h.ctx, adapter.id)).status, "connected");

    h.hub.drivers.http.simulation.failNext = ADAPTER_DEGRADE_THRESHOLD;
    assert.equal((await h.hub.services.adapters.checkHealth(h.ctx, adapter.id)).status, "degraded");
    assert.equal((await h.hub.services.adapters.checkHealth(h.ctx, adapter.id)).status, "degraded");
    const failed = await h.hub.services.adapters.checkHealth(h.ctx, adapter.id);
    assert.equal(failed.status, "error");
    assert.equal(failed.consecutiveFailures, 3);
    assert.equal(failed.lastHealth?.healthy, false);

    const recovered = await h.hub.services.adapters.checkHealth(h.ctx, adapter.id);
    assert.equal(recovered.status, "connected");
    assert.equal(recovered.consecutiveFailures, 0);

    // registered->connected, connected->degraded, degraded->error, error->connected
    assert.equal(h.recorder.ofType(IntegrationEventTypes.AdapterHealthChanged).length, 4);
  });

  it("does not health-check a disabled adapter", async () => {
    const h = harness();
    const adapter = await registerHttp(h);
    await h.hub.services.adapters.disable(h.ctx, adapter.id, "decommissioned");
    await assert.rejects(() => h.hub.services.adapters.checkHealth(h.ctx, adapter.id), ConflictError);

    const enabled = await h.hub.services.adapters.enable(h.ctx, adapter.id);
    assert.equal(enabled.status, "registered");
    await assert.rejects(() => h.hub.services.adapters.enable(h.ctx, adapter.id), ConflictError);
  });
});

describe("adapter push", () => {
  it("sends a batch through the http driver and counts it", async () => {
    const h = harness();
    const adapter = await registerHttp(h);
    const { result } = await h.hub.services.adapters.send(h.ctx, adapter.id, [
      { key: "SO-1", eventType: "sales.order.placed", payload: { orderId: "SO-1" } },
      { key: "SO-2", eventType: "sales.order.placed", payload: { orderId: "SO-2" } },
    ]);

    assert.equal(result.accepted, 2);
    assert.equal(h.hub.drivers.http.batches.length, 1);
    assert.equal(h.hub.drivers.http.batches[0]!.endpoint, httpConfig.endpoint);
    assert.equal((await h.hub.services.adapters.get(h.ctx, adapter.id)).messagesSent, 2);
    assert.equal(h.recorder.ofType(IntegrationEventTypes.AdapterMessagesSent).length, 1);
  });

  it("reports per-message rejections without failing the batch", async () => {
    const h = harness();
    const adapter = await registerHttp(h);
    h.hub.drivers.http.simulation.rejectKeys.add("SO-2");

    const { result } = await h.hub.services.adapters.send(h.ctx, adapter.id, [
      { key: "SO-1", eventType: "sales.order.placed", payload: {} },
      { key: "SO-2", eventType: "sales.order.placed", payload: {} },
    ]);
    assert.equal(result.accepted, 1);
    assert.deepEqual(
      result.rejected.map((r) => r.key),
      ["SO-2"],
    );
    assert.equal((await h.hub.services.adapters.get(h.ctx, adapter.id)).messagesSent, 1);
  });

  it("surfaces a driver outage instead of silently dropping the batch", async () => {
    const h = harness();
    const adapter = await registerHttp(h);
    h.hub.drivers.http.simulation.failNext = 1;

    await assert.rejects(
      () =>
        h.hub.services.adapters.send(h.ctx, adapter.id, [
          { key: "SO-1", eventType: "sales.order.placed", payload: {} },
        ]),
      /http adapter unavailable/,
    );
    assert.equal((await h.hub.services.adapters.get(h.ctx, adapter.id)).messagesSent, 0);
  });

  it("refuses to send through a disabled or inbound-only adapter", async () => {
    const h = harness();
    const adapter = await registerHttp(h);
    await h.hub.services.adapters.disable(h.ctx, adapter.id, "maintenance");
    await assert.rejects(
      () =>
        h.hub.services.adapters.send(h.ctx, adapter.id, [
          { key: "SO-1", eventType: "sales.order.placed", payload: {} },
        ]),
      ConflictError,
    );

    const inbound = await h.hub.services.adapters.register(h.ctx, {
      name: "erp-topic-in",
      kind: "kafka",
      config: kafkaConfig,
      direction: "inbound",
    });
    await assert.rejects(
      () =>
        h.hub.services.adapters.send(h.ctx, inbound.id, [
          { key: "k", eventType: "sales.order.placed", payload: {} },
        ]),
      ConflictError,
    );
    await assert.rejects(() => h.hub.services.adapters.send(h.ctx, adapter.id, []), DomainError);
  });

  it("rejects a batch larger than the driver's limit", async () => {
    const h = harness();
    const adapter = await h.hub.services.adapters.register(h.ctx, {
      name: "ops-digest",
      kind: "email",
      config: { to: "ops@acme.example" },
    });
    const messages = Array.from({ length: 101 }, (_, index) => ({
      key: `msg-${index}`,
      eventType: "sales.order.placed",
      payload: { index },
    }));
    await assert.rejects(
      () => h.hub.services.adapters.send(h.ctx, adapter.id, messages),
      /exceeds the driver limit of 100/,
    );
  });

  it("renders a csv export from payload paths", async () => {
    const h = harness();
    const adapter = await h.hub.services.adapters.register(h.ctx, {
      name: "finance-export",
      kind: "csv-file",
      config: { columns: "orderId,total.amount,total.currency", includeHeader: true },
    });
    await h.hub.services.adapters.send(h.ctx, adapter.id, [
      {
        key: "SO-1",
        eventType: "sales.order.placed",
        payload: { orderId: "SO-1", total: { amount: 25_000, currency: "EUR" } },
      },
      {
        key: "SO-2",
        eventType: "sales.order.placed",
        payload: { orderId: "SO,2", total: { amount: 100, currency: "EUR" } },
      },
    ]);

    const [file] = h.hub.drivers.csv.exports;
    assert.equal(file!.fileName, "export-1.csv");
    assert.deepEqual(file!.content.split("\n"), [
      "orderId,total.amount,total.currency",
      "SO-1,25000,EUR",
      '"SO,2",100,EUR',
    ]);
  });
});

describe("adapter pull", () => {
  it("lands pulled messages in the inbox and de-duplicates on replay", async () => {
    const h = harness();
    const adapter = await h.hub.services.adapters.register(h.ctx, {
      name: "erp-topic",
      kind: "kafka",
      config: kafkaConfig,
    });
    h.hub.drivers.kafka.produce("erp.events", [
      { key: "a", eventType: "sales.order.placed", value: { orderId: "SO-1" } },
      { key: "b", eventType: "sales.order.placed", value: { orderId: "SO-2" } },
    ]);

    const first = await h.hub.services.adapters.pull(h.ctx, adapter.id);
    assert.equal(first.received, 2);
    assert.equal(first.duplicates, 0);
    assert.equal(first.cursor, "2");
    assert.equal((await h.hub.services.inbox.list(h.ctx)).length, 2);

    // Re-pulling from offset 0 sees the same messages; the inbox absorbs them.
    const replay = await h.hub.services.adapters.pull(h.ctx, adapter.id);
    assert.equal(replay.duplicates, 2);
    assert.equal((await h.hub.services.inbox.list(h.ctx)).length, 2);

    // Resuming from the cursor returns nothing new.
    const resumed = await h.hub.services.adapters.pull(h.ctx, adapter.id, first.cursor);
    assert.equal(resumed.received, 0);
    assert.equal((await h.hub.services.adapters.get(h.ctx, adapter.id)).messagesPulled, 4);
  });

  it("picks up files dropped on the sftp share", async () => {
    const h = harness();
    const adapter = await h.hub.services.adapters.register(h.ctx, {
      name: "edi-in",
      kind: "sftp",
      config: sftpConfig,
    });
    h.hub.drivers.sftp.placeInboundFile(
      { inboundDir: "/inbound" },
      "desadv-001.json",
      JSON.stringify({ asn: "ASN-1", lines: 3 }),
    );

    const pulled = await h.hub.services.adapters.pull(h.ctx, adapter.id);
    assert.equal(pulled.received, 1);
    const [message] = await h.hub.services.inbox.list(h.ctx);
    assert.equal(message!.source, "adapter:edi-in");
    assert.equal(message!.eventType, "integration.adapter.file-received");
    assert.deepEqual(message!.payload, { asn: "ASN-1", lines: 3 });

    // The file is consumed, so a second pull is empty.
    assert.equal((await h.hub.services.adapters.pull(h.ctx, adapter.id)).received, 0);
  });

  it("refuses to pull through an outbound-only driver", async () => {
    const h = harness();
    const adapter = await registerHttp(h);
    await assert.rejects(
      () => h.hub.services.adapters.pull(h.ctx, adapter.id),
      /outbound-only/,
    );
  });

  it("hides adapters from other tenants", async () => {
    const h = harness();
    const adapter = await registerHttp(h);
    await assert.rejects(
      () => h.hub.services.adapters.get(otherTenantCtx(), adapter.id),
      NotFoundError,
    );
  });
});
