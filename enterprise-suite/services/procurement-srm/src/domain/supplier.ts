import {
  AggregateRoot,
  envelope,
  type Money,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import {
  code,
  currencyCode,
  incoterm,
  paymentTermsDays as validPaymentTerms,
  requiredText,
  type Incoterm,
} from "./common.js";
import { invariant, SupplierNotOrderableError, ValidationError } from "./errors.js";
import { ProcurementEvents } from "./events.js";

export type SupplierStatus = "pending" | "active" | "blocked" | "inactive";

export const SUPPLIER_STATUSES: readonly SupplierStatus[] = [
  "pending",
  "active",
  "blocked",
  "inactive",
];

export type RiskTier = "low" | "medium" | "high";

export const RISK_TIERS: readonly RiskTier[] = ["low", "medium", "high"];

export interface SupplierRecordProps {
  supplierNumber: string;
  legalName: string;
  displayName: string;
  status: SupplierStatus;
  currency: string;
  paymentTermsDays: number;
  defaultIncoterm: Incoterm;
  categories: string[];
  riskTier: RiskTier;
  /** 0-10000 bps quality score fed by quality-qms / srm-core scorecards. */
  qualityScoreBps: number;
  /** Typical lead time used to score quotes when a supplier omits one. */
  defaultLeadTimeDays: number;
  minimumOrderValue?: Money;
  contactEmail?: string;
  blockReason?: string;
  /** `srm-core` when mirrored from the supplier master, `local` when captured here. */
  sourceSystem: "srm-core" | "local";
  externalId?: Ulid;
}

/**
 * Local read model of the supplier master. `srm-core` owns onboarding,
 * qualification and compliance; procurement keeps just enough to price,
 * order and block, kept in sync through `srm.supplier.*` events.
 */
export class SupplierRecord extends AggregateRoot<SupplierRecordProps> {
  private constructor(tenantId: TenantId, props: SupplierRecordProps) {
    super(tenantId, props);
  }

  static register(
    tenantId: TenantId,
    input: {
      supplierNumber: string;
      legalName: string;
      displayName?: string;
      currency: string;
      paymentTermsDays?: number;
      defaultIncoterm?: string;
      categories?: readonly string[];
      riskTier?: RiskTier;
      qualityScoreBps?: number;
      defaultLeadTimeDays?: number;
      minimumOrderValue?: Money;
      contactEmail?: string;
      status?: SupplierStatus;
      sourceSystem?: "srm-core" | "local";
      externalId?: Ulid;
    },
  ): SupplierRecord {
    const qualityScoreBps = input.qualityScoreBps ?? 7_500;
    invariant(
      Number.isInteger(qualityScoreBps) && qualityScoreBps >= 0 && qualityScoreBps <= 10_000,
      "qualityScoreBps",
      "must be an integer within [0, 10000]",
    );
    const leadTime = input.defaultLeadTimeDays ?? 14;
    invariant(
      Number.isInteger(leadTime) && leadTime >= 0 && leadTime <= 365,
      "defaultLeadTimeDays",
      "must be an integer within [0, 365]",
    );
    const supplier = new SupplierRecord(tenantId, {
      supplierNumber: code(input.supplierNumber, "supplierNumber", 24),
      legalName: requiredText(input.legalName, "legalName", 2, 200),
      displayName: requiredText(input.displayName ?? input.legalName, "displayName", 2, 120),
      status: input.status ?? "active",
      currency: currencyCode(input.currency),
      paymentTermsDays: validPaymentTerms(input.paymentTermsDays ?? 30),
      defaultIncoterm: incoterm(input.defaultIncoterm ?? "DAP"),
      categories: (input.categories ?? []).map((c) => code(c, "categoryCode")),
      riskTier: input.riskTier ?? "medium",
      qualityScoreBps,
      defaultLeadTimeDays: leadTime,
      minimumOrderValue: input.minimumOrderValue,
      contactEmail: input.contactEmail,
      sourceSystem: input.sourceSystem ?? "local",
      externalId: input.externalId,
    });
    supplier.raise(
      envelope({
        eventType: ProcurementEvents.SupplierRegistered,
        aggregateType: "SupplierRecord",
        aggregateId: supplier.id,
        tenantId,
        payload: {
          supplierId: supplier.id,
          supplierNumber: supplier.props.supplierNumber,
          legalName: supplier.props.legalName,
          status: supplier.props.status,
          sourceSystem: supplier.props.sourceSystem,
        },
      }),
    );
    return supplier;
  }

  get supplierNumber(): string {
    return this.props.supplierNumber;
  }
  get legalName(): string {
    return this.props.legalName;
  }
  get displayName(): string {
    return this.props.displayName;
  }
  get status(): SupplierStatus {
    return this.props.status;
  }
  get currency(): string {
    return this.props.currency;
  }
  get paymentTermsDays(): number {
    return this.props.paymentTermsDays;
  }
  get defaultIncoterm(): Incoterm {
    return this.props.defaultIncoterm;
  }
  get categories(): readonly string[] {
    return this.props.categories;
  }
  get riskTier(): RiskTier {
    return this.props.riskTier;
  }
  get qualityScoreBps(): number {
    return this.props.qualityScoreBps;
  }
  get defaultLeadTimeDays(): number {
    return this.props.defaultLeadTimeDays;
  }
  get minimumOrderValue(): Money | undefined {
    return this.props.minimumOrderValue;
  }
  get blockReason(): string | undefined {
    return this.props.blockReason;
  }
  get sourceSystem(): "srm-core" | "local" {
    return this.props.sourceSystem;
  }

  handlesCategory(categoryCode: string): boolean {
    // An empty category list means "generalist supplier", not "no categories".
    return this.props.categories.length === 0 || this.props.categories.includes(categoryCode);
  }

  /** Throws unless the supplier may receive a purchase order right now. */
  assertOrderable(): void {
    if (this.props.status === "blocked") {
      throw new SupplierNotOrderableError(
        this.props.supplierNumber,
        this.props.blockReason ?? "compliance block",
      );
    }
    if (this.props.status !== "active") {
      throw new SupplierNotOrderableError(this.props.supplierNumber, `status is ${this.props.status}`);
    }
  }

  /** Sourcing invitations are allowed for pending suppliers, orders are not. */
  assertSourceable(): void {
    if (this.props.status === "blocked" || this.props.status === "inactive") {
      throw new SupplierNotOrderableError(
        this.props.supplierNumber,
        this.props.blockReason ?? `status is ${this.props.status}`,
      );
    }
  }

  assertMeetsMinimumOrderValue(orderTotal: Money): void {
    const minimum = this.props.minimumOrderValue;
    if (!minimum) return;
    if (minimum.currency !== orderTotal.currency) return;
    if (orderTotal.amountMinor < minimum.amountMinor) {
      throw new SupplierNotOrderableError(
        this.props.supplierNumber,
        `order total ${orderTotal.amountMinor} is below the minimum order value ${minimum.amountMinor} ${minimum.currency}`,
      );
    }
  }

  block(reason: string): void {
    const note = requiredText(reason, "reason", 3, 500);
    if (this.props.status === "blocked") return;
    this.props.status = "blocked";
    this.props.blockReason = note;
    this.raise(
      envelope({
        eventType: ProcurementEvents.SupplierBlocked,
        aggregateType: "SupplierRecord",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { supplierId: this.id, supplierNumber: this.props.supplierNumber, reason: note },
      }),
    );
  }

  unblock(): void {
    if (this.props.status !== "blocked") {
      throw ValidationError.single("status", `supplier is ${this.props.status}, not blocked`);
    }
    this.props.status = "active";
    this.props.blockReason = undefined;
    this.raise(
      envelope({
        eventType: ProcurementEvents.SupplierUnblocked,
        aggregateType: "SupplierRecord",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { supplierId: this.id, supplierNumber: this.props.supplierNumber },
      }),
    );
  }

  deactivate(): void {
    this.props.status = "inactive";
    this.touch();
  }

  addCategory(categoryCode: string): void {
    const normalized = code(categoryCode, "categoryCode");
    if (!this.props.categories.includes(normalized)) {
      this.props.categories.push(normalized);
      this.touch();
    }
  }

  /** Applies a partial update mirrored from the supplier master. */
  syncFromMaster(patch: {
    legalName?: string;
    displayName?: string;
    status?: SupplierStatus;
    paymentTermsDays?: number;
    defaultIncoterm?: string;
    categories?: readonly string[];
    riskTier?: RiskTier;
    qualityScoreBps?: number;
    defaultLeadTimeDays?: number;
    contactEmail?: string;
    blockReason?: string;
  }): void {
    if (patch.legalName !== undefined) {
      this.props.legalName = requiredText(patch.legalName, "legalName", 2, 200);
    }
    if (patch.displayName !== undefined) {
      this.props.displayName = requiredText(patch.displayName, "displayName", 2, 120);
    }
    if (patch.status !== undefined) this.props.status = patch.status;
    if (patch.paymentTermsDays !== undefined) {
      this.props.paymentTermsDays = validPaymentTerms(patch.paymentTermsDays);
    }
    if (patch.defaultIncoterm !== undefined) {
      this.props.defaultIncoterm = incoterm(patch.defaultIncoterm);
    }
    if (patch.categories !== undefined) {
      this.props.categories = patch.categories.map((c) => code(c, "categoryCode"));
    }
    if (patch.riskTier !== undefined) this.props.riskTier = patch.riskTier;
    if (patch.qualityScoreBps !== undefined) {
      invariant(
        Number.isInteger(patch.qualityScoreBps) &&
          patch.qualityScoreBps >= 0 &&
          patch.qualityScoreBps <= 10_000,
        "qualityScoreBps",
        "must be an integer within [0, 10000]",
      );
      this.props.qualityScoreBps = patch.qualityScoreBps;
    }
    if (patch.defaultLeadTimeDays !== undefined) {
      this.props.defaultLeadTimeDays = patch.defaultLeadTimeDays;
    }
    if (patch.contactEmail !== undefined) this.props.contactEmail = patch.contactEmail;
    if (patch.blockReason !== undefined) this.props.blockReason = patch.blockReason;
    this.props.sourceSystem = "srm-core";
    this.raise(
      envelope({
        eventType: ProcurementEvents.SupplierSynced,
        aggregateType: "SupplierRecord",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { supplierId: this.id, supplierNumber: this.props.supplierNumber, patch },
      }),
    );
  }
}
