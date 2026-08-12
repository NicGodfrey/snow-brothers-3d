import { ValidationError, err, ok, type FieldError, type Result } from "../../kernel/index.js";

/**
 * Minimal parser-combinator validation. Each parser inspects an unknown value
 * and either produces a typed value or a list of field errors with paths.
 */
export type Parser<T> = (value: unknown, path: string) => Result<T, FieldError[]>;

export type Infer<P> = P extends Parser<infer T> ? T : never;

function fail(path: string, message: string): Result<never, FieldError[]> {
  return err([{ path, message }]);
}

export function parse<T>(parser: Parser<T>, input: unknown): T {
  const result = parser(input, "$");
  if (!result.ok) throw new ValidationError(result.error);
  return result.value;
}

export function vString(opts: { min?: number; max?: number; pattern?: RegExp } = {}): Parser<string> {
  return (value, path) => {
    if (typeof value !== "string") return fail(path, "must be a string");
    const trimmed = value.trim();
    if (opts.min !== undefined && trimmed.length < opts.min) {
      return fail(path, `must be at least ${opts.min} characters`);
    }
    if (opts.max !== undefined && trimmed.length > opts.max) {
      return fail(path, `must be at most ${opts.max} characters`);
    }
    if (opts.pattern && !opts.pattern.test(trimmed)) {
      return fail(path, `must match ${opts.pattern.source}`);
    }
    return ok(trimmed);
  };
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function vEmail(): Parser<string> {
  return (value, path) => {
    if (typeof value !== "string" || !EMAIL_PATTERN.test(value.trim())) {
      return fail(path, "must be a valid email address");
    }
    return ok(value.trim().toLowerCase());
  };
}

export function vInt(opts: { min?: number; max?: number } = {}): Parser<number> {
  return (value, path) => {
    if (typeof value !== "number" || !Number.isInteger(value)) {
      return fail(path, "must be an integer");
    }
    if (opts.min !== undefined && value < opts.min) return fail(path, `must be >= ${opts.min}`);
    if (opts.max !== undefined && value > opts.max) return fail(path, `must be <= ${opts.max}`);
    return ok(value);
  };
}

export function vNumber(opts: { min?: number; max?: number } = {}): Parser<number> {
  return (value, path) => {
    if (typeof value !== "number" || Number.isNaN(value)) return fail(path, "must be a number");
    if (opts.min !== undefined && value < opts.min) return fail(path, `must be >= ${opts.min}`);
    if (opts.max !== undefined && value > opts.max) return fail(path, `must be <= ${opts.max}`);
    return ok(value);
  };
}

export function vBoolean(): Parser<boolean> {
  return (value, path) => (typeof value === "boolean" ? ok(value) : fail(path, "must be a boolean"));
}

export function vEnum<const T extends readonly string[]>(values: T): Parser<T[number]> {
  return (value, path) => {
    if (typeof value !== "string" || !values.includes(value)) {
      return fail(path, `must be one of: ${values.join(", ")}`);
    }
    return ok(value as T[number]);
  };
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function vIsoDate(): Parser<string> {
  return (value, path) => {
    if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) {
      return fail(path, "must be an ISO date (YYYY-MM-DD)");
    }
    const parsed = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return fail(path, "must be a real calendar date");
    return ok(value);
  };
}

const CURRENCY_PATTERN = /^[A-Za-z]{3}$/;

export function vCurrency(): Parser<string> {
  return (value, path) => {
    if (typeof value !== "string" || !CURRENCY_PATTERN.test(value.trim())) {
      return fail(path, "must be a 3-letter ISO currency code");
    }
    return ok(value.trim().toUpperCase());
  };
}

export function vArray<T>(item: Parser<T>, opts: { min?: number; max?: number } = {}): Parser<T[]> {
  return (value, path) => {
    if (!Array.isArray(value)) return fail(path, "must be an array");
    if (opts.min !== undefined && value.length < opts.min) {
      return fail(path, `must have at least ${opts.min} items`);
    }
    if (opts.max !== undefined && value.length > opts.max) {
      return fail(path, `must have at most ${opts.max} items`);
    }
    const items: T[] = [];
    const errors: FieldError[] = [];
    value.forEach((entry, i) => {
      const result = item(entry, `${path}[${i}]`);
      if (result.ok) items.push(result.value);
      else errors.push(...result.error);
    });
    return errors.length > 0 ? err(errors) : ok(items);
  };
}

export function vOptional<T>(parser: Parser<T>): Parser<T | undefined> {
  return (value, path) => {
    if (value === undefined || value === null) return ok(undefined);
    return parser(value, path);
  };
}

export function vDefault<T>(parser: Parser<T>, fallback: T): Parser<T> {
  return (value, path) => {
    if (value === undefined || value === null) return ok(fallback);
    return parser(value, path);
  };
}

export function vNullable<T>(parser: Parser<T>): Parser<T | null> {
  return (value, path) => {
    if (value === null) return ok(null);
    return parser(value, path);
  };
}

type ShapeOutput<S extends Record<string, Parser<unknown>>> = { [K in keyof S]: Infer<S[K]> };

export function vObject<S extends Record<string, Parser<unknown>>>(shape: S): Parser<ShapeOutput<S>> {
  return (value, path) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return fail(path, "must be an object");
    }
    const record = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    const errors: FieldError[] = [];
    for (const key of Object.keys(shape)) {
      const result = shape[key](record[key], `${path}.${key}`);
      if (result.ok) {
        if (result.value !== undefined) output[key] = result.value;
      } else {
        errors.push(...result.error);
      }
    }
    return errors.length > 0 ? err(errors) : ok(output as ShapeOutput<S>);
  };
}
