export declare class DomainError extends Error {
    readonly code: string;
    readonly status: number;
    readonly details?: unknown | undefined;
    constructor(message: string, code: string, status?: number, details?: unknown | undefined);
}
export declare class NotFoundError extends DomainError {
    constructor(resource: string, id: string);
}
export declare class ConflictError extends DomainError {
    constructor(message: string);
}
export declare class ForbiddenError extends DomainError {
    constructor(message?: string);
}
//# sourceMappingURL=errors.d.ts.map