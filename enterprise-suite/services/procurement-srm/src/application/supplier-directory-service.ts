import { NotFoundError, type TenantId, type Ulid, type Money } from "@enterprise-suite/shared-kernel";
import { code } from "../domain/common.js";
import type { SupplierScoreInput } from "../domain/quote-evaluation.js";
import {
  SupplierRecord,
  type RiskTier,
  type SupplierStatus,
} from "../domain/supplier.js";
import { commit, type EventOutbox, type SupplierDirectoryRepository } from "./ports.js";

export interface RegisterSupplierInput {
  supplierNumber: string;
  legalName: string;
  currency: string;
  displayName?: string;
  paymentTermsDays?: number;
  defaultIncoterm?: string;
  categories?: readonly string[];
  riskTier?: RiskTier;
  qualityScoreBps?: number;
  defaultLeadTimeDays?: number;
  minimumOrderValue?: Money;
  contactEmail?: string;
  status?: SupplierStatus;
  externalId?: Ulid;
}

/**
 * Maintains procurement's local view of the supplier master. `srm-core` owns
 * onboarding and qualification; anything mirrored here exists so sourcing and
 * ordering can price, score and block without a synchronous call-out.
 */
export class SupplierDirectoryService {
  constructor(
    private readonly suppliers: SupplierDirectoryRepository,
    private readonly outbox: EventOutbox,
  ) {}

  register(tenantId: TenantId, input: RegisterSupplierInput): SupplierRecord {
    const supplierNumber = code(input.supplierNumber, "supplierNumber", 24);
    const existing = this.suppliers.findByNumber(tenantId, supplierNumber);
    if (existing) return existing;
    const supplier = SupplierRecord.register(tenantId, { ...input, supplierNumber });
    return commit(this.suppliers, this.outbox, supplier);
  }

  get(tenantId: TenantId, supplierId: Ulid): SupplierRecord {
    const supplier = this.suppliers.findById(tenantId, supplierId);
    if (!supplier) throw new NotFoundError("Supplier", supplierId);
    return supplier;
  }

  getByNumber(tenantId: TenantId, supplierNumber: string): SupplierRecord {
    const supplier = this.suppliers.findByNumber(tenantId, code(supplierNumber, "supplierNumber", 24));
    if (!supplier) throw new NotFoundError("Supplier", supplierNumber);
    return supplier;
  }

  list(tenantId: TenantId, filters?: { status?: SupplierStatus; categoryCode?: string }): SupplierRecord[] {
    let results = this.suppliers.listByTenant(tenantId);
    if (filters?.status) results = results.filter((supplier) => supplier.status === filters.status);
    if (filters?.categoryCode) {
      const category = code(filters.categoryCode, "categoryCode");
      results = results.filter((supplier) => supplier.handlesCategory(category));
    }
    return results.sort((a, b) => a.supplierNumber.localeCompare(b.supplierNumber));
  }

  block(tenantId: TenantId, supplierId: Ulid, reason: string): SupplierRecord {
    const supplier = this.get(tenantId, supplierId);
    supplier.block(reason);
    return commit(this.suppliers, this.outbox, supplier);
  }

  unblock(tenantId: TenantId, supplierId: Ulid): SupplierRecord {
    const supplier = this.get(tenantId, supplierId);
    supplier.unblock();
    return commit(this.suppliers, this.outbox, supplier);
  }

  addCategory(tenantId: TenantId, supplierId: Ulid, categoryCode: string): SupplierRecord {
    const supplier = this.get(tenantId, supplierId);
    supplier.addCategory(categoryCode);
    return commit(this.suppliers, this.outbox, supplier);
  }

  /**
   * Applies a change mirrored from the supplier master. Called by the
   * integration handler for `srm.supplier.*` events as well as by the HTTP
   * sync endpoint.
   */
  syncFromMaster(
    tenantId: TenantId,
    input: {
      externalId?: Ulid;
      supplierNumber: string;
      legalName?: string;
      displayName?: string;
      status?: SupplierStatus;
      currency?: string;
      paymentTermsDays?: number;
      defaultIncoterm?: string;
      categories?: readonly string[];
      riskTier?: RiskTier;
      qualityScoreBps?: number;
      defaultLeadTimeDays?: number;
      contactEmail?: string;
      blockReason?: string;
    },
  ): SupplierRecord {
    const supplierNumber = code(input.supplierNumber, "supplierNumber", 24);
    const existing =
      (input.externalId ? this.suppliers.findByExternalId(tenantId, input.externalId) : undefined) ??
      this.suppliers.findByNumber(tenantId, supplierNumber);
    if (!existing) {
      const created = SupplierRecord.register(tenantId, {
        supplierNumber,
        legalName: input.legalName ?? supplierNumber,
        currency: input.currency ?? "USD",
        displayName: input.displayName,
        status: input.status,
        paymentTermsDays: input.paymentTermsDays,
        defaultIncoterm: input.defaultIncoterm,
        categories: input.categories,
        riskTier: input.riskTier,
        qualityScoreBps: input.qualityScoreBps,
        defaultLeadTimeDays: input.defaultLeadTimeDays,
        contactEmail: input.contactEmail,
        sourceSystem: "srm-core",
        externalId: input.externalId,
      });
      return commit(this.suppliers, this.outbox, created);
    }
    existing.syncFromMaster(input);
    return commit(this.suppliers, this.outbox, existing);
  }

  /** Scoring attributes for the quote evaluator. */
  scoreInputs(tenantId: TenantId, supplierIds: readonly Ulid[]): SupplierScoreInput[] {
    return supplierIds
      .map((supplierId) => this.suppliers.findById(tenantId, supplierId))
      .filter((supplier): supplier is SupplierRecord => supplier !== undefined)
      .map((supplier) => ({
        supplierId: supplier.id,
        displayName: supplier.displayName,
        qualityScoreBps: supplier.qualityScoreBps,
        riskTier: supplier.riskTier,
        paymentTermsDays: supplier.paymentTermsDays,
      }));
  }
}
