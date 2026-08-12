import {
  ConflictError,
  NotFoundError,
  normalizePage,
  type Page,
  type PageRequest,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { resolveCategoryPolicy, type CategoryPolicy } from "../domain/category.js";
import type { DiversityFlag } from "../domain/common.js";
import { DIVERSITY_CERTIFICATION } from "../domain/certification.js";
import { ComplianceBlockedError, InvalidStateError } from "../domain/errors.js";
import { SupplierRiskProfile } from "../domain/risk.js";
import {
  Supplier,
  type AddBankAccountInput,
  type AddContactInput,
  type AddSiteInput,
  type RegisterSupplierInput,
  type SupplierCategoryAssignment,
  type SupplierClassification,
  type SupplierContact,
  type SupplierSite,
  type UpdateSupplierProfileInput,
} from "../domain/supplier.js";
import type {
  CategoryRepository,
  CertificationRepository,
  Clock,
  OutboxPort,
  QualificationRepository,
  RiskProfileRepository,
  SupplierFilter,
  SupplierRepository,
} from "./ports.js";

export interface SupplierPanelEntry {
  readonly assignment: SupplierCategoryAssignment;
  readonly policy?: CategoryPolicy;
  readonly satisfiesPolicy: boolean;
  readonly gaps: readonly string[];
}

/**
 * Supplier master use cases.
 *
 * The aggregate owns everything it can see on its own; this service adds the
 * cross-aggregate rules — a supplier code is unique per tenant, every supplier
 * gets a risk profile the moment it is registered, blocking a supplier also
 * stops sourcing through a compliance hold, and a category panel approval is
 * only granted when the category's policy (qualification + certifications) is
 * actually satisfied.
 */
export class SupplierService {
  constructor(
    private readonly suppliers: SupplierRepository,
    private readonly categories: CategoryRepository,
    private readonly certifications: CertificationRepository,
    private readonly qualifications: QualificationRepository,
    private readonly riskProfiles: RiskProfileRepository,
    private readonly outbox: OutboxPort,
    private readonly clock: Clock,
  ) {}

  // --- registration & lookup ----------------------------------------------

  async register(ctx: TenantContext, input: RegisterSupplierInput): Promise<Supplier> {
    const supplier = Supplier.register(ctx.tenantId, input);
    if (await this.suppliers.byCode(ctx.tenantId, supplier.code)) {
      throw new ConflictError(`Supplier code ${supplier.code} is already registered`);
    }
    if (input.parentSupplierId) {
      const parent = await this.suppliers.byId(ctx.tenantId, input.parentSupplierId);
      if (!parent) throw new NotFoundError("Supplier", input.parentSupplierId);
    }
    await this.commit(supplier);
    // Every supplier carries a risk profile from day one so holds and flags
    // never need a "create if missing" dance later.
    const profile = SupplierRiskProfile.create(ctx.tenantId, supplier.id, supplier.code);
    await this.riskProfiles.save(profile);
    return supplier;
  }

  async get(ctx: TenantContext, id: Ulid): Promise<Supplier> {
    const supplier = await this.suppliers.byId(ctx.tenantId, id);
    if (!supplier) throw new NotFoundError("Supplier", id);
    return supplier;
  }

  async getByCode(ctx: TenantContext, code: string): Promise<Supplier> {
    const supplier = await this.suppliers.byCode(ctx.tenantId, code.trim().toUpperCase());
    if (!supplier) throw new NotFoundError("Supplier", code);
    return supplier;
  }

  async list(ctx: TenantContext, filter: SupplierFilter, page?: Partial<PageRequest>): Promise<Page<Supplier>> {
    return this.suppliers.list(ctx.tenantId, filter, normalizePage(page));
  }

  /** Parent plus subsidiaries, for group-level spend and risk rollups. */
  async group(ctx: TenantContext, id: Ulid): Promise<{ parent: Supplier; children: readonly Supplier[] }> {
    const supplier = await this.get(ctx, id);
    const parent = supplier.parentSupplierId ? await this.get(ctx, supplier.parentSupplierId) : supplier;
    return { parent, children: await this.suppliers.children(ctx.tenantId, parent.id) };
  }

  async updateProfile(ctx: TenantContext, id: Ulid, patch: UpdateSupplierProfileInput): Promise<Supplier> {
    const supplier = await this.get(ctx, id);
    if (patch.parentSupplierId) {
      const parent = await this.suppliers.byId(ctx.tenantId, patch.parentSupplierId);
      if (!parent) throw new NotFoundError("Supplier", patch.parentSupplierId);
      if (parent.parentSupplierId === supplier.id) {
        throw new InvalidStateError(`${parent.code} is already a subsidiary of ${supplier.code}`);
      }
    }
    supplier.updateProfile(patch);
    await this.commit(supplier);
    return supplier;
  }

  async classify(
    ctx: TenantContext,
    id: Ulid,
    classification: SupplierClassification,
    rationale?: string,
  ): Promise<Supplier> {
    const supplier = await this.get(ctx, id);
    supplier.classify(classification, rationale);
    await this.commit(supplier);
    return supplier;
  }

  // --- lifecycle -----------------------------------------------------------

  /**
   * Activates a supplier directly (the onboarding path calls this too).
   * An active onboarding hold means the compliance team has not cleared the
   * supplier, so activation is refused rather than silently overriding it.
   */
  async activate(ctx: TenantContext, id: Ulid, reason?: string): Promise<Supplier> {
    const supplier = await this.get(ctx, id);
    const profile = await this.riskProfiles.bySupplier(ctx.tenantId, id);
    const holds = profile?.blockingHolds("onboarding") ?? [];
    if (holds.length > 0) {
      throw new ComplianceBlockedError(
        `Supplier ${supplier.code} has an active onboarding hold`,
        holds.map((hold) => hold.id),
        { reasonCodes: holds.map((hold) => hold.reasonCode) },
      );
    }
    supplier.activate(ctx.userId, this.clock.today(), reason);
    await this.commit(supplier);
    return supplier;
  }

  async suspend(ctx: TenantContext, id: Ulid, reason: string): Promise<Supplier> {
    const supplier = await this.get(ctx, id);
    supplier.suspend(ctx.userId, reason);
    await this.commit(supplier);
    return supplier;
  }

  async reinstate(ctx: TenantContext, id: Ulid, reason?: string): Promise<Supplier> {
    const supplier = await this.get(ctx, id);
    const profile = await this.riskProfiles.bySupplier(ctx.tenantId, id);
    const holds = profile?.blockingHolds("sourcing") ?? [];
    if (holds.length > 0) {
      throw new ComplianceBlockedError(
        `Supplier ${supplier.code} cannot be reinstated while a sourcing hold is active`,
        holds.map((hold) => hold.id),
        { reasonCodes: holds.map((hold) => hold.reasonCode) },
      );
    }
    supplier.reinstate(ctx.userId, reason);
    await this.commit(supplier);
    return supplier;
  }

  /**
   * Blocking is the sanctions stop, so it also places a supplier-wide sourcing
   * hold that only compliance can lift.
   */
  async block(ctx: TenantContext, id: Ulid, reason: string): Promise<Supplier> {
    const supplier = await this.get(ctx, id);
    supplier.block(ctx.userId, reason);
    await this.commit(supplier);
    const profile = await this.requireProfile(ctx, supplier.id, supplier.code);
    if (!profile.isBlocked("sourcing")) {
      profile.placeHold(
        {
          type: "sourcing",
          reasonCode: "sanctions_match",
          placedOn: this.clock.today(),
          note: reason,
          releaseRoles: ["srm.compliance"],
          sourceRef: `supplier-block:${supplier.id}`,
        },
        ctx.userId,
        this.clock.now(),
      );
      await this.commitProfile(profile);
    }
    return supplier;
  }

  async unblock(ctx: TenantContext, id: Ulid, reason: string): Promise<Supplier> {
    const supplier = await this.get(ctx, id);
    supplier.unblock(ctx.userId, reason);
    await this.commit(supplier);
    const profile = await this.requireProfile(ctx, supplier.id, supplier.code);
    profile.releaseHoldsBySourceRef(`supplier-block:${supplier.id}`, ctx.userId, reason, this.clock.today());
    await this.commitProfile(profile);
    return supplier;
  }

  async deactivate(ctx: TenantContext, id: Ulid, reason: string): Promise<Supplier> {
    const supplier = await this.get(ctx, id);
    supplier.deactivate(ctx.userId, reason);
    await this.commit(supplier);
    return supplier;
  }

  // --- sites, contacts, banking -------------------------------------------

  async addSite(ctx: TenantContext, id: Ulid, input: AddSiteInput): Promise<SupplierSite> {
    const supplier = await this.get(ctx, id);
    const site = supplier.addSite(input);
    await this.commit(supplier);
    return site;
  }

  async updateSite(
    ctx: TenantContext,
    id: Ulid,
    siteId: Ulid,
    patch: Parameters<Supplier["updateSite"]>[1],
  ): Promise<SupplierSite> {
    const supplier = await this.get(ctx, id);
    const site = supplier.updateSite(siteId, patch);
    await this.commit(supplier);
    return site;
  }

  async setPrimarySite(ctx: TenantContext, id: Ulid, siteId: Ulid): Promise<Supplier> {
    const supplier = await this.get(ctx, id);
    supplier.setPrimarySite(siteId);
    await this.commit(supplier);
    return supplier;
  }

  async deactivateSite(ctx: TenantContext, id: Ulid, siteId: Ulid, reason: string): Promise<Supplier> {
    const supplier = await this.get(ctx, id);
    supplier.deactivateSite(siteId, reason);
    await this.commit(supplier);
    return supplier;
  }

  async addContact(ctx: TenantContext, id: Ulid, input: AddContactInput): Promise<SupplierContact> {
    const supplier = await this.get(ctx, id);
    const contact = supplier.addContact(input);
    await this.commit(supplier);
    return contact;
  }

  async removeContact(ctx: TenantContext, id: Ulid, contactId: Ulid): Promise<Supplier> {
    const supplier = await this.get(ctx, id);
    supplier.removeContact(contactId);
    await this.commit(supplier);
    return supplier;
  }

  async addBankAccount(ctx: TenantContext, id: Ulid, input: AddBankAccountInput): Promise<Supplier> {
    const supplier = await this.get(ctx, id);
    supplier.addBankAccount(input, this.clock.now());
    await this.commit(supplier);
    return supplier;
  }

  async verifyBankAccount(ctx: TenantContext, id: Ulid, accountId: Ulid, makePrimary = true): Promise<Supplier> {
    const supplier = await this.get(ctx, id);
    supplier.verifyBankAccount(accountId, ctx.userId, this.clock.now(), makePrimary);
    await this.commit(supplier);
    const profile = await this.riskProfiles.bySupplier(ctx.tenantId, supplier.id);
    if (profile) {
      // Clears any automatic payment hold raised for unverified bank details.
      const released = profile.releaseHoldsBySourceRef(
        `bank-unverified:${supplier.id}`,
        ctx.userId,
        "Bank account verified",
        this.clock.today(),
      );
      if (released.length > 0) await this.commitProfile(profile);
    }
    return supplier;
  }

  async declareDiversity(ctx: TenantContext, id: Ulid, flag: DiversityFlag): Promise<Supplier> {
    const supplier = await this.get(ctx, id);
    supplier.declareDiversity(flag, this.clock.now());
    // A declaration backed by an already-verified certificate counts at once.
    const requiredType = DIVERSITY_CERTIFICATION[flag];
    if (requiredType) {
      const held = await this.certifications.bySupplier(ctx.tenantId, supplier.id);
      const proof = held.find(
        (certification) =>
          certification.type === requiredType && certification.status === "valid" && certification.isEffectiveOn(this.clock.today()),
      );
      if (proof) supplier.markDiversityVerified(flag, proof.id, this.clock.now());
    }
    await this.commit(supplier);
    return supplier;
  }

  // --- category panel ------------------------------------------------------

  async assignCategory(ctx: TenantContext, id: Ulid, categoryId: Ulid, note?: string): Promise<SupplierCategoryAssignment> {
    const supplier = await this.get(ctx, id);
    const category = await this.categories.byId(ctx.tenantId, categoryId);
    if (!category) throw new NotFoundError("Category", categoryId);
    const assignment = supplier.assignCategory(categoryId, category.code, this.clock.now(), note);
    await this.commit(supplier);
    return assignment;
  }

  /**
   * Approves the supplier for a category once the category's inherited policy
   * is met: a valid qualification when the category demands one, and every
   * required certification currently effective. The gaps are reported
   * together so a category manager fixes them in one pass.
   */
  async approveCategory(ctx: TenantContext, id: Ulid, categoryId: Ulid, note?: string): Promise<SupplierCategoryAssignment> {
    const supplier = await this.get(ctx, id);
    const policy = await this.policyFor(ctx, categoryId);
    const gaps = await this.policyGaps(ctx, supplier, policy);
    if (gaps.length > 0) {
      throw new InvalidStateError(
        `Supplier ${supplier.code} does not meet the policy for ${policy.path}: ${gaps.join("; ")}`,
        { gaps },
      );
    }
    const profile = await this.riskProfiles.bySupplier(ctx.tenantId, supplier.id);
    const holds = profile?.blockingHolds("sourcing", { categoryId }) ?? [];
    if (holds.length > 0) {
      throw new ComplianceBlockedError(
        `Supplier ${supplier.code} has an active sourcing hold`,
        holds.map((hold) => hold.id),
        { reasonCodes: holds.map((hold) => hold.reasonCode) },
      );
    }
    const assignment = supplier.approveCategory(categoryId, ctx.userId, this.clock.now(), note);
    await this.commit(supplier);
    return assignment;
  }

  async restrictCategory(ctx: TenantContext, id: Ulid, categoryId: Ulid, reason: string): Promise<SupplierCategoryAssignment> {
    const supplier = await this.get(ctx, id);
    const assignment = supplier.restrictCategory(categoryId, reason);
    await this.commit(supplier);
    return assignment;
  }

  /** The supplier's panel with the policy gaps that stand in the way. */
  async panel(ctx: TenantContext, id: Ulid): Promise<readonly SupplierPanelEntry[]> {
    const supplier = await this.get(ctx, id);
    const entries: SupplierPanelEntry[] = [];
    for (const assignment of supplier.categories) {
      const policy = await this.policyFor(ctx, assignment.categoryId).catch(() => undefined);
      const gaps = policy ? await this.policyGaps(ctx, supplier, policy) : [];
      entries.push({ assignment, policy, satisfiesPolicy: gaps.length === 0, gaps });
    }
    return entries;
  }

  /** Unmet policy requirements, as human-readable gap sentences. */
  async policyGaps(ctx: TenantContext, supplier: Supplier, policy: CategoryPolicy): Promise<readonly string[]> {
    const asOf = this.clock.today();
    const gaps: string[] = [];

    if (policy.requiresQualification) {
      const qualifications = await this.qualifications.bySupplier(ctx.tenantId, supplier.id);
      const valid = qualifications.filter(
        (qualification) =>
          qualification.isValidOn(asOf) &&
          (qualification.categoryId === undefined || qualification.categoryId === policy.categoryId),
      );
      if (valid.length === 0) gaps.push(`no valid qualification for ${policy.path}`);
    }

    if (policy.requiredCertifications.length > 0) {
      const held = await this.certifications.bySupplier(ctx.tenantId, supplier.id);
      for (const type of policy.requiredCertifications) {
        const effective = held.some(
          (certification) =>
            certification.type === type && certification.status === "valid" && certification.isEffectiveOn(asOf),
        );
        if (!effective) gaps.push(`missing a valid ${type} certificate`);
      }
    }

    return gaps;
  }

  async policyFor(ctx: TenantContext, categoryId: Ulid): Promise<CategoryPolicy> {
    const all = await this.categories.all(ctx.tenantId);
    const policy = resolveCategoryPolicy(new Map(all.map((entry) => [entry.id, entry])), categoryId);
    if (!policy) throw new NotFoundError("Category", categoryId);
    return policy;
  }

  private async requireProfile(ctx: TenantContext, supplierId: Ulid, supplierCode: string): Promise<SupplierRiskProfile> {
    const existing = await this.riskProfiles.bySupplier(ctx.tenantId, supplierId);
    if (existing) return existing;
    const created = SupplierRiskProfile.create(ctx.tenantId, supplierId, supplierCode);
    await this.riskProfiles.save(created);
    return created;
  }

  private async commit(supplier: Supplier): Promise<void> {
    await this.suppliers.save(supplier);
    await this.outbox.publish(supplier.pullEvents());
  }

  private async commitProfile(profile: SupplierRiskProfile): Promise<void> {
    await this.riskProfiles.save(profile);
    await this.outbox.publish(profile.pullEvents());
  }
}
