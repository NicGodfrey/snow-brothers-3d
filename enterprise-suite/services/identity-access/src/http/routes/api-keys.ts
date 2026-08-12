import type { Ulid } from "@enterprise-suite/shared-kernel";
import type { IdentityModule } from "../../infrastructure/container.js";
import { optionalNumber, optionalStringArray, requireString } from "../json.js";
import { created, ok, type Router } from "../router.js";

export function registerApiKeyRoutes(router: Router, module: IdentityModule): void {
  router.get(
    "/identity/api-keys",
    ({ principal, query }) =>
      ok(
        module.apiKeys
          .list(principal.tenantId, { activeOnly: query.get("activeOnly") === "true" })
          .map((key) => key.toPublicJSON()),
      ),
    { permission: "identity.api_key:read" },
  );

  /**
   * The plaintext token is in this response and nowhere else — storage only ever holds
   * the digest, so a lost token must be rotated rather than recovered.
   */
  router.post(
    "/identity/api-keys",
    ({ principal, body }) => {
      const issued = module.apiKeys.issue(principal.tenantId, {
        name: requireString(body, "name"),
        restrictions: optionalStringArray(body, "restrictions"),
        expiresInDays: optionalNumber(body, "expiresInDays"),
        createdBy: principal.subject.id,
        ipAllowlist: optionalStringArray(body, "ipAllowlist"),
        roleCodes: optionalStringArray(body, "roleCodes"),
        scope: (body as Record<string, unknown>)?.scope as string | undefined,
      });
      return created({ apiKey: issued.apiKey.toPublicJSON(), token: issued.token });
    },
    { permission: "identity.api_key:issue" },
  );

  router.get(
    "/identity/api-keys/:apiKeyId",
    ({ principal, params }) =>
      ok(module.apiKeys.get(principal.tenantId, params.apiKeyId as Ulid).toPublicJSON()),
    { permission: "identity.api_key:read" },
  );

  router.post(
    "/identity/api-keys/:apiKeyId/rotate",
    ({ principal, params }) => {
      const rotated = module.apiKeys.rotate(
        principal.tenantId,
        params.apiKeyId as Ulid,
        principal.subject.id,
      );
      return ok({ apiKey: rotated.apiKey.toPublicJSON(), token: rotated.token });
    },
    { permission: "identity.api_key:rotate" },
  );

  router.put(
    "/identity/api-keys/:apiKeyId/restrictions",
    ({ principal, params, body }) =>
      ok(
        module.apiKeys
          .restrict(
            principal.tenantId,
            params.apiKeyId as Ulid,
            optionalStringArray(body, "restrictions") ?? [],
          )
          .toPublicJSON(),
      ),
    { permission: "identity.api_key:issue" },
  );

  router.delete(
    "/identity/api-keys/:apiKeyId",
    ({ principal, params, query }) =>
      ok(
        module.apiKeys
          .revoke(principal.tenantId, params.apiKeyId as Ulid, {
            by: principal.subject.id,
            reason: query.get("reason") ?? undefined,
          })
          .toPublicJSON(),
      ),
    { permission: "identity.api_key:revoke" },
  );
}
