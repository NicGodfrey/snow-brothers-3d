import { DomainError } from "@enterprise-suite/shared-kernel";
/**
 * Unwraps a domain Result at the application boundary, converting rule
 * violations into DomainError so the HTTP layer can map them to 4xx responses.
 */
export function expectOk(result, code = "VALIDATION") {
    if (!result.ok) {
        throw new DomainError(result.error, code, 422);
    }
    return result.value;
}
//# sourceMappingURL=service-support.js.map