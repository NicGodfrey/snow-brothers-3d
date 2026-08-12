/**
 * Minimal escaping template layer.
 *
 * Interpolations are escaped by default; anything already rendered is marked
 * with `raw`/`Html` and passed through. This is the only place in the portal
 * that produces markup from strings.
 */

export interface Html {
  readonly __html: string;
}

const ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

export function raw(value: string): Html {
  return { __html: value };
}

export function isHtml(value: unknown): value is Html {
  return typeof value === "object" && value !== null && "__html" in value;
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): Html {
  let out = "";
  strings.forEach((chunk, index) => {
    out += chunk;
    if (index < values.length) out += stringify(values[index]);
  });
  return raw(out);
}

export function render(node: Html): string {
  return node.__html;
}

export function join(nodes: readonly Html[], separator = ""): Html {
  return raw(nodes.map((n) => n.__html).join(separator));
}

/** Conditional class list: `classes(["btn", active && "btn--active"])`. */
export function classes(values: ReadonlyArray<string | false | undefined | null>): string {
  return values.filter((v): v is string => typeof v === "string" && v.length > 0).join(" ");
}

/** JSON safe to embed in a <script type="application/json"> block. */
export function jsonScript(value: unknown): Html {
  return raw(JSON.stringify(value).replace(/</g, "\\u003c"));
}

function stringify(value: unknown): string {
  if (value === null || value === undefined || value === false) return "";
  if (isHtml(value)) return value.__html;
  if (Array.isArray(value)) return value.map(stringify).join("");
  return escapeHtml(String(value));
}
