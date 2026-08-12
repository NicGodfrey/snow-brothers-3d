export type Brand<T, B extends string> = T & { readonly __brand: B };

export type Ulid = Brand<string, "Ulid">;
export type IsoDateTime = Brand<string, "IsoDateTime">;
export type Email = Brand<string, "Email">;
export type Sku = Brand<string, "Sku">;

export function brand<T, B extends string>(value: T): Brand<T, B> {
  return value as Brand<T, B>;
}

export function nowIso(): IsoDateTime {
  return brand<string, "IsoDateTime">(new Date().toISOString());
}

export function newId(prefix = "id"): Ulid {
  const rand = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36);
  return brand<string, "Ulid">(`${prefix}_${time}${rand}`);
}
