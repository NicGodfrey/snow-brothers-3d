import {
  newId,
  nowIso,
  type IsoDateTime,
  type TenantId,
  type Ulid,
  type UserId,
} from "@enterprise-suite/shared-kernel";
import type { ContractType } from "./contract.js";
import { isAfter, parseIso } from "./dates.js";
import { EntitlementDeniedError, ValidationError } from "./errors.js";
import type { PartnerStatus } from "./partner.js";
import type { PortalRole, PortalUserStatus } from "./portal-user.js";

/**
 * Portal entitlements: the data model behind "what can this partner person
 * actually do in the portal".
 *
 * An entitlement is a named capability (`deal_registration`,
 * `price_list_download`, `nfr_licenses`, ...) with a *policy* — the facts a
 * subject must satisfy — plus an override layer of explicit grants. Resolution
 * is a pure function of facts so the same code answers a portal navigation
 * query, an API authorisation check and a "why can't I see this?" support
 * question, and always with reasons attached.
 *
 * Precedence, strongest first:
 *   1. an applicable, unexpired `deny` grant
 *   2. an applicable, unexpired `allow` grant (overrides an unmet policy)
 *   3. the entitlement's own policy
 */

export type EntitlementCategory =
  | "sales"
  | "marketing"
  | "support"
  | "training"
  | "finance"
  | "product";

export const ENTITLEMENT_CATEGORIES: readonly EntitlementCategory[] = [
  "sales",
  "marketing",
  "support",
  "training",
  "finance",
  "product",
];

export interface EntitlementPolicy {
  /** Minimum tier rank; 0 or absent means any tier (including untiered). */
  readonly minTierRank?: number;
  /** The user needs at least one of these roles. */
  readonly anyOfRoles?: readonly PortalRole[];
  /** Certifications the *individual* must hold. */
  readonly requiredUserCertifications?: readonly string[];
  /** Certifications the *partner org* must hold somewhere. */
  readonly requiredPartnerCertifications?: readonly string[];
  /** At least one active contract of these types. */
  readonly requiresAnyContractType?: readonly ContractType[];
  /** Defaults to `["active"]` — trading state is the baseline for the portal. */
  readonly allowedPartnerStatuses?: readonly PartnerStatus[];
}

export interface EntitlementDefinition {
  readonly id: Ulid;
  readonly tenantId: TenantId;
  readonly code: string;
  readonly name: string;
  readonly description?: string;
  readonly category: EntitlementCategory;
  readonly policy: EntitlementPolicy;
  readonly active: boolean;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

export interface CreateEntitlementDefinitionInput {
  readonly code: string;
  readonly name: string;
  readonly description?: string;
  readonly category: EntitlementCategory;
  readonly policy?: EntitlementPolicy;
}

const ENTITLEMENT_CODE = /^[a-z][a-z0-9_]{2,40}$/;

export function createEntitlementDefinition(
  tenantId: TenantId,
  input: CreateEntitlementDefinitionInput,
): EntitlementDefinition {
  const code = input.code.trim().toLowerCase();
  if (!ENTITLEMENT_CODE.test(code)) {
    throw ValidationError.single("code", "must be a lowercase snake_case code of 3-41 characters");
  }
  if (input.name.trim().length === 0) throw ValidationError.single("name", "is required");
  if (!ENTITLEMENT_CATEGORIES.includes(input.category)) {
    throw ValidationError.single("category", `must be one of [${ENTITLEMENT_CATEGORIES.join(", ")}]`);
  }
  const policy = input.policy ?? {};
  if (policy.minTierRank !== undefined && (!Number.isInteger(policy.minTierRank) || policy.minTierRank < 0)) {
    throw ValidationError.single("policy.minTierRank", "must be a non-negative integer");
  }
  const now = nowIso();
  return {
    id: newId("entdef"),
    tenantId,
    code,
    name: input.name.trim(),
    description: input.description?.trim() || undefined,
    category: input.category,
    policy,
    active: true,
    createdAt: now,
    updatedAt: now,
  };
}

export type GrantSubject = "partner" | "user";
export type GrantEffect = "allow" | "deny";

export interface EntitlementGrant {
  readonly id: Ulid;
  readonly tenantId: TenantId;
  readonly entitlementCode: string;
  readonly subject: GrantSubject;
  readonly subjectId: Ulid;
  readonly effect: GrantEffect;
  readonly reason: string;
  readonly grantedBy: UserId;
  readonly grantedAt: IsoDateTime;
  readonly expiresAt?: IsoDateTime;
  readonly revokedAt?: IsoDateTime;
}

export interface CreateEntitlementGrantInput {
  readonly entitlementCode: string;
  readonly subject: GrantSubject;
  readonly subjectId: Ulid;
  readonly effect: GrantEffect;
  readonly reason: string;
  readonly grantedBy: UserId;
  readonly at: IsoDateTime;
  readonly expiresAt?: IsoDateTime;
}

export function createEntitlementGrant(
  tenantId: TenantId,
  input: CreateEntitlementGrantInput,
): EntitlementGrant {
  if (input.subject !== "partner" && input.subject !== "user") {
    throw ValidationError.single("subject", 'must be "partner" or "user"');
  }
  if (input.effect !== "allow" && input.effect !== "deny") {
    throw ValidationError.single("effect", 'must be "allow" or "deny"');
  }
  if (input.reason.trim().length === 0) {
    throw ValidationError.single("reason", "an override always needs a reason");
  }
  const grantedAt = parseIso(input.at, "at");
  const expiresAt = input.expiresAt ? parseIso(input.expiresAt, "expiresAt") : undefined;
  if (expiresAt && !isAfter(expiresAt, grantedAt)) {
    throw ValidationError.single("expiresAt", "must be after the grant time");
  }
  return {
    id: newId("grant"),
    tenantId,
    entitlementCode: input.entitlementCode.trim().toLowerCase(),
    subject: input.subject,
    subjectId: input.subjectId,
    effect: input.effect,
    reason: input.reason.trim(),
    grantedBy: input.grantedBy,
    grantedAt,
    expiresAt,
  };
}

/** Everything resolution needs to know about the subject, gathered by the service. */
export interface EntitlementFacts {
  readonly partnerId: Ulid;
  readonly portalUserId?: Ulid;
  readonly partnerStatus: PartnerStatus;
  readonly tierCode?: string;
  readonly tierRank: number;
  readonly roles: readonly PortalRole[];
  readonly userStatus?: PortalUserStatus;
  readonly userCertificationCodes: readonly string[];
  readonly partnerCertificationCodes: readonly string[];
  readonly activeContractTypes: readonly ContractType[];
  readonly at: IsoDateTime;
}

export type DecisionSource = "policy" | "explicit_allow" | "explicit_deny" | "inactive_definition";

export interface EntitlementDecision {
  readonly code: string;
  readonly name: string;
  readonly category: EntitlementCategory;
  readonly granted: boolean;
  readonly source: DecisionSource;
  /** Human-readable unmet requirements (empty when granted by policy). */
  readonly reasons: readonly string[];
  readonly grantId?: Ulid;
  readonly expiresAt?: IsoDateTime;
}

function grantApplies(grant: EntitlementGrant, facts: EntitlementFacts, code: string): boolean {
  if (grant.entitlementCode !== code) return false;
  if (grant.revokedAt) return false;
  if (grant.expiresAt && !isAfter(grant.expiresAt, facts.at)) return false;
  if (grant.subject === "partner") return grant.subjectId === facts.partnerId;
  return facts.portalUserId !== undefined && grant.subjectId === facts.portalUserId;
}

/** Pure policy check; returns the list of unmet requirements. */
export function evaluatePolicy(policy: EntitlementPolicy, facts: EntitlementFacts): string[] {
  const reasons: string[] = [];
  const allowedStatuses = policy.allowedPartnerStatuses ?? (["active"] as const);
  if (!allowedStatuses.includes(facts.partnerStatus)) {
    reasons.push(`partner is ${facts.partnerStatus}; requires ${allowedStatuses.join(" or ")}`);
  }
  if (facts.portalUserId !== undefined && facts.userStatus !== undefined && facts.userStatus !== "active") {
    reasons.push(`portal user is ${facts.userStatus}`);
  }
  if (policy.minTierRank !== undefined && facts.tierRank < policy.minTierRank) {
    reasons.push(
      `tier rank ${facts.tierRank}${facts.tierCode ? ` (${facts.tierCode})` : ""} is below the required ${policy.minTierRank}`,
    );
  }
  if (policy.anyOfRoles && policy.anyOfRoles.length > 0) {
    if (!policy.anyOfRoles.some((role) => facts.roles.includes(role))) {
      reasons.push(`requires one of the roles [${policy.anyOfRoles.join(", ")}]`);
    }
  }
  const userCerts = new Set(facts.userCertificationCodes.map((c) => c.toLowerCase()));
  for (const code of policy.requiredUserCertifications ?? []) {
    if (!userCerts.has(code.toLowerCase())) reasons.push(`user is missing certification "${code}"`);
  }
  const partnerCerts = new Set(facts.partnerCertificationCodes.map((c) => c.toLowerCase()));
  for (const code of policy.requiredPartnerCertifications ?? []) {
    if (!partnerCerts.has(code.toLowerCase())) reasons.push(`partner is missing certification "${code}"`);
  }
  if (policy.requiresAnyContractType && policy.requiresAnyContractType.length > 0) {
    if (!policy.requiresAnyContractType.some((type) => facts.activeContractTypes.includes(type))) {
      reasons.push(`requires an active ${policy.requiresAnyContractType.join(" or ")} contract`);
    }
  }
  return reasons;
}

export function resolveEntitlements(
  definitions: readonly EntitlementDefinition[],
  grants: readonly EntitlementGrant[],
  facts: EntitlementFacts,
): EntitlementDecision[] {
  return [...definitions]
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((definition) => {
      const applicable = grants.filter((g) => grantApplies(g, facts, definition.code));
      const deny = applicable.find((g) => g.effect === "deny");
      if (deny) {
        return {
          code: definition.code,
          name: definition.name,
          category: definition.category,
          granted: false,
          source: "explicit_deny" as const,
          reasons: [`explicitly denied: ${deny.reason}`],
          grantId: deny.id,
          expiresAt: deny.expiresAt,
        };
      }
      if (!definition.active) {
        return {
          code: definition.code,
          name: definition.name,
          category: definition.category,
          granted: false,
          source: "inactive_definition" as const,
          reasons: ["entitlement is not active in this program"],
        };
      }
      const allow = applicable.find((g) => g.effect === "allow");
      if (allow) {
        return {
          code: definition.code,
          name: definition.name,
          category: definition.category,
          granted: true,
          source: "explicit_allow" as const,
          reasons: [],
          grantId: allow.id,
          expiresAt: allow.expiresAt,
        };
      }
      const reasons = evaluatePolicy(definition.policy, facts);
      return {
        code: definition.code,
        name: definition.name,
        category: definition.category,
        granted: reasons.length === 0,
        source: "policy" as const,
        reasons,
      };
    });
}

export function decisionFor(
  definitions: readonly EntitlementDefinition[],
  grants: readonly EntitlementGrant[],
  facts: EntitlementFacts,
  code: string,
): EntitlementDecision | undefined {
  const wanted = code.trim().toLowerCase();
  return resolveEntitlements(
    definitions.filter((d) => d.code === wanted),
    grants,
    facts,
  )[0];
}

/** Authorisation helper: throws with the unmet reasons attached. */
export function assertEntitled(
  definitions: readonly EntitlementDefinition[],
  grants: readonly EntitlementGrant[],
  facts: EntitlementFacts,
  code: string,
): EntitlementDecision {
  const decision = decisionFor(definitions, grants, facts, code);
  if (!decision) {
    throw new EntitlementDeniedError(code, ["no such entitlement is defined for this tenant"]);
  }
  if (!decision.granted) throw new EntitlementDeniedError(code, decision.reasons);
  return decision;
}

/** Reference entitlement catalog wired to the standard tier ranks. */
export const STANDARD_ENTITLEMENTS: readonly CreateEntitlementDefinitionInput[] = [
  {
    code: "training_library",
    name: "Training library",
    category: "training",
    description: "Self-paced enablement content for every registered partner.",
    policy: { allowedPartnerStatuses: ["active", "approved"] },
  },
  {
    code: "price_list_download",
    name: "Price list download",
    category: "sales",
    policy: { minTierRank: 10, requiresAnyContractType: ["reseller", "distribution", "msp"] },
  },
  {
    code: "deal_registration",
    name: "Deal registration",
    category: "sales",
    description: "Register and protect an opportunity in channel-prm.",
    policy: {
      minTierRank: 10,
      anyOfRoles: ["portal_admin", "sales_rep"],
      requiresAnyContractType: ["reseller", "distribution", "msp", "referral"],
    },
  },
  {
    code: "mdf_requests",
    name: "MDF fund requests",
    category: "marketing",
    policy: {
      minTierRank: 20,
      anyOfRoles: ["portal_admin", "marketing_manager"],
      requiresAnyContractType: ["reseller", "distribution", "msp"],
    },
  },
  {
    code: "co_brandable_assets",
    name: "Co-brandable marketing assets",
    category: "marketing",
    policy: { minTierRank: 20, anyOfRoles: ["portal_admin", "marketing_manager"] },
  },
  {
    code: "lead_distribution",
    name: "Inbound lead sharing",
    category: "sales",
    policy: { minTierRank: 30, anyOfRoles: ["portal_admin", "sales_rep"], requiredPartnerCertifications: ["sales-pro"] },
  },
  {
    code: "nfr_licenses",
    name: "Not-for-resale licenses",
    category: "product",
    policy: { minTierRank: 20, requiredPartnerCertifications: ["tech-pro"] },
  },
  {
    code: "support_l2_escalation",
    name: "Level-2 support escalation",
    category: "support",
    policy: {
      minTierRank: 30,
      anyOfRoles: ["portal_admin", "technical_lead", "support_agent"],
      requiredUserCertifications: ["tech-pro"],
    },
  },
  {
    code: "rebate_statements",
    name: "Rebate statements",
    category: "finance",
    policy: { minTierRank: 20, anyOfRoles: ["portal_admin", "finance"] },
  },
  {
    code: "solution_listing",
    name: "Solution directory listing",
    category: "marketing",
    policy: { minTierRank: 30, requiredPartnerCertifications: ["tech-pro"] },
  },
];
