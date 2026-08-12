import type { RouteDefinition } from "./route.js";

/**
 * A deliberately small OpenAPI 3.1 subset — enough to describe upstream
 * documents, merge them under a single gateway document, and synthesize a
 * stub document for services that do not publish one yet.
 */

export interface OpenApiInfo {
  readonly title: string;
  readonly version: string;
  readonly description?: string;
}

export interface OpenApiServer {
  readonly url: string;
  readonly description?: string;
}

export interface OpenApiTag {
  readonly name: string;
  readonly description?: string;
}

export type OpenApiParameterIn = "path" | "query" | "header" | "cookie";

export interface OpenApiParameter {
  readonly name: string;
  readonly in: OpenApiParameterIn;
  readonly required?: boolean;
  readonly description?: string;
  readonly schema?: JsonSchema;
}

export interface JsonSchema {
  readonly [key: string]: unknown;
}

export interface OpenApiMediaType {
  readonly schema?: JsonSchema;
  readonly example?: unknown;
}

export interface OpenApiRequestBody {
  readonly required?: boolean;
  readonly description?: string;
  readonly content: Readonly<Record<string, OpenApiMediaType>>;
}

export interface OpenApiResponse {
  readonly description: string;
  readonly content?: Readonly<Record<string, OpenApiMediaType>>;
}

export interface OpenApiOperation {
  readonly operationId?: string;
  readonly summary?: string;
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly deprecated?: boolean;
  readonly parameters?: readonly OpenApiParameter[];
  readonly requestBody?: OpenApiRequestBody;
  readonly responses: Readonly<Record<string, OpenApiResponse>>;
  readonly security?: readonly Readonly<Record<string, readonly string[]>>[];
  readonly [extension: string]: unknown;
}

export type OpenApiPathItem = Readonly<Record<string, OpenApiOperation>>;

export interface OpenApiComponents {
  readonly schemas?: Readonly<Record<string, JsonSchema>>;
  readonly parameters?: Readonly<Record<string, OpenApiParameter>>;
  readonly responses?: Readonly<Record<string, OpenApiResponse>>;
  readonly securitySchemes?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

export interface OpenApiDocument {
  readonly openapi: string;
  readonly info: OpenApiInfo;
  readonly servers?: readonly OpenApiServer[];
  readonly tags?: readonly OpenApiTag[];
  readonly paths: Readonly<Record<string, OpenApiPathItem>>;
  readonly components?: OpenApiComponents;
  readonly security?: readonly Readonly<Record<string, readonly string[]>>[];
}

export const OPENAPI_VERSION = "3.1.0";

export const TENANT_HEADER_PARAMETERS: readonly OpenApiParameter[] = [
  {
    name: "x-tenant-id",
    in: "header",
    required: true,
    description: "Tenant scoping every request. Rejected with 400 when absent.",
    schema: { type: "string", minLength: 1 },
  },
  {
    name: "x-user-id",
    in: "header",
    required: true,
    description: "Acting principal; recorded on audit entries.",
    schema: { type: "string", minLength: 1 },
  },
  {
    name: "x-roles",
    in: "header",
    required: false,
    description: "Comma separated role codes used for coarse authorization.",
    schema: { type: "string" },
  },
  {
    name: "x-request-id",
    in: "header",
    required: false,
    description: "Correlation id echoed on the response; generated when absent.",
    schema: { type: "string" },
  },
];

export const ERROR_SCHEMA: JsonSchema = {
  type: "object",
  required: ["code", "message"],
  properties: {
    code: { type: "string", example: "VALIDATION" },
    message: { type: "string" },
    details: {},
    requestId: { type: "string" },
  },
};

export function errorResponse(description: string): OpenApiResponse {
  return {
    description,
    content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
  };
}

export interface MergeInput {
  readonly serviceId: string;
  readonly document: OpenApiDocument;
  /** Public prefix prepended to every path of this document. */
  readonly prefix: string;
}

export interface MergeOptions {
  readonly info: OpenApiInfo;
  readonly servers?: readonly OpenApiServer[];
  /** Prefix operationIds with the service id to keep codegen unambiguous. */
  readonly namespaceOperationIds?: boolean;
  /** Prefix tags with the service id. */
  readonly namespaceTags?: boolean;
  readonly securitySchemes?: OpenApiComponents["securitySchemes"];
}

export interface MergeReport {
  readonly services: readonly string[];
  readonly pathCount: number;
  readonly operationCount: number;
  readonly renamedComponents: readonly { from: string; to: string; serviceId: string }[];
  readonly droppedPaths: readonly { path: string; serviceId: string; reason: string }[];
  readonly warnings: readonly string[];
}

export interface MergeResult {
  readonly document: OpenApiDocument;
  readonly report: MergeReport;
}

const OPERATION_KEYS = new Set([
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
]);

/**
 * Merges upstream documents into one gateway document.
 *
 * Paths are prefixed with the owning service's public prefix. Component
 * schemas are shared when structurally identical and renamed to
 * `<ServiceId>_<Name>` when two services disagree on the same name; every
 * `$ref` inside the injected subtree is rewritten accordingly.
 */
export function mergeOpenApiDocuments(
  inputs: readonly MergeInput[],
  options: MergeOptions,
): MergeResult {
  const paths: Record<string, Record<string, OpenApiOperation>> = {};
  const schemas: Record<string, JsonSchema> = { Error: ERROR_SCHEMA };
  const tags = new Map<string, OpenApiTag>();
  const renamedComponents: { from: string; to: string; serviceId: string }[] = [];
  const droppedPaths: { path: string; serviceId: string; reason: string }[] = [];
  const warnings: string[] = [];
  const seenOperationIds = new Map<string, string>();
  let operationCount = 0;

  for (const input of inputs) {
    const rename = new Map<string, string>();

    for (const [name, schema] of Object.entries(input.document.components?.schemas ?? {})) {
      const existing = schemas[name];
      if (existing === undefined) {
        schemas[name] = schema;
        continue;
      }
      if (deepEqual(existing, schema)) continue;
      const alias = `${pascalCase(input.serviceId)}_${name}`;
      schemas[alias] = schema;
      rename.set(name, alias);
      renamedComponents.push({ from: name, to: alias, serviceId: input.serviceId });
    }

    // Second pass so that renames discovered above also apply inside schemas.
    for (const alias of rename.values()) {
      const target = schemas[alias];
      if (target) schemas[alias] = rewriteRefs(target, rename) as JsonSchema;
    }

    for (const tag of input.document.tags ?? []) {
      const name = options.namespaceTags ? `${input.serviceId}:${tag.name}` : tag.name;
      if (!tags.has(name)) tags.set(name, { name, description: tag.description });
    }

    for (const [path, item] of Object.entries(input.document.paths ?? {})) {
      const publicPath = joinPath(input.prefix, path);
      if (paths[publicPath] === undefined) paths[publicPath] = {};
      const bucket = paths[publicPath]!;

      for (const [method, operation] of Object.entries(item)) {
        if (!OPERATION_KEYS.has(method.toLowerCase())) continue;
        if (bucket[method] !== undefined) {
          droppedPaths.push({
            path: `${method.toUpperCase()} ${publicPath}`,
            serviceId: input.serviceId,
            reason: "operation already contributed by another service",
          });
          continue;
        }

        const rewritten = rewriteRefs(operation, rename) as OpenApiOperation;
        const operationTags = (rewritten.tags ?? [input.serviceId]).map((tag) =>
          options.namespaceTags ? `${input.serviceId}:${tag}` : tag,
        );
        for (const tag of operationTags) {
          if (!tags.has(tag)) tags.set(tag, { name: tag });
        }

        let operationId = rewritten.operationId;
        if (operationId && options.namespaceOperationIds !== false) {
          operationId = `${camelCase(input.serviceId)}_${operationId}`;
        }
        if (operationId) {
          const owner = seenOperationIds.get(operationId);
          if (owner) {
            warnings.push(
              `duplicate operationId "${operationId}" from ${input.serviceId} (also ${owner})`,
            );
            operationId = `${operationId}_${slug(publicPath)}`;
          }
          seenOperationIds.set(operationId, input.serviceId);
        }

        bucket[method] = {
          ...rewritten,
          operationId,
          tags: operationTags,
          "x-upstream-service": input.serviceId,
        };
        operationCount += 1;
      }
    }
  }

  const document: OpenApiDocument = {
    openapi: OPENAPI_VERSION,
    info: options.info,
    servers: options.servers,
    tags: [...tags.values()].sort((a, b) => a.name.localeCompare(b.name)),
    paths: sortKeys(paths),
    components: {
      schemas: sortKeys(schemas),
      securitySchemes: options.securitySchemes,
    },
  };

  return {
    document,
    report: {
      services: inputs.map((i) => i.serviceId),
      pathCount: Object.keys(paths).length,
      operationCount,
      renamedComponents,
      droppedPaths,
      warnings,
    },
  };
}

/**
 * Builds a placeholder document for an upstream that has not published a spec.
 * The gateway already knows the route surface, the tenant headers and the
 * error envelope, so the stub is genuinely useful for discovery even though
 * request/response schemas are unknown.
 */
export function synthesizeSpecFromRoutes(
  service: { id: string; label: string; version: string; prefix: string },
  routes: readonly RouteDefinition[],
): OpenApiDocument {
  const paths: Record<string, Record<string, OpenApiOperation>> = {};

  for (const route of routes) {
    if (route.exposeInOpenApi === false) continue;
    const localPath = stripPrefix(route.pattern, service.prefix);
    const specPath = toOpenApiPath(localPath);
    const bucket = (paths[specPath] ??= {});
    const pathParams = route.pattern
      .split("/")
      .filter((s) => s.startsWith(":"))
      .map<OpenApiParameter>((s) => ({
        name: s.slice(1),
        in: "path",
        required: true,
        schema: { type: "string" },
      }));

    const responses: Record<string, OpenApiResponse> = {
      "200": { description: "Success" },
      "400": errorResponse("Validation or missing tenant header"),
      "500": errorResponse("Unexpected gateway or upstream failure"),
    };
    if (route.auth.mode !== "anonymous") {
      responses["401"] = errorResponse("Missing or invalid principal");
    }
    if ((route.auth.anyOfRoles ?? []).length > 0 || (route.auth.allOfPermissions ?? []).length > 0) {
      responses["403"] = errorResponse("Caller lacks the required role or permission");
    }
    if (route.rateLimit) responses["429"] = errorResponse("Rate limit exceeded");

    bucket[route.method.toLowerCase()] = {
      operationId: route.id.replace(/[^A-Za-z0-9]+/g, "_"),
      summary: route.summary ?? `${route.method} ${route.pattern}`,
      description:
        "Stub operation synthesized by the gateway from the route table; the upstream does not publish an OpenAPI document yet.",
      tags: route.tags && route.tags.length > 0 ? [...route.tags] : [service.id],
      deprecated: route.deprecated,
      parameters: [...pathParams, ...TENANT_HEADER_PARAMETERS],
      responses,
      "x-stub": true,
      "x-rate-limit": route.rateLimit,
    };
  }

  return {
    openapi: OPENAPI_VERSION,
    info: {
      title: `${service.label} (stub)`,
      version: service.version,
      description: `Synthesized from ${routes.length} gateway route(s). Replace by publishing ${service.prefix}/openapi.json upstream.`,
    },
    tags: [{ name: service.id, description: service.label }],
    paths: sortKeys(paths),
    components: { schemas: { Error: ERROR_SCHEMA } },
  };
}

/** `/products/:id` → `/products/{id}` */
export function toOpenApiPath(pattern: string): string {
  return (
    "/" +
    pattern
      .split("/")
      .filter((s) => s.length > 0)
      .map((segment) => {
        if (segment.startsWith(":")) return `{${segment.slice(1)}}`;
        if (segment.startsWith("*")) return `{${segment.slice(1) || "rest"}}`;
        return segment;
      })
      .join("/")
  );
}

export function stripPrefix(path: string, prefix: string): string {
  if (!prefix || prefix === "/") return path;
  if (path === prefix) return "/";
  return path.startsWith(`${prefix}/`) ? path.slice(prefix.length) : path;
}

function joinPath(prefix: string, path: string): string {
  const left = prefix === "/" ? "" : prefix.replace(/\/$/, "");
  const right = path === "/" ? "" : path;
  const joined = `${left}${right.startsWith("/") || right === "" ? "" : "/"}${right}`;
  return joined.length === 0 ? "/" : joined;
}

/** Rewrites `#/components/schemas/X` refs according to a rename map. */
export function rewriteRefs(node: unknown, rename: ReadonlyMap<string, string>): unknown {
  if (rename.size === 0) return node;
  if (Array.isArray(node)) return node.map((item) => rewriteRefs(item, rename));
  if (node === null || typeof node !== "object") return node;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === "$ref" && typeof value === "string") {
      const match = /^#\/components\/schemas\/(.+)$/.exec(value);
      const alias = match ? rename.get(match[1]!) : undefined;
      out[key] = alias ? `#/components/schemas/${alias}` : value;
      continue;
    }
    out[key] = rewriteRefs(value, rename);
  }
  return out;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  if (typeof a !== "object") return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => key in right && deepEqual(left[key], right[key]));
}

function sortKeys<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}

function pascalCase(value: string): string {
  return value
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function camelCase(value: string): string {
  const pascal = pascalCase(value);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

function slug(value: string): string {
  return value.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
}
