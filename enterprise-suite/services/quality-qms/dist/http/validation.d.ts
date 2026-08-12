/**
 * Tiny request-body validation helpers. Every failure throws a
 * DomainError with code VALIDATION and the offending field name, which the
 * router maps to HTTP 400.
 */
import { type IsoDateTime, type Ulid } from "@enterprise-suite/shared-kernel";
export declare function asObject(body: unknown, name?: string): Record<string, unknown>;
export declare function requireString(obj: Record<string, unknown>, key: string): string;
export declare function optionalString(obj: Record<string, unknown>, key: string): string | undefined;
export declare function requireNumber(obj: Record<string, unknown>, key: string): number;
export declare function optionalNumber(obj: Record<string, unknown>, key: string): number | undefined;
export declare function optionalBoolean(obj: Record<string, unknown>, key: string): boolean | undefined;
export declare function requireBoolean(obj: Record<string, unknown>, key: string): boolean;
export declare function requireEnum<T extends string>(obj: Record<string, unknown>, key: string, values: readonly T[]): T;
export declare function optionalEnum<T extends string>(obj: Record<string, unknown>, key: string, values: readonly T[]): T | undefined;
export declare function requireNumberArray(obj: Record<string, unknown>, key: string): number[];
export declare function optionalObjectArray(obj: Record<string, unknown>, key: string): Record<string, unknown>[] | undefined;
export declare function requireObjectArray(obj: Record<string, unknown>, key: string): Record<string, unknown>[];
export declare function requireIsoDate(obj: Record<string, unknown>, key: string): IsoDateTime;
export declare function optionalUlid(obj: Record<string, unknown>, key: string): Ulid | undefined;
export declare function requireUlid(obj: Record<string, unknown>, key: string): Ulid;
export declare function ulidParam(params: Record<string, string>, key: string): Ulid;
//# sourceMappingURL=validation.d.ts.map