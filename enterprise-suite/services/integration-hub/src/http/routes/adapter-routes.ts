import type { AdapterService } from "../../application/adapter-service.js";
import type {
  AdapterDirection,
  AdapterKind,
  AdapterStatus,
} from "../../domain/adapter.js";
import type { Router } from "../router.js";
import {
  asObject,
  optionalEnum,
  optionalString,
  queryEnum,
  requireEnum,
  requireRecord,
  requireString,
  ulidParam,
} from "../validation.js";
import { parseAdapterMessages } from "./parsers.js";

const KINDS: readonly AdapterKind[] = ["http", "sftp", "s3", "kafka", "csv-file", "email"];
const STATUSES: readonly AdapterStatus[] = [
  "registered",
  "connected",
  "degraded",
  "error",
  "disabled",
];
const DIRECTIONS: readonly AdapterDirection[] = ["inbound", "outbound", "bidirectional"];

export function registerAdapterRoutes(router: Router, adapters: AdapterService): void {
  /** Driver catalog: kinds, capabilities and their config schemas. */
  router.get("/adapters/drivers", async () => ({ body: { items: adapters.descriptors() } }));

  router.post("/adapters", async ({ ctx, body }) => {
    const obj = asObject(body);
    const adapter = await adapters.register(ctx, {
      name: requireString(obj, "name"),
      kind: requireEnum(obj, "kind", KINDS),
      config: requireRecord(obj, "config"),
      direction: optionalEnum(obj, "direction", DIRECTIONS),
      credentialsRef: optionalString(obj, "credentialsRef"),
    });
    return { status: 201, body: adapter.toJSON() };
  });

  router.get("/adapters", async ({ ctx, query }) => {
    const items = await adapters.list(ctx, {
      kind: queryEnum(query, "kind", KINDS),
      status: queryEnum(query, "status", STATUSES),
      direction: queryEnum(query, "direction", DIRECTIONS),
    });
    return { body: { items: items.map((adapter) => adapter.toJSON()), total: items.length } };
  });

  router.get("/adapters/:id", async ({ ctx, params }) => ({
    body: (await adapters.get(ctx, ulidParam(params, "id"))).toJSON(),
  }));

  router.patch("/adapters/:id/config", async ({ ctx, params, body }) => {
    const obj = asObject(body);
    const adapter = await adapters.configure(ctx, ulidParam(params, "id"), requireRecord(obj, "config"));
    return { body: adapter.toJSON() };
  });

  router.post("/adapters/:id/test", async ({ ctx, params }) => {
    const adapter = await adapters.checkHealth(ctx, ulidParam(params, "id"));
    return { body: { status: adapter.status, health: adapter.lastHealth } };
  });

  router.post("/adapters/:id/enable", async ({ ctx, params }) => ({
    body: (await adapters.enable(ctx, ulidParam(params, "id"))).toJSON(),
  }));

  router.post("/adapters/:id/disable", async ({ ctx, params, body }) => {
    const obj = asObject(body);
    const adapter = await adapters.disable(ctx, ulidParam(params, "id"), requireString(obj, "reason"));
    return { body: adapter.toJSON() };
  });

  router.post("/adapters/:id/send", async ({ ctx, params, body }) => {
    const obj = asObject(body);
    const { result } = await adapters.send(
      ctx,
      ulidParam(params, "id"),
      parseAdapterMessages(obj["messages"]),
    );
    return { status: 202, body: result };
  });

  /** Pulls from an inbound adapter; everything lands in the inbox. */
  router.post("/adapters/:id/pull", async ({ ctx, params, body }) => {
    const obj = body === undefined ? {} : asObject(body);
    const result = await adapters.pull(ctx, ulidParam(params, "id"), optionalString(obj, "cursor"));
    return {
      body: { received: result.received, duplicates: result.duplicates, cursor: result.cursor },
    };
  });
}
