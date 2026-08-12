import {
  mulMoney,
  NotFoundError,
  normalizePage,
  type Money,
  type Page,
  type PageRequest,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import {
  Contract,
  type AddCommitmentInput,
  type AddPriceLineInput,
  type Amendment,
  type ContractType,
  type PriceLine,
  type RenewalRecord,
  type Signatory,
} from "../domain/contract.js";
import { compareDates, daysBetween, type DateOnly } from "../domain/dates.js";
import { InvalidStateError } from "../domain/errors.js";
import { SupplierRiskProfile } from "../domain/risk.js";
import type { SlaBreach, SlaCommitment } from "../domain/sla.js";
import type { Supplier } from "../domain/supplier.js";
import type {
  CategoryRepository,
  Clock,
  ContractFilter,
  ContractRepository,
  OutboxPort,
  RiskProfileRepository,
  SupplierRepository,
} from "./ports.js";

export interface DraftContractCommand {
  readonly supplierId: Ulid;
  readonly type: ContractType;
  readonly title: string;
  readonly currency?: string;
  readonly effectiveFrom?: DateOnly;
  readonly effectiveTo?: DateOnly;
  readonly autoRenew?: boolean;
  readonly renewalTermMonths?: number;
  readonly noticeDays?: number;
  readonly paymentTermsCode?: string;
  readonly incoterm?: string;
  readonly categoryIds?: readonly Ulid[];
  readonly minimumCommitmentMinor?: number;
  readonly spendCapMinor?: number;
  readonly parentContractId?: Ulid;
  readonly documentRef?: string;
}

export interface PriceQuote {
  readonly contractId: Ulid;
  readonly contractNumber: string;
  readonly priceLineId: Ulid;
  readonly unitPrice: Money;
  readonly extendedPrice: Money;
  readonly minQuantity: number;
  readonly leadTimeDays?: number;
  readonly validTo?: DateOnly;
}

export interface ContractSweepResult {
  readonly asOf: DateOnly;
  readonly expiringWarned: readonly string[];
  readonly autoRenewed: readonly string[];
  readonly expired: readonly string[];
  readonly holdsPlaced: readonly string[];
}

/**
 * Contract lifecycle use cases.
 *
 * Beyond CRUD, the service owns the cross-aggregate pieces: numbering,
 * refusing to send a contract for signature to a supplier that is not
 * trading, resolving a purchase price across every contract that covers an
 * item, and the term sweep that warns, auto-renews and expires — placing a
 * `contract_expired` hold when a category the supplier serves loses its
 * commercial cover.
 */
export class ContractService {
  constructor(
    private readonly contracts: ContractRepository,
    private readonly suppliers: SupplierRepository,
    private readonly categories: CategoryRepository,
    private readonly riskProfiles: RiskProfileRepository,
    private readonly outbox: OutboxPort,
    private readonly clock: Clock,
  ) {}

  async draft(ctx: TenantContext, command: DraftContractCommand): Promise<Contract> {
    const supplier = await this.requireSupplier(ctx, command.supplierId);
    for (const categoryId of command.categoryIds ?? []) {
      if (!(await this.categories.byId(ctx.tenantId, categoryId))) {
        throw new NotFoundError("Category", categoryId);
      }
    }
    if (command.parentContractId && !(await this.contracts.byId(ctx.tenantId, command.parentContractId))) {
      throw new NotFoundError("Contract", command.parentContractId);
    }
    const sequence = await this.contracts.nextSequence(ctx.tenantId);
    const contract = Contract.draft(ctx.tenantId, {
      ...command,
      number: `CTR-${String(sequence).padStart(5, "0")}`,
      supplierId: supplier.id,
      supplierCode: supplier.code,
      currency: command.currency ?? supplier.defaultCurrency,
      paymentTermsCode: command.paymentTermsCode ?? supplier.paymentTerms.code,
      ownerUserId: ctx.userId,
    });
    await this.commit(contract);
    return contract;
  }

  async get(ctx: TenantContext, id: Ulid): Promise<Contract> {
    const contract = await this.contracts.byId(ctx.tenantId, id);
    if (!contract) throw new NotFoundError("Contract", id);
    return contract;
  }

  async list(ctx: TenantContext, filter: ContractFilter, page?: Partial<PageRequest>): Promise<Page<Contract>> {
    return this.contracts.list(ctx.tenantId, filter, normalizePage(page));
  }

  async addSignatory(ctx: TenantContext, id: Ulid, input: Parameters<Contract["addSignatory"]>[0]): Promise<Signatory> {
    const contract = await this.get(ctx, id);
    const signatory = contract.addSignatory(input);
    await this.commit(contract);
    return signatory;
  }

  /** A supplier that cannot trade cannot be put under contract either. */
  async sendForSignature(ctx: TenantContext, id: Ulid): Promise<Contract> {
    const contract = await this.get(ctx, id);
    const supplier = await this.requireSupplier(ctx, contract.supplierId);
    if (supplier.status === "blocked" || supplier.status === "inactive" || supplier.status === "rejected") {
      throw new InvalidStateError(
        `Supplier ${supplier.code} is ${supplier.status}; contracts cannot be executed with them`,
      );
    }
    contract.sendForSignature();
    await this.commit(contract);
    return contract;
  }

  async sign(ctx: TenantContext, id: Ulid, signatoryId: Ulid): Promise<Contract> {
    const contract = await this.get(ctx, id);
    contract.sign(signatoryId, this.clock.now(), this.clock.today());
    await this.commit(contract);
    return contract;
  }

  async activate(ctx: TenantContext, id: Ulid): Promise<Contract> {
    const contract = await this.get(ctx, id);
    contract.activate(this.clock.now());
    await this.commit(contract);
    // Cover restored: lift any hold placed when the previous term lapsed.
    const profile = await this.riskProfiles.bySupplier(ctx.tenantId, contract.supplierId);
    if (profile) {
      const released = profile.releaseHoldsBySourceRef(
        `contract-cover:${contract.supplierId}`,
        ctx.userId,
        `Contract ${contract.number} activated`,
        this.clock.today(),
      );
      if (released.length > 0) await this.commitProfile(profile);
    }
    return contract;
  }

  async addPriceLine(ctx: TenantContext, id: Ulid, input: AddPriceLineInput): Promise<PriceLine> {
    const contract = await this.get(ctx, id);
    const line = contract.addPriceLine(input);
    await this.commit(contract);
    return line;
  }

  async expirePriceLine(ctx: TenantContext, id: Ulid, lineId: Ulid, validTo: DateOnly): Promise<PriceLine> {
    const contract = await this.get(ctx, id);
    const line = contract.expirePriceLine(lineId, validTo);
    await this.commit(contract);
    return line;
  }

  async addCommitment(ctx: TenantContext, id: Ulid, input: AddCommitmentInput): Promise<SlaCommitment> {
    const contract = await this.get(ctx, id);
    const commitment = contract.addCommitment(input);
    await this.commit(contract);
    return commitment;
  }

  async recordSlaResult(
    ctx: TenantContext,
    id: Ulid,
    input: { commitmentId: Ulid; periodCode: string; measured: number; periodSpendMinor?: number; note?: string },
  ): Promise<SlaBreach | undefined> {
    const contract = await this.get(ctx, id);
    const breach = contract.recordSlaResult({ ...input, recordedOn: this.clock.today() });
    await this.commit(contract);
    return breach;
  }

  async acknowledgeBreach(ctx: TenantContext, id: Ulid, breachId: Ulid, note?: string): Promise<SlaBreach> {
    const contract = await this.get(ctx, id);
    const breach = contract.acknowledgeBreach(breachId, note);
    await this.commit(contract);
    return breach;
  }

  async creditBreach(ctx: TenantContext, id: Ulid, breachId: Ulid, note?: string): Promise<SlaBreach> {
    const contract = await this.get(ctx, id);
    const breach = contract.creditBreach(breachId, this.clock.today(), note);
    await this.commit(contract);
    return breach;
  }

  async waiveBreach(ctx: TenantContext, id: Ulid, breachId: Ulid, reason: string): Promise<SlaBreach> {
    const contract = await this.get(ctx, id);
    const breach = contract.waiveBreach(breachId, reason, this.clock.today());
    await this.commit(contract);
    return breach;
  }

  async amend(
    ctx: TenantContext,
    id: Ulid,
    changeNote: string,
    patch: Parameters<Contract["amend"]>[3] = {},
  ): Promise<Amendment> {
    const contract = await this.get(ctx, id);
    const amendment = contract.amend(ctx.userId, this.clock.now(), changeNote, patch);
    await this.commit(contract);
    return amendment;
  }

  async renew(ctx: TenantContext, id: Ulid, termMonths?: number): Promise<RenewalRecord> {
    const contract = await this.get(ctx, id);
    const record = contract.renew(this.clock.now(), { automatic: false, termMonths });
    await this.commit(contract);
    return record;
  }

  async terminate(
    ctx: TenantContext,
    id: Ulid,
    input: { reason: string; terminationDate: DateOnly; waiveNotice?: boolean },
  ): Promise<Contract> {
    const contract = await this.get(ctx, id);
    contract.terminate(ctx.userId, this.clock.now(), { ...input, asOf: this.clock.today() });
    await this.commit(contract);
    return contract;
  }

  /** Replaces a contract with its successor, keeping the audit chain. */
  async supersede(ctx: TenantContext, id: Ulid, successorContractId: Ulid): Promise<Contract> {
    const contract = await this.get(ctx, id);
    const successor = await this.get(ctx, successorContractId);
    if (successor.supplierId !== contract.supplierId) {
      throw new InvalidStateError(`Contract ${successor.number} belongs to a different supplier`);
    }
    contract.supersede(successor.id, this.clock.today());
    await this.commit(contract);
    return contract;
  }

  // --- pricing -------------------------------------------------------------

  /**
   * Best contracted price for a quantity on a date, across every active
   * contract of the supplier. Ties are broken by the tighter quantity break,
   * which is the tier a buyer would actually quote.
   */
  async quote(
    ctx: TenantContext,
    supplierId: Ulid,
    lookup: { itemCode?: string; categoryId?: Ulid; quantity: number; asOf?: DateOnly },
  ): Promise<PriceQuote | undefined> {
    const asOf = lookup.asOf ?? this.clock.today();
    const contracts = await this.contracts.bySupplier(ctx.tenantId, supplierId);
    const candidates: PriceQuote[] = [];
    for (const contract of contracts) {
      if (!contract.isEffectiveOn(asOf)) continue;
      if (lookup.categoryId && !contract.coversCategory(lookup.categoryId)) continue;
      const line = contract.priceFor({ ...lookup, asOf });
      if (!line) continue;
      candidates.push({
        contractId: contract.id,
        contractNumber: contract.number,
        priceLineId: line.id,
        unitPrice: line.unitPrice,
        extendedPrice: mulMoney(line.unitPrice, lookup.quantity),
        minQuantity: line.minQuantity,
        leadTimeDays: line.leadTimeDays,
        validTo: line.validTo,
      });
    }
    return candidates.sort(
      (a, b) => a.unitPrice.amountMinor - b.unitPrice.amountMinor || b.minQuantity - a.minQuantity,
    )[0];
  }

  // --- term sweep ----------------------------------------------------------

  /**
   * Nightly job over the contract book: warn inside the notice horizon,
   * auto-renew what is set to renew, expire the rest — and when expiry leaves
   * a category the supplier is approved in without cover, hold sourcing there.
   */
  async runTermSweep(ctx: TenantContext, horizonDays = 60): Promise<ContractSweepResult> {
    const asOf = this.clock.today();
    const now = this.clock.now();
    const expiringWarned: string[] = [];
    const autoRenewed: string[] = [];
    const expired: string[] = [];
    const holdsPlaced: string[] = [];

    for (const contract of await this.contracts.all(ctx.tenantId)) {
      if (contract.status !== "active") continue;
      let touched = false;

      if (contract.warnExpiring(asOf, now, horizonDays)) {
        expiringWarned.push(contract.number);
        touched = true;
      }
      const remaining = contract.daysToExpiry(asOf);
      // Auto-renew as the term closes rather than after it lapses, so cover
      // is never interrupted.
      if (contract.autoRenew && remaining !== undefined && remaining >= 0 && remaining <= horizonDays) {
        contract.renew(now, { automatic: true });
        autoRenewed.push(contract.number);
        touched = true;
      } else if (contract.expireIfDue(asOf)) {
        expired.push(contract.number);
        touched = true;
      }
      if (touched) await this.commit(contract);
    }

    for (const number of expired) {
      const contract = await this.contracts.byNumber(ctx.tenantId, number);
      if (contract) {
        const placed = await this.holdUncoveredCategories(ctx, contract);
        holdsPlaced.push(...placed);
      }
    }

    return { asOf, expiringWarned, autoRenewed, expired, holdsPlaced };
  }

  /** Contracts whose term ends inside the horizon, soonest first. */
  async expiringSoon(ctx: TenantContext, withinDays = 90): Promise<readonly Contract[]> {
    const asOf = this.clock.today();
    const all = await this.contracts.all(ctx.tenantId);
    return all
      .filter((contract) => contract.status === "active" && contract.effectiveTo !== undefined)
      .filter((contract) => {
        const remaining = daysBetween(asOf, contract.effectiveTo!);
        return remaining >= 0 && remaining <= withinDays;
      })
      .sort((a, b) => compareDates(a.effectiveTo!, b.effectiveTo!));
  }

  private async holdUncoveredCategories(ctx: TenantContext, expiredContract: Contract): Promise<readonly string[]> {
    const supplier = await this.suppliers.byId(ctx.tenantId, expiredContract.supplierId);
    if (!supplier) return [];
    const asOf = this.clock.today();
    const contracts = await this.contracts.bySupplier(ctx.tenantId, supplier.id);
    const stillCovered = (categoryId: Ulid) =>
      contracts.some((contract) => contract.isEffectiveOn(asOf) && contract.coversCategory(categoryId));
    const uncovered = supplier
      .approvedCategoryIds()
      .filter((categoryId) => expiredContract.coversCategory(categoryId) && !stillCovered(categoryId));
    if (uncovered.length === 0) return [];

    const profile = await this.requireProfile(ctx, supplier);
    const sourceRef = `contract-cover:${supplier.id}`;
    if (profile.activeHolds().some((hold) => hold.sourceRef === sourceRef)) return [];
    profile.placeHold(
      {
        type: "sourcing",
        reasonCode: "contract_expired",
        scope: "categories",
        categoryIds: uncovered,
        placedOn: asOf,
        note: `Contract ${expiredContract.number} expired and no active contract covers these categories`,
        releaseRoles: ["srm.category-manager"],
        sourceRef,
      },
      ctx.userId,
      this.clock.now(),
    );
    await this.commitProfile(profile);
    return [expiredContract.number];
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

  private async commit(contract: Contract): Promise<void> {
    await this.contracts.save(contract);
    await this.outbox.publish(contract.pullEvents());
  }

  private async commitProfile(profile: SupplierRiskProfile): Promise<void> {
    await this.riskProfiles.save(profile);
    await this.outbox.publish(profile.pullEvents());
  }
}
