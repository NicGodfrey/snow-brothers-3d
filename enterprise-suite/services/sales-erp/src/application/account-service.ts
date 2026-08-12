import {
  ConflictError,
  email,
  normalizePage,
  paginate,
  userId,
  type Page,
  type TenantContext,
  type Ulid,
} from "../kernel/index.js";
import { Account } from "../domain/accounts/account.js";
import { Contact } from "../domain/accounts/contact.js";
import { AccountEventTypes, accountEvent } from "../domain/accounts/events.js";
import { DocumentNumberGenerator } from "../domain/numbering.js";
import type { AccountRepository, ContactRepository, OutboxPort } from "./ports.js";
import { parse } from "./validation/validator.js";
import {
  addContactSchema,
  createAccountSchema,
  creditHoldSchema,
  creditLimitSchema,
  updateAccountSchema,
} from "./validation/account-schemas.js";

export interface ListAccountsQuery {
  page?: number;
  pageSize?: number;
  accountType?: string;
  status?: string;
  q?: string;
}

export class AccountService {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly contacts: ContactRepository,
    private readonly numbers: DocumentNumberGenerator,
    private readonly outbox: OutboxPort,
  ) {}

  create(ctx: TenantContext, input: unknown): Account {
    const cmd = parse(createAccountSchema, input);
    const account = Account.create(ctx.tenantId, {
      accountNumber: this.numbers.nextNumber(ctx.tenantId, "account"),
      name: cmd.name,
      accountType: cmd.accountType,
      currency: cmd.currency,
      paymentTerms: cmd.paymentTerms,
      industry: cmd.industry,
      website: cmd.website,
      creditLimitMinor: cmd.creditLimitMinor,
      billingAddress: cmd.billingAddress,
      shippingAddress: cmd.shippingAddress,
      ownerId: cmd.ownerId === undefined ? undefined : userId(cmd.ownerId),
    });
    this.accounts.save(account);
    this.outbox.append(account.pullEvents());
    return account;
  }

  get(ctx: TenantContext, id: Ulid): Account {
    return this.accounts.getById(ctx.tenantId, id);
  }

  list(ctx: TenantContext, query: ListAccountsQuery = {}): Page<Account> {
    let items = this.accounts.listByTenant(ctx.tenantId);
    if (query.accountType) items = items.filter((a) => a.accountType === query.accountType);
    if (query.status) items = items.filter((a) => a.status === query.status);
    if (query.q) {
      const needle = query.q.toLowerCase();
      items = items.filter(
        (a) =>
          a.name.toLowerCase().includes(needle) ||
          a.accountNumber.toLowerCase().includes(needle),
      );
    }
    items.sort((a, b) => a.accountNumber.localeCompare(b.accountNumber));
    return paginate(items, normalizePage(query));
  }

  update(ctx: TenantContext, id: Ulid, input: unknown): Account {
    const cmd = parse(updateAccountSchema, input);
    const account = this.accounts.getById(ctx.tenantId, id);
    account.updateDetails({
      ...cmd,
      ownerId: cmd.ownerId === undefined ? undefined : userId(cmd.ownerId),
    });
    this.accounts.save(account);
    this.outbox.append(account.pullEvents());
    return account;
  }

  convertToCustomer(ctx: TenantContext, id: Ulid): Account {
    const account = this.accounts.getById(ctx.tenantId, id);
    account.convertToCustomer();
    this.accounts.save(account);
    this.outbox.append(account.pullEvents());
    return account;
  }

  placeCreditHold(ctx: TenantContext, id: Ulid, input: unknown): Account {
    const cmd = parse(creditHoldSchema, input);
    const account = this.accounts.getById(ctx.tenantId, id);
    account.placeCreditHold(cmd.reason);
    this.accounts.save(account);
    this.outbox.append(account.pullEvents());
    return account;
  }

  releaseCreditHold(ctx: TenantContext, id: Ulid): Account {
    const account = this.accounts.getById(ctx.tenantId, id);
    account.releaseCreditHold();
    this.accounts.save(account);
    this.outbox.append(account.pullEvents());
    return account;
  }

  changeCreditLimit(ctx: TenantContext, id: Ulid, input: unknown): Account {
    const cmd = parse(creditLimitSchema, input);
    const account = this.accounts.getById(ctx.tenantId, id);
    account.changeCreditLimit(cmd.creditLimitMinor);
    this.accounts.save(account);
    this.outbox.append(account.pullEvents());
    return account;
  }

  close(ctx: TenantContext, id: Ulid): Account {
    const account = this.accounts.getById(ctx.tenantId, id);
    account.close();
    this.accounts.save(account);
    this.outbox.append(account.pullEvents());
    return account;
  }

  addContact(ctx: TenantContext, accountId: Ulid, input: unknown): Contact {
    const cmd = parse(addContactSchema, input);
    const account = this.accounts.getById(ctx.tenantId, accountId);
    if (account.status === "closed") {
      throw new ConflictError(`Cannot add contacts to closed account ${account.accountNumber}`);
    }
    const existing = this.contacts.listByAccount(ctx.tenantId, accountId);
    if (existing.some((c) => c.active && c.toJSON().email === email(cmd.email))) {
      throw new ConflictError(`Contact with email ${cmd.email} already exists on this account`);
    }
    const contact = Contact.create(ctx.tenantId, {
      accountId,
      firstName: cmd.firstName,
      lastName: cmd.lastName,
      email: email(cmd.email),
      phone: cmd.phone,
      role: cmd.role,
      isPrimary: cmd.isPrimary,
    });
    if (contact.isPrimary) {
      for (const other of existing) {
        if (other.isPrimary) {
          other.clearPrimary();
          this.contacts.save(other);
        }
      }
    }
    this.contacts.save(contact);
    this.outbox.append([
      accountEvent(AccountEventTypes.ContactAdded, account.id, ctx.tenantId, {
        contactId: contact.id as unknown as string,
        contactName: contact.fullName,
      }),
    ]);
    return contact;
  }

  listContacts(ctx: TenantContext, accountId: Ulid): Contact[] {
    this.accounts.getById(ctx.tenantId, accountId);
    return this.contacts.listByAccount(ctx.tenantId, accountId);
  }

  deactivateContact(ctx: TenantContext, accountId: Ulid, contactId: Ulid): Contact {
    this.accounts.getById(ctx.tenantId, accountId);
    const contact = this.contacts.getById(ctx.tenantId, contactId);
    if (contact.accountId !== accountId) {
      throw new ConflictError("Contact does not belong to this account");
    }
    contact.deactivate();
    this.contacts.save(contact);
    return contact;
  }
}
