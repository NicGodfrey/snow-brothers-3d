export class DomainError extends Error {
    code;
    status;
    details;
    constructor(message, code, status = 400, details) {
        super(message);
        this.code = code;
        this.status = status;
        this.details = details;
        this.name = "DomainError";
    }
}
export class NotFoundError extends DomainError {
    constructor(resource, id) {
        super(`${resource} not found: ${id}`, "NOT_FOUND", 404);
        this.name = "NotFoundError";
    }
}
export class ConflictError extends DomainError {
    constructor(message) {
        super(message, "CONFLICT", 409);
        this.name = "ConflictError";
    }
}
export class ForbiddenError extends DomainError {
    constructor(message = "Forbidden") {
        super(message, "FORBIDDEN", 403);
        this.name = "ForbiddenError";
    }
}
//# sourceMappingURL=errors.js.map