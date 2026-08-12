import { type Result } from "@enterprise-suite/shared-kernel";
/**
 * Unwraps a domain Result at the application boundary, converting rule
 * violations into DomainError so the HTTP layer can map them to 4xx responses.
 */
export declare function expectOk<T>(result: Result<T, string>, code?: string): T;
//# sourceMappingURL=service-support.d.ts.map