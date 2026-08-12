/**
 * Small body-validation helpers for HTTP handlers. They throw 400s with
 * field-level messages before anything reaches the domain layer.
 */
export declare function asRecord(body: unknown, what?: string): Record<string, unknown>;
export declare function requireString(obj: Record<string, unknown>, field: string): string;
export declare function optionalString(obj: Record<string, unknown>, field: string): string | undefined;
export declare function requireNumber(obj: Record<string, unknown>, field: string): number;
export declare function optionalNumber(obj: Record<string, unknown>, field: string): number | undefined;
export declare function optionalBoolean(obj: Record<string, unknown>, field: string): boolean | undefined;
export declare function requireArray(obj: Record<string, unknown>, field: string): unknown[];
export declare function optionalArray(obj: Record<string, unknown>, field: string): unknown[] | undefined;
export declare function requireOneOf<T extends string>(obj: Record<string, unknown>, field: string, allowed: readonly T[]): T;
export declare function optionalOneOf<T extends string>(obj: Record<string, unknown>, field: string, allowed: readonly T[]): T | undefined;
//# sourceMappingURL=validate.d.ts.map