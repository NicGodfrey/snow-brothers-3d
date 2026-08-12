import { DomainError, type Result } from "@enterprise-suite/shared-kernel";

/**
 * Unwraps a domain Result at the application boundary, converting rule
 * violations into DomainError so the HTTP layer can map them to 4xx responses.
 */
export function expectOk<T>(result: Result<T, string>, code = "VALIDATION"): T {
  if (!result.ok) {
    throw new DomainError(result.error, code, 422);
  }
  return result.value;
}
