import { json, type Router } from "@enterprise-suite/api-gateway";
import { tenantId as toTenantId, type IsoDateTime } from "@enterprise-suite/shared-kernel";
import type { ReferenceEntryInput } from "../../domain/reference-data.js";
import type { AdminContainer } from "../../infrastructure/container.js";
import { commandContext } from "../context.js";
import {
  asArray,
  asRecord,
  booleanFromQuery,
  optionalBoolean,
  optionalNumber,
  optionalString,
  optionalStringMap,
  requiredString,
} from "../validate.js";

/**
 * Reference data administration plus the read path domain services call.
 *
 * Reads accept `?at=<iso>` so a consumer can ask what a code list looked like
 * when a historical document was written.
 */
export function registerReferenceDataRoutes(router: Router, container: AdminContainer): void {
  const service = container.services.referenceData;
  const tenantOf = (req: { ctx: { tenantId: unknown } }) => toTenantId(String(req.ctx.tenantId));

  router.get(
    "/reference-data",
    (req) =>
      json(200, {
        items: service
          .list(tenantOf(req), {
            status: req.query.get("status") ?? undefined,
            search: req.query.get("q") ?? undefined,
          })
          .map((set) => ({
            code: set.code,
            name: set.name,
            status: set.status,
            hierarchical: set.hierarchical,
            locked: set.isLocked,
            revision: set.revision,
            entryCount: set.entries.length,
            activeEntryCount: set.entries.filter((entry) => entry.active).length,
          })),
      }),
    "reference-data.list",
  );

  router.post(
    "/reference-data",
    async (req) => {
      const body = asRecord(req.body);
      const created = await service.createSet(commandContext(req), {
        code: requiredString(body, "code"),
        name: requiredString(body, "name"),
        description: optionalString(body, "description"),
        hierarchical: optionalBoolean(body, "hierarchical"),
        entries: body["entries"] === undefined ? undefined : parseEntries(body["entries"]),
      });
      return json(201, created.toJSON());
    },
    "reference-data.create",
  );

  router.get(
    "/reference-data/:setCode",
    (req) => {
      const set = service.require(tenantOf(req), req.params["setCode"]!);
      const at = (req.query.get("at") ?? undefined) as IsoDateTime | undefined;
      const includeInactive = booleanFromQuery(req.query, "includeInactive") ?? false;
      const entries = at || !includeInactive ? set.resolve(at ?? container.clock.now(), { includeInactive }) : set.entries;
      return json(200, {
        ...set.toJSON(),
        entries,
        tree: set.hierarchical ? set.tree(at) : undefined,
      });
    },
    "reference-data.get",
  );

  router.patch(
    "/reference-data/:setCode",
    async (req) => {
      const body = asRecord(req.body);
      const entries = body["entries"];
      const setCode = req.params["setCode"]!;
      if (entries !== undefined) {
        await service.importEntries(commandContext(req), setCode, parseEntries(entries));
      }
      return json(200, service.require(tenantOf(req), setCode).toJSON());
    },
    "reference-data.update",
  );

  router.delete(
    "/reference-data/:setCode",
    async (req) => {
      const deprecated = await service.deprecate(commandContext(req), req.params["setCode"]!);
      return json(200, deprecated.toJSON());
    },
    "reference-data.delete",
  );

  router.post(
    "/reference-data/:setCode/publish",
    async (req) =>
      json(200, (await service.publish(commandContext(req), req.params["setCode"]!)).toJSON()),
    "reference-data.publish",
  );

  router.post(
    "/reference-data/:setCode/entries",
    async (req) => {
      const entry = await service.addEntry(
        commandContext(req),
        req.params["setCode"]!,
        parseEntry(asRecord(req.body)),
      );
      return json(201, entry);
    },
    "reference-data.add-entry",
  );

  router.patch(
    "/reference-data/:setCode/entries/:entryCode",
    async (req) => {
      const body = asRecord(req.body);
      const entry = await service.updateEntry(
        commandContext(req),
        req.params["setCode"]!,
        req.params["entryCode"]!,
        {
          label: optionalString(body, "label"),
          description: optionalString(body, "description"),
          sortOrder: optionalNumber(body, "sortOrder"),
          active: optionalBoolean(body, "active"),
          parentCode: optionalString(body, "parentCode"),
          effectiveFrom: optionalString(body, "effectiveFrom"),
          effectiveTo: optionalString(body, "effectiveTo"),
          attributes: optionalStringMap(body, "attributes"),
        },
      );
      return json(200, entry);
    },
    "reference-data.update-entry",
  );

  router.delete(
    "/reference-data/:setCode/entries/:entryCode",
    async (req) => {
      const retired = await service.retireEntry(
        commandContext(req),
        req.params["setCode"]!,
        req.params["entryCode"]!,
      );
      return json(200, { retired });
    },
    "reference-data.retire-entry",
  );

  /** Compact `code → label` map for form dropdowns. */
  router.get(
    "/reference-data/:setCode/labels",
    (req) =>
      json(
        200,
        service.labels(
          tenantOf(req),
          req.params["setCode"]!,
          (req.query.get("at") ?? undefined) as IsoDateTime | undefined,
        ),
      ),
    "reference-data.labels",
  );
}

function parseEntries(value: unknown): ReferenceEntryInput[] {
  return asArray(value, "entries").map((entry, index) =>
    parseEntry(asRecord(entry, `entries[${index}]`)),
  );
}

function parseEntry(body: Record<string, unknown>): ReferenceEntryInput {
  return {
    code: requiredString(body, "code"),
    label: requiredString(body, "label"),
    description: optionalString(body, "description"),
    sortOrder: optionalNumber(body, "sortOrder"),
    active: optionalBoolean(body, "active"),
    parentCode: optionalString(body, "parentCode"),
    effectiveFrom: optionalString(body, "effectiveFrom"),
    effectiveTo: optionalString(body, "effectiveTo"),
    attributes: optionalStringMap(body, "attributes"),
  };
}
