import { brand, newId, type Brand, type Ulid } from "@enterprise-suite/shared-kernel";

/**
 * Aggregate ids in this context are plain prefixed ULID-like strings (see shared-kernel
 * `newId`). The prefix is part of the value, which makes ids self-describing in audit
 * records and log lines where the aggregate type is otherwise lost.
 */
export const ID_PREFIX = {
  tenant: "ten",
  user: "usr",
  group: "grp",
  role: "rol",
  binding: "rbd",
  apiKey: "akey",
  session: "sess",
  audit: "aud",
  invite: "inv",
} as const;

export type IdPrefix = (typeof ID_PREFIX)[keyof typeof ID_PREFIX];

export function newTenantAggregateId(): Ulid {
  return newId(ID_PREFIX.tenant);
}

export function newUserId(): Ulid {
  return newId(ID_PREFIX.user);
}

export function newGroupId(): Ulid {
  return newId(ID_PREFIX.group);
}

export function newRoleId(): Ulid {
  return newId(ID_PREFIX.role);
}

export function newBindingId(): Ulid {
  return newId(ID_PREFIX.binding);
}

export function newApiKeyId(): Ulid {
  return newId(ID_PREFIX.apiKey);
}

export function newSessionId(): Ulid {
  return newId(ID_PREFIX.session);
}

export function newAuditId(): Ulid {
  return newId(ID_PREFIX.audit);
}

export function asUlid(value: string): Ulid {
  return brand<string, "Ulid">(value);
}

export type Slug = Brand<string, "Slug">;

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;

export function slug(value: string): Slug {
  const normalized = value.trim().toLowerCase();
  if (!SLUG_PATTERN.test(normalized)) {
    throw new Error(
      `Invalid slug "${value}": expected 2-63 lowercase alphanumeric characters or hyphens`,
    );
  }
  return brand<string, "Slug">(normalized);
}

export function isSlug(value: string): boolean {
  return SLUG_PATTERN.test(value);
}
