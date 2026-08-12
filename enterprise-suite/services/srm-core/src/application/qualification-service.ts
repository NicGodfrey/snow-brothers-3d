import {
  NotFoundError,
  normalizePage,
  type Page,
  type PageRequest,
  type TenantContext,
  type Ulid,
  type UserId,
} from "@enterprise-suite/shared-kernel";
import { resolveCategoryPolicy, type CategoryRecord } from "../domain/category.js";
import {
  Certification,
  DEFAULT_EXPIRY_WARNING_DAYS,
  DIVERSITY_CERTIFICATION,
  type CertificationType,
  type RecordCertificationInput,
} from "../domain/certification.js";
import { addMonths, daysBetween, type DateOnly } from "../domain/dates.js";
import { InvalidStateError } from "../domain/errors.js";
import {
  Qualification,
  type FindingSeverity,
  type QualificationFinding,
  type QualificationMethod,
  type QualificationOutcome,
  type QualificationType,
  type SectionCode,
} from "../domain/qualification.js";
import { SupplierRiskProfile } from "../domain/risk.js";
import type { DiversityFlag } from "../domain/common.js";
import type { Supplier } from "../domain/supplier.js";
import type {
  CategoryRepository,
  CertificationFilter,
  CertificationRepository,
  Clock,
  OutboxPort,
  QualificationFilter,
  QualificationRepository,
  RiskProfileRepository,
  SupplierRepository,
} from "./ports.js";

export interface ScheduleQualificationCommand {
  readonly supplierId: Ulid;
  readonly type: QualificationType;
  readonly method: QualificationMethod;
  readonly scheduledOn: DateOnly;
  readonly categoryId?: Ulid;
  readonly siteId?: Ulid;
  readonly validityMonths?: number;
  readonly sectionWeights?: Partial<Record<SectionCode, number>>;
}

export interface ComplianceSweepResult {
  readonly asOf: DateOnly;
  readonly certificationsExpired: readonly string[];
  readonly certificationsExpiring: readonly string[];
  readonly qualificationsExpired: readonly string[];
  readonly holdsPlaced: number;
  readonly holdsExpired: number;
}

/**
 * Qualification and certification use cases, plus the nightly compliance
 * sweep.
 *
 * The interesting behaviour is what happens *around* the audit: a failed
 * qualification places a sourcing hold and raises a quality risk flag; closing
 * the last major finding re-rates a conditional audit and lifts the hold it
 * caused; and the sweep turns dated facts (a certificate that lapsed
 * overnight) into the same enforcement a human would apply — a category-scoped
 * hold on exactly the categories that demand the certificate.
 */
export class QualificationService {
  constructor(
    private readonly qualifications: QualificationRepository,
    private readonly certifications: CertificationRepository,
    private readonly suppliers: SupplierRepository,
    private readonly categories: CategoryRepository,
    private readonly riskProfiles: RiskProfileRepository,
    private readonly outbox: OutboxPort,
    private readonly clock: Clock,
  ) {}

  // --- qualifications ------------------------------------------------------

  async schedule(ctx: TenantContext, command: ScheduleQualificationCommand): Promise<Qualification> {
    const supplier = await this.requireSupplier(ctx, command.supplierId);
    if (command.siteId && !supplier.siteById(command.siteId)) {
      throw new NotFoundError("SupplierSite", command.siteId);
    }
    let validityMonths = command.validityMonths;
    if (validityMonths === undefined && command.categoryId) {
      // The category's inherited policy sets how long a pass is good for.
      const policy = await this.policyFor(ctx, command.categoryId);
      validityMonths = policy?.requalificationMonths;
    }
    const sequence = await this.qualifications.nextSequence(ctx.tenantId);
    const qualification = Qualification.schedule(ctx.tenantId, {
      reference: `QAL-${String(sequence).padStart(5, "0")}`,
      supplierId: supplier.id,
      supplierCode: supplier.code,
      type: command.type,
      method: command.method,
      scheduledOn: command.scheduledOn,
      categoryId: command.categoryId,
      siteId: command.siteId,
      validityMonths,
      sectionWeights: command.sectionWeights,
    });
    await this.commit(qualification);
    return qualification;
  }

  async get(ctx: TenantContext, id: Ulid): Promise<Qualification> {
    const qualification = await this.qualifications.byId(ctx.tenantId, id);
    if (!qualification) throw new NotFoundError("Qualification", id);
    return qualification;
  }

  async list(ctx: TenantContext, filter: QualificationFilter, page?: Partial<PageRequest>): Promise<Page<Qualification>> {
    return this.qualifications.list(ctx.tenantId, filter, normalizePage(page));
  }

  async start(ctx: TenantContext, id: Ulid): Promise<Qualification> {
    const qualification = await this.get(ctx, id);
    qualification.start(ctx.userId, this.clock.now());
    await this.commit(qualification);
    return qualification;
  }

  async scoreSection(ctx: TenantContext, id: Ulid, section: SectionCode, score: number, notes?: string): Promise<Qualification> {
    const qualification = await this.get(ctx, id);
    qualification.scoreSection(section, score, this.clock.now(), notes);
    await this.commit(qualification);
    return qualification;
  }

  async raiseFinding(
    ctx: TenantContext,
    id: Ulid,
    input: {
      section: SectionCode;
      severity: FindingSeverity;
      description: string;
      capa?: { action: string; ownerId?: UserId; dueOn: DateOnly };
    },
  ): Promise<QualificationFinding> {
    const qualification = await this.get(ctx, id);
    const finding = qualification.raiseFinding(
      {
        section: input.section,
        severity: input.severity,
        description: input.description,
        capa: input.capa
          ? { action: input.capa.action, ownerId: input.capa.ownerId ?? ctx.userId, dueOn: input.capa.dueOn }
          : undefined,
      },
      this.clock.now(),
    );
    await this.commit(qualification);
    return finding;
  }

  /**
   * Closes a finding and re-rates the audit. When that promotes a conditional
   * result to a full pass, the audit-driven sourcing hold is lifted in the
   * same operation.
   */
  async closeFinding(ctx: TenantContext, id: Ulid, findingId: Ulid, evidence: string): Promise<Qualification> {
    const qualification = await this.get(ctx, id);
    const before = qualification.outcome;
    qualification.closeFinding(findingId, ctx.userId, this.clock.now(), evidence);
    if (qualification.status === "completed") {
      const after = qualification.rerate(this.clock.now());
      if (before !== "passed" && after === "passed") {
        await this.releaseAuditHold(ctx, qualification, "All audit findings closed");
      }
    }
    await this.commit(qualification);
    return qualification;
  }

  async waiveFinding(ctx: TenantContext, id: Ulid, findingId: Ulid, reason: string): Promise<Qualification> {
    const qualification = await this.get(ctx, id);
    qualification.waiveFinding(findingId, reason, this.clock.now());
    await this.commit(qualification);
    return qualification;
  }

  /**
   * Completes the audit. A failed outcome is enforced immediately: sourcing
   * is held (scoped to the audited category when there is one) and a quality
   * risk flag is raised for the register.
   */
  async complete(ctx: TenantContext, id: Ulid, summary?: string): Promise<{ qualification: Qualification; outcome: QualificationOutcome }> {
    const qualification = await this.get(ctx, id);
    const outcome = qualification.complete(ctx.userId, this.clock.today(), this.clock.now(), summary);
    await this.commit(qualification);
    if (outcome === "failed") await this.enforceFailedAudit(ctx, qualification);
    return { qualification, outcome };
  }

  async withdraw(ctx: TenantContext, id: Ulid, reason: string): Promise<Qualification> {
    const qualification = await this.get(ctx, id);
    qualification.withdraw(reason);
    await this.commit(qualification);
    return qualification;
  }

  /** Qualifications whose validity ends inside the horizon, soonest first. */
  async dueForRequalification(ctx: TenantContext, withinDays = 90): Promise<readonly Qualification[]> {
    const asOf = this.clock.today();
    const all = await this.qualifications.all(ctx.tenantId);
    return all
      .filter((qualification) => qualification.status === "completed" && qualification.validUntil !== undefined)
      .filter((qualification) => daysBetween(asOf, qualification.validUntil!) <= withinDays)
      .sort((a, b) => (a.validUntil ?? "").localeCompare(b.validUntil ?? ""));
  }

  // --- certifications ------------------------------------------------------

  async recordCertification(
    ctx: TenantContext,
    input: Omit<RecordCertificationInput, "supplierCode">,
  ): Promise<Certification> {
    const supplier = await this.requireSupplier(ctx, input.supplierId);
    for (const siteId of input.siteIds ?? []) {
      if (!supplier.siteById(siteId)) throw new NotFoundError("SupplierSite", siteId);
    }
    const held = await this.certifications.bySupplier(ctx.tenantId, supplier.id);
    const duplicate = held.find(
      (certification) =>
        certification.type === input.type &&
        certification.certificateNumber === input.certificateNumber.trim() &&
        certification.status !== "revoked",
    );
    if (duplicate) {
      throw new InvalidStateError(
        `Certificate ${input.certificateNumber} is already on file for ${supplier.code}; renew it instead`,
        { certificationId: duplicate.id },
      );
    }
    const certification = Certification.record(ctx.tenantId, { ...input, supplierCode: supplier.code });
    await this.commitCertification(certification);
    return certification;
  }

  async getCertification(ctx: TenantContext, id: Ulid): Promise<Certification> {
    const certification = await this.certifications.byId(ctx.tenantId, id);
    if (!certification) throw new NotFoundError("Certification", id);
    return certification;
  }

  async listCertifications(
    ctx: TenantContext,
    filter: CertificationFilter,
    page?: Partial<PageRequest>,
  ): Promise<Page<Certification>> {
    return this.certifications.list(ctx.tenantId, filter, normalizePage(page));
  }

  /**
   * Verifies a certificate. A verified diversity certificate also flips the
   * supplier's self-declared flag to verified, which is what spend reporting
   * counts.
   */
  async verifyCertification(ctx: TenantContext, id: Ulid): Promise<Certification> {
    const certification = await this.getCertification(ctx, id);
    certification.verify(ctx.userId, this.clock.now(), this.clock.today());
    await this.commitCertification(certification);

    const diversityFlag = (Object.entries(DIVERSITY_CERTIFICATION) as [DiversityFlag, CertificationType][]).find(
      ([, type]) => type === certification.type,
    )?.[0];
    const supplier = await this.suppliers.byId(ctx.tenantId, certification.supplierId);
    if (supplier && diversityFlag && supplier.diversity.some((entry) => entry.flag === diversityFlag)) {
      supplier.markDiversityVerified(diversityFlag, certification.id, this.clock.now());
      await this.suppliers.save(supplier);
      await this.outbox.publish(supplier.pullEvents());
    }
    return certification;
  }

  async rejectCertification(ctx: TenantContext, id: Ulid, reason: string): Promise<Certification> {
    const certification = await this.getCertification(ctx, id);
    certification.reject(reason, this.clock.now());
    await this.commitCertification(certification);
    return certification;
  }

  /** Renewing a certificate lifts the hold its expiry caused. */
  async renewCertification(
    ctx: TenantContext,
    id: Ulid,
    input: { certificateNumber: string; issuedOn: DateOnly; expiresOn: DateOnly; documentRef?: string },
  ): Promise<Certification> {
    const certification = await this.getCertification(ctx, id);
    certification.renew(input, ctx.userId, this.clock.now());
    await this.commitCertification(certification);
    const profile = await this.riskProfiles.bySupplier(ctx.tenantId, certification.supplierId);
    if (profile) {
      const released = profile.releaseHoldsBySourceRef(
        `certification:${certification.id}`,
        ctx.userId,
        `Certificate renewed to ${input.expiresOn}`,
        this.clock.today(),
      );
      if (released.length > 0) await this.commitProfile(profile);
    }
    return certification;
  }

  /** Revocation is immediate: the hold goes on in the same call. */
  async revokeCertification(ctx: TenantContext, id: Ulid, reason: string): Promise<Certification> {
    const certification = await this.getCertification(ctx, id);
    certification.revoke(reason, this.clock.now());
    await this.commitCertification(certification);
    await this.holdForCertification(ctx, certification.supplierId, certification.id, certification.type, reason);
    return certification;
  }

  // --- compliance sweep ----------------------------------------------------

  /**
   * Nightly job: warn on certificates about to lapse, expire the ones that
   * have, expire stale qualifications, hold sourcing where a required
   * certificate is now missing, and let time-boxed holds fall away.
   */
  async runComplianceSweep(ctx: TenantContext, warningDays = DEFAULT_EXPIRY_WARNING_DAYS): Promise<ComplianceSweepResult> {
    const asOf = this.clock.today();
    const now = this.clock.now();
    const expired: string[] = [];
    const expiring: string[] = [];
    let holdsPlaced = 0;

    for (const certification of await this.certifications.all(ctx.tenantId)) {
      const warned = certification.warnExpiring(asOf, now, warningDays);
      const lapsed = certification.expireIfDue(asOf);
      if (warned) expiring.push(certification.certificateNumber);
      if (lapsed) {
        expired.push(certification.certificateNumber);
        const placed = await this.holdForCertification(
          ctx,
          certification.supplierId,
          certification.id,
          certification.type,
          `Certificate ${certification.certificateNumber} expired on ${certification.expiresOn}`,
        );
        if (placed) holdsPlaced += 1;
      }
      if (warned || lapsed) await this.commitCertification(certification);
    }

    const qualificationsExpired: string[] = [];
    for (const qualification of await this.qualifications.all(ctx.tenantId)) {
      if (qualification.expireIfDue(asOf)) {
        qualificationsExpired.push(qualification.reference);
        await this.commit(qualification);
      }
    }

    let holdsExpired = 0;
    for (const profile of await this.riskProfiles.all(ctx.tenantId)) {
      const lapsedHolds = profile.expireHolds(asOf);
      if (lapsedHolds.length > 0) {
        holdsExpired += lapsedHolds.length;
        await this.commitProfile(profile);
      }
    }

    return {
      asOf,
      certificationsExpired: expired,
      certificationsExpiring: expiring,
      qualificationsExpired,
      holdsPlaced,
      holdsExpired,
    };
  }

  // --- internals -----------------------------------------------------------

  /**
   * Places a category-scoped sourcing hold when a lapsed certificate is
   * actually required somewhere the supplier is approved. A certificate the
   * supplier keeps voluntarily does not stop trade.
   */
  private async holdForCertification(
    ctx: TenantContext,
    supplierId: Ulid,
    certificationId: Ulid,
    type: CertificationType,
    note: string,
  ): Promise<boolean> {
    const supplier = await this.suppliers.byId(ctx.tenantId, supplierId);
    if (!supplier) return false;
    const categories = await this.categories.all(ctx.tenantId);
    const byId = new Map(categories.map((category: CategoryRecord) => [category.id, category]));
    const affected = supplier
      .approvedCategoryIds()
      .filter((categoryId) => resolveCategoryPolicy(byId, categoryId)?.requiredCertifications.includes(type));
    if (affected.length === 0) return false;

    const profile = await this.requireProfile(ctx, supplier);
    if (profile.activeHolds().some((hold) => hold.sourceRef === `certification:${certificationId}`)) return false;
    profile.placeHold(
      {
        type: "sourcing",
        reasonCode: "expired_certification",
        scope: "categories",
        categoryIds: affected,
        placedOn: this.clock.today(),
        note,
        releaseRoles: ["srm.compliance", "srm.quality"],
        sourceRef: `certification:${certificationId}`,
      },
      ctx.userId,
      this.clock.now(),
    );
    await this.commitProfile(profile);
    return true;
  }

  private async enforceFailedAudit(ctx: TenantContext, qualification: Qualification): Promise<void> {
    const supplier = await this.suppliers.byId(ctx.tenantId, qualification.supplierId);
    if (!supplier) return;
    const profile = await this.requireProfile(ctx, supplier);
    const scope = qualification.categoryId ? "categories" : "supplier";
    if (!profile.activeHolds().some((hold) => hold.sourceRef === `qualification:${qualification.id}`)) {
      profile.placeHold(
        {
          type: "sourcing",
          reasonCode: "failed_audit",
          scope,
          categoryIds: qualification.categoryId ? [qualification.categoryId] : [],
          placedOn: this.clock.today(),
          note: `Qualification ${qualification.reference} failed with score ${qualification.score ?? 0}`,
          releaseRoles: ["srm.quality"],
          sourceRef: `qualification:${qualification.id}`,
        },
        ctx.userId,
        this.clock.now(),
      );
    }
    const critical = qualification.openFindings("critical");
    profile.raiseFlag(
      {
        category: "quality",
        title: `Failed ${qualification.method} audit ${qualification.reference}`,
        description: critical.map((finding) => finding.description).join("; ") || qualification.conditions.join("; "),
        source: "audit",
        likelihood: 4,
        impact: critical.length > 0 ? 5 : 4,
        detectedOn: this.clock.today(),
        reviewDueOn: addMonths(this.clock.today(), 3),
        ownerId: ctx.userId,
        sourceRef: `qualification:${qualification.id}`,
      },
      this.clock.now(),
    );
    await this.commitProfile(profile);
  }

  private async releaseAuditHold(ctx: TenantContext, qualification: Qualification, reason: string): Promise<void> {
    const profile = await this.riskProfiles.bySupplier(ctx.tenantId, qualification.supplierId);
    if (!profile) return;
    const released = profile.releaseHoldsBySourceRef(
      `qualification:${qualification.id}`,
      ctx.userId,
      reason,
      this.clock.today(),
    );
    if (released.length > 0) await this.commitProfile(profile);
  }

  private async policyFor(ctx: TenantContext, categoryId: Ulid) {
    const categories = await this.categories.all(ctx.tenantId);
    return resolveCategoryPolicy(new Map(categories.map((category) => [category.id, category])), categoryId);
  }

  private async requireSupplier(ctx: TenantContext, supplierId: Ulid): Promise<Supplier> {
    const supplier = await this.suppliers.byId(ctx.tenantId, supplierId);
    if (!supplier) throw new NotFoundError("Supplier", supplierId);
    return supplier;
  }

  private async requireProfile(ctx: TenantContext, supplier: Supplier): Promise<SupplierRiskProfile> {
    const existing = await this.riskProfiles.bySupplier(ctx.tenantId, supplier.id);
    if (existing) return existing;
    const created = SupplierRiskProfile.create(ctx.tenantId, supplier.id, supplier.code);
    await this.riskProfiles.save(created);
    return created;
  }

  private async commit(qualification: Qualification): Promise<void> {
    await this.qualifications.save(qualification);
    await this.outbox.publish(qualification.pullEvents());
  }

  private async commitCertification(certification: Certification): Promise<void> {
    await this.certifications.save(certification);
    await this.outbox.publish(certification.pullEvents());
  }

  private async commitProfile(profile: SupplierRiskProfile): Promise<void> {
    await this.riskProfiles.save(profile);
    await this.outbox.publish(profile.pullEvents());
  }
}
