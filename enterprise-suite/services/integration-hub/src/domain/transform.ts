/**
 * Payload transformation.
 *
 * Partners rarely accept our envelope shape verbatim: one wants a flat object
 * with their own field names, another wants a fixed `type` discriminator and
 * a subset of lines. Route rules therefore carry a declarative transform,
 * evaluated against `{ event, payload, tenantId, ... }`.
 *
 * The spec is data (JSON), never code: it is stored in the database, edited
 * by operators, and must not be able to execute anything.
 */
import { DomainError } from "@enterprise-suite/shared-kernel";

export type TransformNode =
  /** Literal value. */
  | { readonly const: unknown }
  /** Value read from the context by path, e.g. `payload.ncrNumber`. */
  | { readonly path: string; readonly default?: unknown; readonly required?: boolean }
  /** String with `{{path}}` placeholders. */
  | { readonly template: string }
  /** Nested object. */
  | { readonly fields: Record<string, TransformNode> }
  /** Maps an array at `path`, applying `item` with `it` bound to each element. */
  | { readonly each: string; readonly item: TransformNode };

export interface TransformSpec {
  readonly fields: Record<string, TransformNode>;
}

const PATH_SEGMENT = /^[A-Za-z0-9_$-]+$/;

/**
 * Reads `a.b[0].c` out of a plain object graph. Returns `undefined` for any
 * missing link instead of throwing, so specs can use `default`.
 */
export function getPath(source: unknown, path: string): unknown {
  if (path === "" || path === "$") return source;
  let current: unknown = source;
  for (const rawSegment of path.split(".")) {
    if (current === null || current === undefined) return undefined;
    const match = /^([^[\]]*)((?:\[\d+\])*)$/.exec(rawSegment);
    if (!match) return undefined;
    const key = match[1] ?? "";
    if (key !== "") {
      if (typeof current !== "object") return undefined;
      current = (current as Record<string, unknown>)[key];
    }
    const indexes = match[2] ?? "";
    for (const indexMatch of indexes.matchAll(/\[(\d+)\]/g)) {
      if (!Array.isArray(current)) return undefined;
      current = current[Number(indexMatch[1])];
    }
  }
  return current;
}

/** Substitutes `{{path}}` placeholders; missing values render as an empty string. */
export function renderTemplate(template: string, context: unknown): string {
  return template.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (_match, path: string) => {
    const value = getPath(context, path);
    if (value === undefined || value === null) return "";
    return typeof value === "object" ? JSON.stringify(value) : String(value);
  });
}

export function validateTransformSpec(spec: TransformSpec): TransformSpec {
  if (!spec || typeof spec !== "object" || typeof spec.fields !== "object") {
    throw new DomainError("transform spec must be an object with a 'fields' map", "VALIDATION");
  }
  const visit = (node: TransformNode, at: string): void => {
    if (!node || typeof node !== "object") {
      throw new DomainError(`transform node at '${at}' must be an object`, "VALIDATION");
    }
    if ("const" in node) return;
    if ("template" in node) {
      if (typeof node.template !== "string") {
        throw new DomainError(`'${at}.template' must be a string`, "VALIDATION");
      }
      return;
    }
    if ("path" in node) {
      assertPath(node.path, at);
      return;
    }
    if ("fields" in node) {
      for (const [key, child] of Object.entries(node.fields)) visit(child, `${at}.${key}`);
      return;
    }
    if ("each" in node) {
      assertPath(node.each, at);
      visit(node.item, `${at}[]`);
      return;
    }
    throw new DomainError(
      `transform node at '${at}' must have one of: const, path, template, fields, each`,
      "VALIDATION",
    );
  };
  for (const [key, node] of Object.entries(spec.fields)) visit(node, key);
  return spec;
}

function assertPath(path: string, at: string): void {
  if (typeof path !== "string" || path.trim() === "") {
    throw new DomainError(`'${at}.path' must be a non-empty string`, "VALIDATION");
  }
  for (const segment of path.split(".")) {
    const key = segment.replace(/\[\d+\]/g, "");
    if (key !== "" && !PATH_SEGMENT.test(key)) {
      throw new DomainError(`'${at}' contains an invalid path segment '${segment}'`, "VALIDATION");
    }
  }
}

function evaluateNode(node: TransformNode, context: unknown, at: string): unknown {
  if ("const" in node) return node.const;
  if ("template" in node) return renderTemplate(node.template, context);
  if ("path" in node) {
    const value = getPath(context, node.path);
    if (value === undefined) {
      if (node.required) {
        throw new DomainError(`transform '${at}' requires missing path '${node.path}'`, "VALIDATION");
      }
      return node.default;
    }
    return value;
  }
  if ("fields" in node) {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(node.fields)) {
      const value = evaluateNode(child, context, `${at}.${key}`);
      if (value !== undefined) out[key] = value;
    }
    return out;
  }
  const source = getPath(context, node.each);
  if (!Array.isArray(source)) return [];
  return source.map((item, index) =>
    evaluateNode(
      node.item,
      { ...(typeof context === "object" && context !== null ? context : {}), it: item, index },
      `${at}[${index}]`,
    ),
  );
}

/** Applies a validated spec to a context, producing the outbound payload. */
export function applyTransform(spec: TransformSpec, context: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, node] of Object.entries(spec.fields)) {
    const value = evaluateNode(node, context, key);
    if (value !== undefined) out[key] = value;
  }
  return out;
}
