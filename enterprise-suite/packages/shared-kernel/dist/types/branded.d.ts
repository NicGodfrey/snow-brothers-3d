export type Brand<T, B extends string> = T & {
    readonly __brand: B;
};
export type Ulid = Brand<string, "Ulid">;
export type IsoDateTime = Brand<string, "IsoDateTime">;
export type Email = Brand<string, "Email">;
export type Sku = Brand<string, "Sku">;
export declare function brand<T, B extends string>(value: T): Brand<T, B>;
export declare function nowIso(): IsoDateTime;
export declare function newId(prefix?: string): Ulid;
//# sourceMappingURL=branded.d.ts.map