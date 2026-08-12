import {
  ConflictError,
  NotFoundError,
  normalizePage,
  type Money,
  type Page,
  type PageRequest,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import type { AddressInput } from "../domain/address.js";
import { moneyFromMinor, requireCurrency } from "../domain/currency.js";
import {
  Customer,
  type CommercialTerms,
  type ContactRole,
  type CreateCustomerInput,
  type CustomerContact,
  type CustomerStatus,
} from "../domain/customer.js";
import { InvalidStateError, ValidationError } from "../domain/errors.js";
import type { IdentifierScheme, PartyIdentifier } from "../domain/identifiers.js";
import {
  DEFAULT_THRESHOLDS,
  mergeConflicts,
  rankMatches,
  scoreMatch,
  type FieldConflict,
  type MatchCandidate,
  type MatchProfile,
  type MatchScore,
  type MatchThresholds,
} from "../domain/matching.js";
import type { Site } from "../domain/site.js";
import type { CodeListService } from "./code-list-service.js";
import type { CurrencyService } from "./currency-service.js";
import type { PaymentTermService } from "./payment-term-service.js";
import type { ShippingTermService } from "./shipping-term-service.js";
import type {
  Clock,
  CustomerFilter,
  CustomerRepository,
  OutboxPort,
  SiteRepository,
} from "./ports.js";

export interface CreateCustomerCommand extends Omit<CreateCustomerInput, "number" | "registeredAddress"> {
  /** Omit to mint the next number in the tenant's sequence. */
  readonly number?: string;
  readonly registeredAddress: AddressInput;
  /** Refuses creation when an existing record scores as a duplicate. */
  readonly rejectDuplicates?: boolean;
}

export interface CustomerHierarchyNode {
  readonly customer: Customer;
  readonly children: readonly CustomerHierarchyNode[];
}

export interface MergePlan {
  readonly survivor: Customer;
  readonly duplicate: Customer;
  readonly score: MatchScore;
  readonly conflicts: readonly FieldConflict[];
  readonly sitesToMove: readonly Site[];
  readonly identifiersToMove: readonly PartyIdentifier[];
  readonly contactsToMove: readonly CustomerContact[];
}

export interface MergeResult {
  readonly survivor: Customer;
  readonly merged: Customer;
  readonly movedSites: number;
  readonly movedIdentifiers: number;
  readonly movedContacts: number;
  readonly renamedSiteCodes: readonly string[];
}

export const CUSTOMER_NUMBER_PREFIX = "C";

export function formatCustomerNumber(sequence: number, prefix = CUSTOMER_NUMBER_PREFIX): string {
  return `${prefix}-${String(sequence).padStart(6, "0")}`;
}

/**
 * Customer master use cases.
 *
 * The service owns everything the aggregate cannot see on its own: number
 * minting, tenant-wide uniqueness of numbers and registration identifiers,
 * cross-aggregate validation against the term catalogs and code lists,
 * hierarchy cycle prevention, duplicate detection and merges.
 */
export class CustomerService {
  constructor(
    private readonly customers: CustomerRepository,
    private readonly sites: SiteRepository,
    private readonly currencies: CurrencyService,
    private readonly paymentTerms: PaymentTermService,
    private readonly shippingTerms: ShippingTermService,
    private readonly codeLists: CodeListService,
    private readonly outbox: OutboxPort,
    private readonly clock: Clock,
  ) {}

  async create(ctx: TenantContext, command: CreateCustomerCommand): Promise<Customer> {
    const currency = String(requireCurrency(command.currency ?? "USD").code);
    await this.assertCurrencyUsable(ctx, currency);

    const number = command.number ? command.number.trim().toUpperCase() : await this.mintNumber(ctx);
    if (await this.customers.byNumber(ctx.tenantId, number)) {
      throw new ConflictError(`Customer number "${number}" already exists`);
    }
    if (command.parentId && !(await this.customers.byId(ctx.tenantId, command.parentId))) {
      throw new NotFoundError("Customer", command.parentId);
    }
    await this.assertCodeIfPresent(ctx, "industry", command.industryCode);
    await this.assertCodeIfPresent(ctx, "customer_segment", command.segmentCode);
    await this.assertCodeIfPresent(ctx, "tax_category", command.taxCategoryCode);

    const customer = Customer.create(ctx.tenantId, { ...command, number, currency });

    if (command.rejectDuplicates) {
      const duplicates = await this.findDuplicates(ctx, this.profileOf(customer));
      const blocking = duplicates.find((candidate) => candidate.score.decision === "duplicate");
      if (blocking) {
        throw new ConflictError(
          `"${customer.legalName}" duplicates ${blocking.record.number} (${blocking.record.legalName}): ${blocking.score.signals
            .map((signal) => signal.detail)
            .join("; ")}`,
        );
      }
    }
    await this.commit(customer);
    return customer;
  }

  async get(ctx: TenantContext, id: Ulid): Promise<Customer> {
    const customer = await this.customers.byId(ctx.tenantId, id);
    if (!customer) throw new NotFoundError("Customer", id);
    return customer;
  }

  async getByNumber(ctx: TenantContext, number: string): Promise<Customer> {
    const customer = await this.customers.byNumber(ctx.tenantId, number.trim().toUpperCase());
    if (!customer) throw new NotFoundError("Customer", number);
    return customer;
  }

  /**
   * Resolves an id through merge history to the surviving record, so callers
   * holding an old id keep working after a merge.
   */
  async resolve(ctx: TenantContext, id: Ulid): Promise<Customer> {
    let customer = await this.get(ctx, id);
    const seen = new Set<string>([String(customer.id)]);
    while (customer.mergedIntoId) {
      if (seen.has(String(customer.mergedIntoId))) {
        throw new InvalidStateError(`Merge chain for customer ${id} is circular`);
      }
      seen.add(String(customer.mergedIntoId));
      customer = await this.get(ctx, customer.mergedIntoId);
    }
    return customer;
  }

  async list(
    ctx: TenantContext,
    filter: CustomerFilter = {},
    page?: Partial<PageRequest>,
  ): Promise<Page<Customer>> {
    return this.customers.list(ctx.tenantId, filter, normalizePage(page));
  }

  async updateProfile(
    ctx: TenantContext,
    id: Ulid,
    patch: Parameters<Customer["updateProfile"]>[0],
  ): Promise<Customer> {
    const customer = await this.get(ctx, id);
    await this.assertCodeIfPresent(ctx, "industry", patch.industryCode ?? undefined);
    await this.assertCodeIfPresent(ctx, "customer_segment", patch.segmentCode ?? undefined);
    await this.assertCodeIfPresent(ctx, "tax_category", patch.taxCategoryCode ?? undefined);
    customer.updateProfile(patch);
    await this.commit(customer);
    return customer;
  }

  /**
   * Moves a customer through its status machine. `reasonCode`, when given, is
   * checked against the governed `block_reason` list; free-text `reason` is
   * kept for the audit trail.
   */
  async changeStatus(
    ctx: TenantContext,
    id: Ulid,
    to: CustomerStatus,
    reason?: string,
    reasonCode?: string,
  ): Promise<Customer> {
    const customer = await this.get(ctx, id);
    await this.assertCodeIfPresent(ctx, "block_reason", reasonCode);
    const narrative = reasonCode ? `${reasonCode}: ${reason ?? ""}`.trim() : reason;
    customer.changeStatus(to, ctx.userId, narrative);
    await this.commit(customer);
    return customer;
  }

  async addIdentifier(
    ctx: TenantContext,
    id: Ulid,
    identifier: PartyIdentifier,
  ): Promise<PartyIdentifier> {
    const customer = await this.get(ctx, id);
    const added = customer.addIdentifier(identifier, this.clock.now());
    const holder = await this.customers.byIdentifier(ctx.tenantId, added.scheme, added.value);
    if (holder && holder.id !== customer.id) {
      throw new ConflictError(
        `${added.scheme} ${added.value} is already registered to ${holder.number} (${holder.legalName})`,
      );
    }
    await this.commit(customer);
    return added;
  }

  async removeIdentifier(
    ctx: TenantContext,
    id: Ulid,
    scheme: IdentifierScheme,
    value: string,
  ): Promise<Customer> {
    const customer = await this.get(ctx, id);
    customer.removeIdentifier(scheme, value);
    await this.commit(customer);
    return customer;
  }

  async addContact(
    ctx: TenantContext,
    id: Ulid,
    input: {
      readonly name: string;
      readonly email?: string;
      readonly phone?: string;
      readonly jobTitle?: string;
      readonly roles?: readonly ContactRole[];
      readonly siteId?: Ulid;
    },
  ): Promise<CustomerContact> {
    const customer = await this.get(ctx, id);
    if (input.siteId) {
      const site = await this.sites.byId(ctx.tenantId, input.siteId);
      if (!site) throw new NotFoundError("Site", input.siteId);
      if (site.customerId !== customer.id) {
        throw new ValidationError(`Site ${site.code} belongs to another customer`);
      }
    }
    const contact = customer.addContact({ ...input, at: this.clock.now() });
    await this.commit(customer);
    return contact;
  }

  async removeContact(ctx: TenantContext, id: Ulid, contactId: Ulid): Promise<Customer> {
    const customer = await this.get(ctx, id);
    customer.removeContact(contactId);
    await this.commit(customer);
    return customer;
  }

  /** Assigns commercial defaults, checking the codes against the catalogs. */
  async assignTerms(ctx: TenantContext, id: Ulid, terms: CommercialTerms): Promise<Customer> {
    const customer = await this.get(ctx, id);
    if (terms.paymentTermCode) {
      const term = await this.paymentTerms.get(ctx, terms.paymentTermCode);
      if (!term.active) {
        throw new InvalidStateError(`Payment term ${term.code} is retired and cannot be assigned`);
      }
    }
    if (terms.shippingTermCode) {
      const term = await this.shippingTerms.get(ctx, terms.shippingTermCode);
      if (!term.active) {
        throw new InvalidStateError(`Shipping term ${term.code} is retired and cannot be assigned`);
      }
    }
    customer.assignTerms(terms);
    await this.commit(customer);
    return customer;
  }

  async setCreditLimit(
    ctx: TenantContext,
    id: Ulid,
    limit: Money | { readonly amountMinor: number; readonly currency: string },
    riskRating?: string,
  ): Promise<Customer> {
    const customer = await this.get(ctx, id);
    const money =
      "amountMinor" in limit && typeof limit.currency === "string"
        ? moneyFromMinor(limit.amountMinor, String(limit.currency))
        : (limit as Money);
    customer.setCreditLimit(money, ctx.userId, this.clock.now(), riskRating);
    await this.commit(customer);
    return customer;
  }

  /** Re-parents a customer, refusing anything that would create a cycle. */
  async setParent(ctx: TenantContext, id: Ulid, parentId: Ulid | undefined): Promise<Customer> {
    const customer = await this.get(ctx, id);
    if (parentId) {
      const parent = await this.get(ctx, parentId);
      const ancestors = await this.ancestors(ctx, parent.id);
      if (parent.id === customer.id || ancestors.some((a) => a.id === customer.id)) {
        throw new InvalidStateError(
          `Setting ${parent.number} as parent of ${customer.number} would create a cycle`,
        );
      }
    }
    customer.setParent(parentId);
    await this.commit(customer);
    return customer;
  }

  /** Chain from the immediate parent up to the root. */
  async ancestors(ctx: TenantContext, id: Ulid): Promise<readonly Customer[]> {
    const chain: Customer[] = [];
    const seen = new Set<string>([String(id)]);
    let cursor = await this.get(ctx, id);
    while (cursor.parentId) {
      if (seen.has(String(cursor.parentId))) break;
      seen.add(String(cursor.parentId));
      cursor = await this.get(ctx, cursor.parentId);
      chain.push(cursor);
    }
    return chain;
  }

  async hierarchy(ctx: TenantContext, rootId: Ulid): Promise<CustomerHierarchyNode> {
    const root = await this.get(ctx, rootId);
    const all = await this.customers.all(ctx.tenantId);
    const childrenOf = new Map<string, Customer[]>();
    for (const customer of all) {
      if (!customer.parentId) continue;
      const bucket = childrenOf.get(String(customer.parentId)) ?? [];
      bucket.push(customer);
      childrenOf.set(String(customer.parentId), bucket);
    }
    const build = (customer: Customer, depth: number): CustomerHierarchyNode => ({
      customer,
      children:
        depth > 32
          ? []
          : (childrenOf.get(String(customer.id)) ?? [])
              .sort((a, b) => a.number.localeCompare(b.number))
              .map((child) => build(child, depth + 1)),
    });
    return build(root, 0);
  }

  /** Projection used by the matcher; also useful to integrations. */
  profileOf(customer: Customer): MatchProfile {
    return {
      id: String(customer.id),
      legalName: customer.legalName,
      tradingName: customer.tradingName,
      identifiers: customer.identifiers,
      address: customer.registeredAddress,
      emailDomains: customer.contacts
        .map((contact) => contact.email?.split("@")[1])
        .filter((domain): domain is string => Boolean(domain)),
    };
  }

  /** Ranks existing customers against a profile, ignoring merged records. */
  async findDuplicates(
    ctx: TenantContext,
    probe: MatchProfile,
    thresholds: MatchThresholds = DEFAULT_THRESHOLDS,
  ): Promise<readonly MatchCandidate<Customer>[]> {
    const candidates = (await this.customers.all(ctx.tenantId)).filter(
      (customer) => customer.status !== "merged" && String(customer.id) !== probe.id,
    );
    return rankMatches(probe, candidates, (customer) => this.profileOf(customer), thresholds);
  }

  async duplicatesOf(ctx: TenantContext, id: Ulid): Promise<readonly MatchCandidate<Customer>[]> {
    return this.findDuplicates(ctx, this.profileOf(await this.get(ctx, id)));
  }

  /** Dry run of a merge: what would move and what disagrees. */
  async planMerge(ctx: TenantContext, survivorId: Ulid, duplicateId: Ulid): Promise<MergePlan> {
    const survivor = await this.get(ctx, survivorId);
    const duplicate = await this.get(ctx, duplicateId);
    if (survivor.id === duplicate.id) {
      throw new InvalidStateError("A customer cannot be merged into itself");
    }
    const survivorIdentifiers = new Set(survivor.identifiers.map((i) => `${i.scheme}:${i.value}`));
    return {
      survivor,
      duplicate,
      score: scoreMatch(this.profileOf(survivor), this.profileOf(duplicate)),
      conflicts: mergeConflicts(this.profileOf(survivor), this.profileOf(duplicate)),
      sitesToMove: await this.sites.forCustomer(ctx.tenantId, duplicate.id),
      identifiersToMove: duplicate.identifiers.filter(
        (identifier) => !survivorIdentifiers.has(`${identifier.scheme}:${identifier.value}`),
      ),
      contactsToMove: [...duplicate.contacts],
    };
  }

  /**
   * Merges a duplicate into a survivor.
   *
   * Sites move across (with a code suffix when the survivor already uses that
   * code), identifiers and contacts the survivor lacks are copied, external
   * ids are folded in without overwriting the survivor's, and the loser is
   * marked merged so `resolve` can forward its id forever.
   */
  async merge(ctx: TenantContext, survivorId: Ulid, duplicateId: Ulid): Promise<MergeResult> {
    const plan = await this.planMerge(ctx, survivorId, duplicateId);
    const { survivor, duplicate } = plan;
    if (duplicate.status === "merged") {
      throw new InvalidStateError(`Customer ${duplicate.number} was already merged`);
    }
    if (survivor.status === "merged") {
      throw new InvalidStateError(`Customer ${survivor.number} is itself merged; merge into its survivor`);
    }

    const survivorSites = await this.sites.forCustomer(ctx.tenantId, survivor.id);
    const takenCodes = new Set(survivorSites.map((site) => site.code));
    const renamedSiteCodes: string[] = [];
    for (const site of plan.sitesToMove) {
      if (takenCodes.has(site.code)) {
        const renamed = `${site.code}-${duplicate.number}`.slice(0, 32);
        renamedSiteCodes.push(`${site.code} -> ${renamed}`);
        site.recode(renamed);
      }
      takenCodes.add(site.code);
      site.reassignTo(survivor.id);
      await this.sites.save(site);
    }

    for (const identifier of plan.identifiersToMove) {
      survivor.addIdentifier(identifier, this.clock.now());
    }
    for (const contact of plan.contactsToMove) {
      survivor.addContact({
        name: contact.name,
        email: contact.email,
        phone: contact.phone,
        jobTitle: contact.jobTitle,
        // The survivor keeps its own primary contact.
        roles: contact.roles.filter((role) => role !== "primary"),
        at: this.clock.now(),
      });
    }
    for (const [system, value] of Object.entries(duplicate.externalIds)) {
      if (!(system in survivor.externalIds)) survivor.setExternalId(system, value);
    }

    duplicate.markMerged(survivor.id, ctx.userId, {
      sites: plan.sitesToMove.length,
      identifiers: plan.identifiersToMove.length,
    });

    await this.commit(survivor);
    await this.commit(duplicate);

    return {
      survivor,
      merged: duplicate,
      movedSites: plan.sitesToMove.length,
      movedIdentifiers: plan.identifiersToMove.length,
      movedContacts: plan.contactsToMove.length,
      renamedSiteCodes,
    };
  }

  /**
   * Mints the next free number. Migrated records keep their legacy numbers, so
   * the sequence can land on one that is already taken; skipping those is
   * better than failing a create that never asked for a specific number.
   */
  private async mintNumber(ctx: TenantContext): Promise<string> {
    for (let attempt = 0; attempt < 10_000; attempt += 1) {
      const candidate = formatCustomerNumber(await this.customers.nextSequence(ctx.tenantId));
      if (!(await this.customers.byNumber(ctx.tenantId, candidate))) return candidate;
    }
    throw new ConflictError("Exhausted the customer number sequence without finding a free number");
  }

  /**
   * Currency must be ISO and, once a tenant configures its currencies, one of
   * the enabled ones. Tenants that have not configured any are still being
   * bootstrapped, so the check is skipped rather than blocking setup.
   */
  private async assertCurrencyUsable(ctx: TenantContext, code: string): Promise<void> {
    const configured = await this.currencies.listEnabled(ctx);
    if (configured.length === 0) return;
    await this.currencies.assertEnabled(ctx, code);
  }

  private async assertCodeIfPresent(
    ctx: TenantContext,
    listCode: string,
    code: string | undefined,
  ): Promise<void> {
    if (!code) return;
    try {
      await this.codeLists.validateCode(ctx, listCode, code);
    } catch (error) {
      // A tenant that does not maintain this list should not be blocked by it.
      if ((error as { code?: string }).code === "NOT_FOUND") return;
      throw error;
    }
  }

  private async commit(customer: Customer): Promise<void> {
    await this.customers.save(customer);
    const events = customer.pullEvents();
    if (events.length > 0) await this.outbox.publish(events);
  }
}
