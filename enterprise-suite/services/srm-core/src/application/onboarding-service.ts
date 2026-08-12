import {
  NotFoundError,
  normalizePage,
  type Page,
  type PageRequest,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { Certification } from "../domain/certification.js";
import { addMonths, type DateOnly } from "../domain/dates.js";
import { InvalidStateError } from "../domain/errors.js";
import {
  OnboardingCase,
  type ApproverRole,
  type OnboardingStep,
  type RequestedDocument,
} from "../domain/onboarding.js";
import { SupplierRiskProfile } from "../domain/risk.js";
import type { Supplier } from "../domain/supplier.js";
import type {
  CertificationRepository,
  Clock,
  OnboardingFilter,
  OnboardingRepository,
  OutboxPort,
  RiskProfileRepository,
  SupplierRepository,
} from "./ports.js";

export interface StartOnboardingCommand {
  readonly supplierId: Ulid;
  readonly templateCode: string;
  readonly targetGoLiveOn?: DateOnly;
}

export interface OnboardingProgress {
  readonly caseNumber: string;
  readonly status: string;
  readonly completion: number;
  readonly riskScore: number;
  readonly riskTier: string;
  readonly requiredRoles: readonly ApproverRole[];
  readonly approvedRoles: readonly ApproverRole[];
  readonly outstandingSteps: readonly string[];
  readonly outstandingDocuments: readonly string[];
  readonly unansweredQuestions: readonly string[];
}

/**
 * Onboarding orchestration.
 *
 * The case aggregate owns the checklist and the approval matrix. This service
 * connects it to the rest of SRM: starting a case moves the supplier into
 * `onboarding`, an approved case activates the supplier, verified documents
 * with an expiry become tracked certifications, and a high-risk questionnaire
 * result lands as a risk flag on the supplier's profile instead of
 * evaporating with the case.
 */
export class OnboardingService {
  constructor(
    private readonly cases: OnboardingRepository,
    private readonly suppliers: SupplierRepository,
    private readonly certifications: CertificationRepository,
    private readonly riskProfiles: RiskProfileRepository,
    private readonly outbox: OutboxPort,
    private readonly clock: Clock,
  ) {}

  async start(ctx: TenantContext, command: StartOnboardingCommand): Promise<OnboardingCase> {
    const supplier = await this.requireSupplier(ctx, command.supplierId);
    const existing = await this.cases.bySupplier(ctx.tenantId, supplier.id);
    const open = existing.find(
      (entry) => entry.status === "in_progress" || entry.status === "pending_approval" || entry.status === "draft",
    );
    if (open) {
      throw new InvalidStateError(`Supplier ${supplier.code} already has an open onboarding case ${open.number}`);
    }
    const sequence = await this.cases.nextSequence(ctx.tenantId);
    const onboarding = OnboardingCase.start(ctx.tenantId, {
      number: `ONB-${String(sequence).padStart(5, "0")}`,
      supplierId: supplier.id,
      supplierCode: supplier.code,
      templateCode: command.templateCode,
      targetGoLiveOn: command.targetGoLiveOn,
    });
    supplier.startOnboarding(onboarding.id, ctx.userId);
    await this.commitSupplier(supplier);
    await this.commit(onboarding);
    return onboarding;
  }

  async get(ctx: TenantContext, id: Ulid): Promise<OnboardingCase> {
    const onboarding = await this.cases.byId(ctx.tenantId, id);
    if (!onboarding) throw new NotFoundError("OnboardingCase", id);
    return onboarding;
  }

  async list(ctx: TenantContext, filter: OnboardingFilter, page?: Partial<PageRequest>): Promise<Page<OnboardingCase>> {
    return this.cases.list(ctx.tenantId, filter, normalizePage(page));
  }

  progress(onboarding: OnboardingCase): OnboardingProgress {
    return {
      caseNumber: onboarding.number,
      status: onboarding.status,
      completion: Math.round(onboarding.completion() * 100) / 100,
      riskScore: onboarding.riskScore(),
      riskTier: onboarding.riskTier(),
      requiredRoles: onboarding.requiredApproverRoles(),
      approvedRoles: onboarding.approvals.filter((a) => a.decision === "approved").map((a) => a.role),
      outstandingSteps: onboarding.outstandingSteps().map((step) => step.code),
      outstandingDocuments: onboarding.outstandingDocuments().map((doc) => doc.code),
      unansweredQuestions: onboarding.unansweredRequiredQuestions().map((question) => question.code),
    };
  }

  // --- checklist -----------------------------------------------------------

  async startStep(ctx: TenantContext, id: Ulid, stepCode: string): Promise<OnboardingStep> {
    const onboarding = await this.get(ctx, id);
    const step = onboarding.startStep(stepCode);
    await this.commit(onboarding);
    return step;
  }

  async completeStep(ctx: TenantContext, id: Ulid, stepCode: string, evidenceRef?: string): Promise<OnboardingStep> {
    const onboarding = await this.get(ctx, id);
    const step = onboarding.completeStep(stepCode, ctx.userId, this.clock.now(), evidenceRef);
    await this.commit(onboarding);
    return step;
  }

  async waiveStep(ctx: TenantContext, id: Ulid, stepCode: string, reason: string): Promise<OnboardingStep> {
    const onboarding = await this.get(ctx, id);
    const step = onboarding.waiveStep(stepCode, ctx.userId, this.clock.now(), reason);
    await this.commit(onboarding);
    return step;
  }

  async addStep(ctx: TenantContext, id: Ulid, input: Parameters<OnboardingCase["addStep"]>[0]): Promise<OnboardingStep> {
    const onboarding = await this.get(ctx, id);
    const step = onboarding.addStep(input);
    await this.commit(onboarding);
    return step;
  }

  async requestDocument(
    ctx: TenantContext,
    id: Ulid,
    input: Parameters<OnboardingCase["requestDocument"]>[0],
  ): Promise<RequestedDocument> {
    const onboarding = await this.get(ctx, id);
    const document = onboarding.requestDocument(input);
    await this.commit(onboarding);
    return document;
  }

  async receiveDocument(
    ctx: TenantContext,
    id: Ulid,
    code: string,
    fileRef: string,
    expiresOn?: DateOnly,
  ): Promise<RequestedDocument> {
    const onboarding = await this.get(ctx, id);
    const document = onboarding.receiveDocument(code, fileRef, this.clock.now(), expiresOn);
    await this.commit(onboarding);
    return document;
  }

  async verifyDocument(ctx: TenantContext, id: Ulid, code: string): Promise<RequestedDocument> {
    const onboarding = await this.get(ctx, id);
    const document = onboarding.verifyDocument(code, ctx.userId, this.clock.now());
    await this.commit(onboarding);
    return document;
  }

  async rejectDocument(ctx: TenantContext, id: Ulid, code: string, reason: string): Promise<RequestedDocument> {
    const onboarding = await this.get(ctx, id);
    const document = onboarding.rejectDocument(code, reason, this.clock.now());
    await this.commit(onboarding);
    return document;
  }

  async answerQuestion(
    ctx: TenantContext,
    id: Ulid,
    input: { code: string; value: string; riskFactor: number; note?: string },
  ): Promise<OnboardingCase> {
    const onboarding = await this.get(ctx, id);
    onboarding.answerQuestion(input, this.clock.now());
    await this.commit(onboarding);
    return onboarding;
  }

  // --- decision ------------------------------------------------------------

  async submit(ctx: TenantContext, id: Ulid): Promise<OnboardingCase> {
    const onboarding = await this.get(ctx, id);
    onboarding.submitForApproval(ctx.userId, this.clock.now());
    await this.commit(onboarding);
    return onboarding;
  }

  /**
   * Records one role's decision and, when the last required approval lands,
   * runs the go-live: the supplier is activated, verified dated documents
   * become certifications, and a high-risk questionnaire becomes a standing
   * risk flag.
   */
  async decide(
    ctx: TenantContext,
    id: Ulid,
    role: ApproverRole,
    decision: "approved" | "rejected",
    comment?: string,
  ): Promise<OnboardingCase> {
    const onboarding = await this.get(ctx, id);
    onboarding.recordDecision(ctx.userId, role, decision, this.clock.now(), comment);
    await this.commit(onboarding);

    if (onboarding.status === "approved") await this.completeGoLive(ctx, onboarding);
    if (onboarding.status === "rejected") {
      const supplier = await this.requireSupplier(ctx, onboarding.supplierId);
      if (supplier.status === "onboarding") {
        supplier.reject(ctx.userId, comment ?? `Onboarding case ${onboarding.number} rejected`);
        await this.commitSupplier(supplier);
      }
    }
    return onboarding;
  }

  async withdraw(ctx: TenantContext, id: Ulid, reason: string): Promise<OnboardingCase> {
    const onboarding = await this.get(ctx, id);
    onboarding.withdraw(reason, this.clock.now());
    await this.commit(onboarding);
    return onboarding;
  }

  private async completeGoLive(ctx: TenantContext, onboarding: OnboardingCase): Promise<void> {
    const supplier = await this.requireSupplier(ctx, onboarding.supplierId);
    await this.materialiseCertifications(ctx, onboarding, supplier);
    await this.captureRisk(ctx, onboarding, supplier);
    // Activation can still fail on missing master data; the case stays
    // approved so the buyer only has to fix the gap and re-activate.
    supplier.activate(ctx.userId, this.clock.today(), `Onboarding ${onboarding.number} approved`);
    await this.commitSupplier(supplier);
  }

  /**
   * Verified documents that map to a certification type and carry an expiry
   * become tracked certifications, pre-verified: the evidence was already
   * checked during onboarding, and expiry monitoring should start now rather
   * than when somebody remembers to re-enter it.
   */
  private async materialiseCertifications(
    ctx: TenantContext,
    onboarding: OnboardingCase,
    supplier: Supplier,
  ): Promise<void> {
    const existing = await this.certifications.bySupplier(ctx.tenantId, supplier.id);
    const today = this.clock.today();
    for (const document of onboarding.documents) {
      if (document.status !== "verified" || !document.certificationType) continue;
      if (existing.some((certification) => certification.type === document.certificationType)) continue;
      const certification = Certification.record(ctx.tenantId, {
        supplierId: supplier.id,
        supplierCode: supplier.code,
        type: document.certificationType,
        issuer: "collected during onboarding",
        certificateNumber: `${onboarding.number}-${document.code}`,
        issuedOn: today,
        // Undated evidence still needs a review date; a year is the usual
        // refresh cadence for onboarding paperwork.
        expiresOn: document.expiresOn ?? addMonths(today, 12),
        documentRef: document.fileRef,
      });
      certification.verify(ctx.userId, this.clock.now(), today);
      await this.certifications.save(certification);
      await this.outbox.publish(certification.pullEvents());
    }
  }

  private async captureRisk(ctx: TenantContext, onboarding: OnboardingCase, supplier: Supplier): Promise<void> {
    const tier = onboarding.riskTier();
    if (tier !== "high" && tier !== "critical") return;
    const profile =
      (await this.riskProfiles.bySupplier(ctx.tenantId, supplier.id)) ??
      SupplierRiskProfile.create(ctx.tenantId, supplier.id, supplier.code);
    const score = onboarding.riskScore();
    profile.raiseFlag(
      {
        category: "operational",
        title: `Onboarding risk assessment scored ${score}`,
        description: onboarding.answers
          .filter((answer) => answer.riskFactor >= 0.5)
          .map((answer) => `${answer.code}: ${answer.value}`)
          .join("; "),
        source: "questionnaire",
        likelihood: tier === "critical" ? 4 : 3,
        impact: tier === "critical" ? 5 : 4,
        detectedOn: this.clock.today(),
        reviewDueOn: addMonths(this.clock.today(), 6),
        ownerId: ctx.userId,
        sourceRef: `onboarding:${onboarding.id}`,
      },
      this.clock.now(),
    );
    await this.riskProfiles.save(profile);
    await this.outbox.publish(profile.pullEvents());
  }

  private async requireSupplier(ctx: TenantContext, supplierId: Ulid): Promise<Supplier> {
    const supplier = await this.suppliers.byId(ctx.tenantId, supplierId);
    if (!supplier) throw new NotFoundError("Supplier", supplierId);
    return supplier;
  }

  private async commit(onboarding: OnboardingCase): Promise<void> {
    await this.cases.save(onboarding);
    await this.outbox.publish(onboarding.pullEvents());
  }

  private async commitSupplier(supplier: Supplier): Promise<void> {
    await this.suppliers.save(supplier);
    await this.outbox.publish(supplier.pullEvents());
  }
}
