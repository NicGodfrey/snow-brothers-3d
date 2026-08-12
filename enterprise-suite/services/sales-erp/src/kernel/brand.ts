/**
 * Local copy of shared-kernel branded types so the package builds in isolation.
 * Shape-compatible with @enterprise-suite/shared-kernel.
 */
export type Brand<T, B extends string> = T & { readonly __brand: B };

export type Ulid = Brand<string, "Ulid">;
export type IsoDateTime = Brand<string, "IsoDateTime">;
export type IsoDate = Brand<string, "IsoDate">;
export type Email = Brand<string, "Email">;
export type Sku = Brand<string, "Sku">;

export function brand<T, B extends string>(value: T): Brand<T, B> {
  return value as Brand<T, B>;
}

export function nowIso(): IsoDateTime {
  return brand<string, "IsoDateTime">(new Date().toISOString());
}

export function isoDateTime(value: string): IsoDateTime {
  return brand<string, "IsoDateTime">(value);
}

export function isoDate(value: string): IsoDate {
  return brand<string, "IsoDate">(value);
}

export function sku(value: string): Sku {
  return brand<string, "Sku">(value.trim().toUpperCase());
}

export function email(value: string): Email {
  return brand<string, "Email">(value.trim().toLowerCase());
}

export function newId(prefix = "id"): Ulid {
  const rand = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36);
  return brand<string, "Ulid">(`${prefix}_${time}${rand}`);
}
