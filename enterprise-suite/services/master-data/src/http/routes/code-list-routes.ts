import type { CodeListEntryInput } from "../../domain/code-list.js";
import { ValidationError } from "../../domain/errors.js";
import type { MasterDataContainer } from "../../infrastructure/container.js";
import { jsonResponse, type Router } from "../router.js";
import {
  asRecord,
  optionalAttributeMap,
  optionalBoolean,
  optionalInteger,
  optionalString,
  requiredInteger,
  requiredQuery,
  requiredString,
} from "../validate.js";

/**
 * Governed vocabularies.
 *
 * Reads take an `asOf` date and answer with the version effective then;
 * writes go through the draft/publish cycle rather than editing live data.
 */
export function registerCodeListRoutes(router: Router, container: MasterDataContainer): void {
  const { codeList } = container.services;

  router.get("/code-lists", async (req) => jsonResponse(200, await codeList.list(req.ctx)));

  router.post("/code-lists", async (req) => {
    const body = asRecord(req.body);
    const created = await codeList.create(req.ctx, {
      listCode: requiredString(body, "listCode"),
      name: requiredString(body, "name"),
      description: optionalString(body, "description"),
      steward: optionalString(body, "steward"),
      allowsCustomCodes: optionalBoolean(body, "allowsCustomCodes"),
      hierarchical: optionalBoolean(body, "hierarchical"),
    });
    return jsonResponse(201, {
      id: created.id,
      listCode: created.listCode,
      name: created.name,
      versions: created.versions,
    });
  });

  router.get("/code-lists/:listCode", async (req) => {
    const list = await codeList.get(req.ctx, req.params["listCode"]!);
    return jsonResponse(200, {
      id: list.id,
      listCode: list.listCode,
      name: list.name,
      steward: list.steward,
      hierarchical: list.hierarchical,
      allowsCustomCodes: list.allowsCustomCodes,
      versions: list.versions,
    });
  });

  router.get("/code-lists/:listCode/entries", async (req) =>
    jsonResponse(
      200,
      await codeList.entries(req.ctx, req.params["listCode"]!, {
        asOf: req.query.get("asOf") ?? undefined,
        includeDeprecated: req.query.get("includeDeprecated") === "true",
        parentCode: req.query.get("parent") ?? undefined,
      }),
    ),
  );

  /** Resolves a code and returns its root-to-leaf path. */
  router.get("/code-lists/:listCode/entries/:code", async (req) =>
    jsonResponse(
      200,
      await codeList.resolve(
        req.ctx,
        req.params["listCode"]!,
        req.params["code"]!,
        req.query.get("asOf") ?? undefined,
      ),
    ),
  );

  router.get("/code-lists/:listCode/entries/:code/descendants", async (req) =>
    jsonResponse(
      200,
      await codeList.descendants(
        req.ctx,
        req.params["listCode"]!,
        req.params["code"]!,
        req.query.get("asOf") ?? undefined,
      ),
    ),
  );

  /** Maps a historical code forward, following deprecation successors. */
  router.get("/code-lists/:listCode/translate", async (req) =>
    jsonResponse(
      200,
      await codeList.translate(
        req.ctx,
        req.params["listCode"]!,
        requiredQuery(req.query, "code"),
        Number(requiredQuery(req.query, "from")),
        Number(requiredQuery(req.query, "to")),
      ),
    ),
  );

  router.get("/code-lists/:listCode/diff", async (req) =>
    jsonResponse(
      200,
      await codeList.diff(
        req.ctx,
        req.params["listCode"]!,
        Number(requiredQuery(req.query, "from")),
        Number(requiredQuery(req.query, "to")),
      ),
    ),
  );

  router.post("/code-lists/:listCode/versions", async (req) => {
    const body = asRecord(req.body ?? {});
    const version = await codeList.draftNewVersion(
      req.ctx,
      req.params["listCode"]!,
      optionalString(body, "notes"),
    );
    return jsonResponse(201, version);
  });

  /** Accepts one entry or a batch; parents must precede their children. */
  router.post("/code-lists/:listCode/entries", async (req) => {
    const body = asRecord(req.body);
    const batch = body["entries"];
    if (batch !== undefined) {
      if (!Array.isArray(batch) || batch.length === 0) {
        throw ValidationError.single("entries", "must be a non-empty array of entries");
      }
      const saved = await codeList.upsertEntries(
        req.ctx,
        req.params["listCode"]!,
        batch.map((entry) => readEntry(asRecord(entry))),
      );
      return jsonResponse(201, saved);
    }
    return jsonResponse(201, await codeList.upsertEntry(req.ctx, req.params["listCode"]!, readEntry(body)));
  });

  router.delete("/code-lists/:listCode/entries/:code", async (req) => {
    await codeList.removeDraftEntry(req.ctx, req.params["listCode"]!, req.params["code"]!);
    return jsonResponse(204);
  });

  router.post("/code-lists/:listCode/entries/:code/deprecate", async (req) => {
    const body = asRecord(req.body);
    const entry = await codeList.deprecateEntry(
      req.ctx,
      req.params["listCode"]!,
      requiredInteger(body, "version"),
      req.params["code"]!,
      { reason: optionalString(body, "reason"), replacedBy: optionalString(body, "replacedBy") },
    );
    return jsonResponse(200, entry);
  });

  router.post("/code-lists/:listCode/publish", async (req) => {
    const body = asRecord(req.body);
    const published = await codeList.publish(
      req.ctx,
      req.params["listCode"]!,
      requiredString(body, "effectiveFrom"),
    );
    return jsonResponse(200, published);
  });

  router.post("/code-lists/:listCode/retire", async (req) => {
    const body = asRecord(req.body);
    const retired = await codeList.retireVersion(
      req.ctx,
      req.params["listCode"]!,
      requiredInteger(body, "version"),
      requiredString(body, "effectiveTo"),
    );
    return jsonResponse(200, retired);
  });

  router.delete("/code-lists/:listCode/draft", async (req) => {
    await codeList.discardDraft(req.ctx, req.params["listCode"]!);
    return jsonResponse(204);
  });
}

function readEntry(body: Record<string, unknown>): CodeListEntryInput {
  return {
    code: requiredString(body, "code"),
    label: requiredString(body, "label"),
    description: optionalString(body, "description"),
    parentCode: optionalString(body, "parentCode"),
    sortOrder: optionalInteger(body, "sortOrder"),
    attributes: optionalAttributeMap(body, "attributes"),
  };
}
