/**
 * Domain event catalogue.
 *
 * Every type is `admin.<aggregate>.<past-tense>` so webhook subscribers can
 * filter with a prefix wildcard (`admin.tenant.*`). The list doubles as the
 * validation set for webhook subscriptions: subscribing to a typo is a 400,
 * not a subscription that silently never fires.
 */

export const AdminEventTypes = {
  tenantProvisioned: "admin.tenant.provisioned",
  tenantActivated: "admin.tenant.activated",
  tenantSuspended: "admin.tenant.suspended",
  tenantResumed: "admin.tenant.resumed",
  tenantArchived: "admin.tenant.archived",
  tenantPlanChanged: "admin.tenant.plan-changed",
  tenantSettingsUpdated: "admin.tenant.settings-updated",

  userInvited: "admin.user.invited",
  userActivated: "admin.user.activated",
  userSuspended: "admin.user.suspended",
  userReinstated: "admin.user.reinstated",
  userDeactivated: "admin.user.deactivated",
  userRolesChanged: "admin.user.roles-changed",
  userProfileUpdated: "admin.user.profile-updated",

  roleCreated: "admin.role.created",
  roleUpdated: "admin.role.updated",
  roleDeleted: "admin.role.deleted",

  referenceSetCreated: "admin.reference-data.set-created",
  referenceSetPublished: "admin.reference-data.set-published",
  referenceEntryAdded: "admin.reference-data.entry-added",
  referenceEntryUpdated: "admin.reference-data.entry-updated",
  referenceEntryRetired: "admin.reference-data.entry-retired",

  webhookRegistered: "admin.webhook.registered",
  webhookUpdated: "admin.webhook.updated",
  webhookPaused: "admin.webhook.paused",
  webhookResumed: "admin.webhook.resumed",
  webhookSecretRotated: "admin.webhook.secret-rotated",
  webhookDeliveryFailed: "admin.webhook.delivery-failed",
  webhookDisabled: "admin.webhook.disabled",

  featureFlagCreated: "admin.feature-flag.created",
  featureFlagUpdated: "admin.feature-flag.updated",
  featureFlagToggled: "admin.feature-flag.toggled",
  featureFlagRuleChanged: "admin.feature-flag.rule-changed",
  featureFlagArchived: "admin.feature-flag.archived",
} as const;

export type AdminEventType = (typeof AdminEventTypes)[keyof typeof AdminEventTypes];

export const ALL_EVENT_TYPES: readonly AdminEventType[] = Object.values(AdminEventTypes);

/** Event type prefixes usable in a webhook filter, e.g. `admin.tenant.*`. */
export const EVENT_NAMESPACES: readonly string[] = [
  ...new Set(ALL_EVENT_TYPES.map((type) => type.split(".").slice(0, 2).join("."))),
];

/** Matches `admin.tenant.activated` against `*`, `admin.tenant.*` or an exact type. */
export function eventMatches(pattern: string, eventType: string): boolean {
  if (pattern === "*" || pattern === eventType) return true;
  if (!pattern.endsWith(".*")) return false;
  return eventType.startsWith(pattern.slice(0, -1));
}

export function isKnownEventType(value: string): value is AdminEventType {
  return (ALL_EVENT_TYPES as readonly string[]).includes(value);
}

/** True when a subscription filter is well formed (exact type or namespace). */
export function isValidEventFilter(pattern: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith(".*")) return EVENT_NAMESPACES.includes(pattern.slice(0, -2));
  return isKnownEventType(pattern);
}
