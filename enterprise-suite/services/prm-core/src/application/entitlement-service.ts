import {
  ConflictError,
  NotFoundError,
  envelope,
  type IsoDateTime,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { summarizeCertifications } from "../domain/certification.js";
import type { ContractType } from "../domain/contract.js";
import {
  STANDARD_ENTITLEMENTS,
  assertEntitled,
  createEntitlementDefinition,
  createEntitlementGrant,
  resolveEntitlements,
  type CreateEntitlementDefinitionInput,
  type EntitlementDecision,
  type EntitlementDefinition,
  type EntitlementFacts,
  type EntitlementGrant,
  type GrantEffect,
  type GrantSubject,
} from "../domain/entitlement.js";
import { InvalidStateError } from "../domain/errors.js";
import { PrmEventTypes } from "../domain/events.js";
import type {
  CertificationRepository,
  Clock,
  ContractRepository,
  EntitlementDefinitionRepository,
  EntitlementGrantRepository,
  OutboxPort,
  PartnerRepository,
  PortalUserRepository,
} from "./ports.js";

export interface GrantEntitlementCommand {
  readonly entitlementCode: string;
  readonly subject: GrantSubject;
  readonly subjectId: Ulid;
  readonly effect: GrantEffect;
  readonly reason: string;
  readonly expiresAt?: IsoDateTime;
}

/**
 * Entitlement administration and resolution.
 *
 * Resolution is the interesting part: it gathers facts about the subject from
 * four aggregates (partner, portal user, contracts, certifications), then runs
 * the pure policy engine. Callers get decisions *with reasons*, so the portal
 * can render "Gold tier required" instead of hiding a tile with no
 * explanation.
 */
export class EntitlementService {
  constructor(
    private readonly definitions: EntitlementDefinitionRepository,
    private readonly grants: EntitlementGrantRepository,
    private readonly partners: PartnerRepository,
    private readonly portalUsers: PortalUserRepository,
    private readonly contracts: ContractRepository,
    private readonly certifications: CertificationRepository,
    private readonly outbox: OutboxPort,
    private readonly clock: Clock,
  ) {}

  async createDefinition(
    ctx: TenantContext,
    input: CreateEntitlementDefinitionInput,
  ): Promise<EntitlementDefinition> {
    const existing = await this.definitions.byCode(ctx.tenantId, input.code);
    if (existing) throw new ConflictError(`Entitlement "${existing.code}" already exists`);
    const definition = createEntitlementDefinition(ctx.tenantId, input);
    await this.definitions.save(definition);
    await this.outbox.publish([
      envelope({
        eventType: PrmEventTypes.EntitlementDefinitionCreated,
        aggregateType: "EntitlementDefinition",
        aggregateId: definition.id,
        tenantId: ctx.tenantId,
        payload: { code: definition.code, name: definition.name, category: definition.category },
      }),
    ]);
    return definition;
  }

  /** Installs the reference catalog; existing codes are left untouched. */
  async installStandardCatalog(ctx: TenantContext): Promise<readonly EntitlementDefinition[]> {
    const installed: EntitlementDefinition[] = [];
    for (const input of STANDARD_ENTITLEMENTS) {
      const existing = await this.definitions.byCode(ctx.tenantId, input.code);
      if (existing) {
        installed.push(existing);
        continue;
      }
      const definition = createEntitlementDefinition(ctx.tenantId, input);
      await this.definitions.save(definition);
      installed.push(definition);
    }
    return installed;
  }

  async listDefinitions(ctx: TenantContext): Promise<readonly EntitlementDefinition[]> {
    return [...(await this.definitions.all(ctx.tenantId))].sort((a, b) => a.code.localeCompare(b.code));
  }

  // --- overrides -------------------------------------------------------------

  async grant(ctx: TenantContext, command: GrantEntitlementCommand): Promise<EntitlementGrant> {
    const definition = await this.definitions.byCode(ctx.tenantId, command.entitlementCode);
    if (!definition) throw new NotFoundError("EntitlementDefinition", command.entitlementCode);
    if (command.subject === "partner") {
      const partner = await this.partners.byId(ctx.tenantId, command.subjectId);
      if (!partner) throw new NotFoundError("Partner", command.subjectId);
    } else {
      const user = await this.portalUsers.byId(ctx.tenantId, command.subjectId);
      if (!user) throw new NotFoundError("PortalUser", command.subjectId);
    }
    const existing = (
      command.subject === "partner"
        ? await this.grants.forPartner(ctx.tenantId, command.subjectId)
        : await this.grants.forUser(ctx.tenantId, command.subjectId)
    ).filter((g) => g.entitlementCode === definition.code && !g.revokedAt);
    if (existing.some((g) => g.effect === command.effect)) {
      throw new ConflictError(
        `An active ${command.effect} override for "${definition.code}" already exists on this subject`,
      );
    }
    const grant = createEntitlementGrant(ctx.tenantId, {
      ...command,
      entitlementCode: definition.code,
      grantedBy: ctx.userId,
      at: this.clock.now(),
    });
    await this.grants.save(grant);
    await this.outbox.publish([
      envelope({
        eventType: PrmEventTypes.EntitlementGranted,
        aggregateType: "EntitlementGrant",
        aggregateId: grant.id,
        tenantId: ctx.tenantId,
        payload: {
          grantId: grant.id,
          entitlementCode: grant.entitlementCode,
          subject: grant.subject,
          subjectId: grant.subjectId,
          effect: grant.effect,
          reason: grant.reason,
        },
      }),
    ]);
    return grant;
  }

  async revokeGrant(ctx: TenantContext, grantId: Ulid): Promise<EntitlementGrant> {
    const revoked = await this.grants.revoke(ctx.tenantId, grantId, this.clock.now());
    if (!revoked) throw new NotFoundError("EntitlementGrant", grantId);
    await this.outbox.publish([
      envelope({
        eventType: PrmEventTypes.EntitlementRevoked,
        aggregateType: "EntitlementGrant",
        aggregateId: revoked.id,
        tenantId: ctx.tenantId,
        payload: {
          grantId: revoked.id,
          entitlementCode: revoked.entitlementCode,
          subject: revoked.subject,
          subjectId: revoked.subjectId,
          effect: revoked.effect,
          reason: revoked.reason,
        },
      }),
    ]);
    return revoked;
  }

  async grantsForPartner(ctx: TenantContext, partnerId: Ulid): Promise<readonly EntitlementGrant[]> {
    return this.grants.forPartner(ctx.tenantId, partnerId);
  }

  async grantsForUser(ctx: TenantContext, portalUserId: Ulid): Promise<readonly EntitlementGrant[]> {
    return this.grants.forUser(ctx.tenantId, portalUserId);
  }

  // --- resolution ------------------------------------------------------------

  /** Facts for a specific portal person: roles and personal certifications included. */
  async factsForUser(ctx: TenantContext, portalUserId: Ulid): Promise<EntitlementFacts> {
    const user = await this.portalUsers.byId(ctx.tenantId, portalUserId);
    if (!user) throw new NotFoundError("PortalUser", portalUserId);
    const base = await this.factsForPartner(ctx, user.partnerId);
    const now = this.clock.now();
    const userCertifications = (await this.certifications.byUser(ctx.tenantId, user.id))
      .filter((c) => c.isActiveAt(now))
      .map((c) => c.certificationCode);
    return {
      ...base,
      portalUserId: user.id,
      roles: user.roles,
      userStatus: user.status,
      userCertificationCodes: [...new Set(userCertifications)].sort(),
    };
  }

  /** Partner-level facts: no roles, no personal certifications. */
  async factsForPartner(ctx: TenantContext, partnerId: Ulid): Promise<EntitlementFacts> {
    const partner = await this.partners.byId(ctx.tenantId, partnerId);
    if (!partner) throw new NotFoundError("Partner", partnerId);
    const now = this.clock.now();
    const contracts = await this.contracts.byPartner(ctx.tenantId, partner.id);
    const activeContractTypes: ContractType[] = [
      ...new Set(contracts.filter((c) => c.isEffectiveAt(now)).map((c) => c.type)),
    ];
    const summary = summarizeCertifications(
      partner.id,
      await this.certifications.byPartner(ctx.tenantId, partner.id),
      now,
    );
    return {
      partnerId: partner.id,
      partnerStatus: partner.status,
      tierCode: partner.tierCode,
      tierRank: partner.tierRank,
      roles: [],
      userCertificationCodes: [],
      partnerCertificationCodes: summary.activeCertificationCodes,
      activeContractTypes,
      at: now,
    };
  }

  async resolveForUser(ctx: TenantContext, portalUserId: Ulid): Promise<readonly EntitlementDecision[]> {
    const facts = await this.factsForUser(ctx, portalUserId);
    const definitions = await this.definitions.all(ctx.tenantId);
    const grants = [
      ...(await this.grants.forPartner(ctx.tenantId, facts.partnerId)),
      ...(await this.grants.forUser(ctx.tenantId, portalUserId)),
    ];
    return resolveEntitlements(definitions, grants, facts);
  }

  async resolveForPartner(ctx: TenantContext, partnerId: Ulid): Promise<readonly EntitlementDecision[]> {
    const facts = await this.factsForPartner(ctx, partnerId);
    const definitions = await this.definitions.all(ctx.tenantId);
    const grants = await this.grants.forPartner(ctx.tenantId, partnerId);
    return resolveEntitlements(definitions, grants, facts);
  }

  /** Authorisation check for a portal action; throws EntitlementDeniedError. */
  async check(ctx: TenantContext, portalUserId: Ulid, entitlementCode: string): Promise<EntitlementDecision> {
    const facts = await this.factsForUser(ctx, portalUserId);
    const definitions = await this.definitions.all(ctx.tenantId);
    const grants = [
      ...(await this.grants.forPartner(ctx.tenantId, facts.partnerId)),
      ...(await this.grants.forUser(ctx.tenantId, portalUserId)),
    ];
    return assertEntitled(definitions, grants, facts, entitlementCode);
  }

  /**
   * What the portal navigation needs: only the granted codes, plus the
   * blocked ones with their reasons for the "unlock this" panel.
   */
  async portalMenu(
    ctx: TenantContext,
    portalUserId: Ulid,
  ): Promise<{
    readonly granted: readonly string[];
    readonly blocked: readonly { readonly code: string; readonly reasons: readonly string[] }[];
  }> {
    const decisions = await this.resolveForUser(ctx, portalUserId);
    if (decisions.length === 0) {
      throw new InvalidStateError("No entitlement catalog is configured for this tenant");
    }
    return {
      granted: decisions.filter((d) => d.granted).map((d) => d.code),
      blocked: decisions
        .filter((d) => !d.granted)
        .map((d) => ({ code: d.code, reasons: d.reasons })),
    };
  }
}
