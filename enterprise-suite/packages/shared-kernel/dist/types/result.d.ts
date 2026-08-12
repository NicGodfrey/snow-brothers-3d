export type Ok<T> = {
    readonly ok: true;
    readonly value: T;
};
export type Err<E> = {
    readonly ok: false;
    readonly error: E;
};
export type Result<T, E = string> = Ok<T> | Err<E>;
export declare const ok: <T>(value: T) => Ok<T>;
export declare const err: <E>(error: E) => Err<E>;
export declare function mapResult<T, U, E>(r: Result<T, E>, fn: (v: T) => U): Result<U, E>;
export declare function unwrapOr<T, E>(r: Result<T, E>, fallback: T): T;
//# sourceMappingURL=result.d.ts.map