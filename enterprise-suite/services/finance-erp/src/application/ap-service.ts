import {
  ConflictError,
  NotFoundError,
  type CurrencyCode,
  type TenantContext,
} from "@enterprise-suite/shared-kernel";
import { ApBill, type ApBillLineInput } from "../domain/ap-bill.js";
import { ApPayment } from "../domain/ap-payment.js";
import type { PaymentMethod } from "../domain/ar-payment.js";
import type { ApBillId, ApPaymentId, CostCenterId, TaxCodeId } from "../domain/ids.js";
import type { JournalLineCommand, JournalService } from "./journal-service.js";
import type {
  AccountRepository,
  ApBillRepository,
  ApPaymentRepository,
  TaxCodeRepository,
} from "../infrastructure/repositories.js";
import type { EventOutbox } from "../infrastructure/outbox.js";
import { expectOk } from "./service-support.js";
import type { LedgerSettingsService } from "./settings-service.js";

export interface ApBillLineCommand {
  description: string;
  quantityMilli: number;
  unitCostMinor: number;
  expenseAccountCode: string;
  costCenterId?: CostCenterId;
  taxCode?: string;
}

export interface CreateApBillCommand {
  supplierId: string;
  supplierName: string;
  supplierInvoiceRef?: string;
  currency: string;
  billDate: string;
  dueDate: string;
  lines: ApBillLineCommand[];
}

export interface IssueApPaymentCommand {
  supplierId: string;
  currency: string;
  amountMinor: number;
  paymentDate: string;
  method: PaymentMethod;
  reference?: string;
  applications?: { billId: ApBillId; amountMinor: number }[];
}

/**
 * Accounts payable subledger; the mirror image of ArService. Bill approval
 * recognizes expense + liability, payments relieve the AP control account.
 */
export class ApService {
  constructor(
    private readonly bills: ApBillRepository,
    private readonly payments: ApPaymentRepository,
    private readonly accounts: AccountRepository,
    private readonly taxCodes: TaxCodeRepository,
    private readonly settingsService: LedgerSettingsService,
    private readonly journalService: JournalService,
    private readonly outbox: EventOutbox,
  ) {}

  async createBill(ctx: TenantContext, command: CreateApBillCommand): Promise<ApBill> {
    const lines: ApBillLineInput[] = [];
    for (const line of command.lines) {
      const account = await this.accounts.findByCode(ctx.tenantId, line.expenseAccountCode);
      if (!account) throw new NotFoundError("Account", line.expenseAccountCode);
      if (account.type !== "EXPENSE" && account.type !== "ASSET") {
        throw new ConflictError(
          `account ${account.code} is ${account.type}; AP bill lines must post to EXPENSE or ASSET`,
        );
      }
      let taxCodeId: TaxCodeId | undefined;
      let taxRateBps = 0;
      if (line.taxCode) {
        const tax = await this.taxCodes.findByCode(ctx.tenantId, line.taxCode);
        if (!tax) throw new NotFoundError("TaxCode", line.taxCode);
        if (!tax.appliesTo("PURCHASE")) {
          throw new ConflictError(`tax code ${tax.code} does not apply to purchases`);
        }
        taxCodeId = tax.id;
        taxRateBps = tax.rateBps;
      }
      lines.push({
        description: line.description,
        quantityMilli: line.quantityMilli,
        unitCostMinor: line.unitCostMinor,
        expenseAccountId: account.id,
        costCenterId: line.costCenterId,
        taxCodeId,
        taxRateBps,
      });
    }

    const bill = expectOk(ApBill.create(ctx.tenantId, {
      billNo: await this.bills.nextBillNo(ctx.tenantId),
      supplierId: command.supplierId,
      supplierName: command.supplierName,
      supplierInvoiceRef: command.supplierInvoiceRef,
      currency: command.currency.toUpperCase() as CurrencyCode,
      billDate: command.billDate,
      dueDate: command.dueDate,
      lines,
    }));
    await this.bills.save(bill);
    return bill;
  }

  /**
   * Approval journal:
   *   DR  expense/asset (per line)   subtotal
   *   DR  purchase tax receivable    tax total
   *   CR  AP control                 total
   */
  async approveBill(ctx: TenantContext, billId: ApBillId): Promise<ApBill> {
    const bill = await this.getBill(ctx, billId);
    const settings = await this.settingsService.get(ctx);

    const journalLines: JournalLineCommand[] = [];
    for (const line of bill.lines) {
      journalLines.push({
        accountId: line.expenseAccountId,
        debitMinor: line.subtotalMinor,
        costCenterId: line.costCenterId,
        description: `${bill.billNo} L${line.lineNo}: ${line.description}`,
      });
    }
    if (bill.taxTotalMinor > 0) {
      journalLines.push({
        accountId: settings.purchaseTaxReceivableAccountId,
        debitMinor: bill.taxTotalMinor,
        description: `${bill.billNo} recoverable tax`,
      });
    }
    journalLines.push({
      accountId: settings.apControlAccountId,
      creditMinor: bill.totalMinor,
      description: `AP ${bill.billNo} ${bill.supplierId}`,
    });

    const journal = await this.journalService.createAndPost(ctx, {
      journalDate: bill.billDate,
      currency: bill.currency,
      source: "AP",
      memo: `AP bill ${bill.billNo}`,
      lines: journalLines,
    });

    expectOk(bill.approve(journal.id), "APPROVE_REJECTED");
    await this.bills.save(bill);
    this.outbox.publishAll(bill.pullEvents());
    return bill;
  }

  /**
   * Payment journal:
   *   DR  AP control  amount
   *   CR  cash        amount
   */
  async issuePayment(ctx: TenantContext, command: IssueApPaymentCommand): Promise<ApPayment> {
    const settings = await this.settingsService.get(ctx);
    const payment = expectOk(ApPayment.issue(ctx.tenantId, {
      paymentNo: await this.payments.nextPaymentNo(ctx.tenantId),
      supplierId: command.supplierId,
      currency: command.currency.toUpperCase() as CurrencyCode,
      amountMinor: command.amountMinor,
      paymentDate: command.paymentDate,
      method: command.method,
      reference: command.reference,
    }));

    const journal = await this.journalService.createAndPost(ctx, {
      journalDate: command.paymentDate,
      currency: payment.currency,
      source: "AP",
      memo: `AP payment ${payment.paymentNo} to ${payment.supplierId}`,
      lines: [
        {
          accountId: settings.apControlAccountId,
          debitMinor: payment.amountMinor,
          description: `Payment ${payment.paymentNo}`,
        },
        {
          accountId: settings.cashAccountId,
          creditMinor: payment.amountMinor,
          description: `Payment ${payment.paymentNo}`,
        },
      ],
    });
    payment.linkJournal(journal.id);
    await this.payments.save(payment);
    this.outbox.publishAll(payment.pullEvents());

    for (const application of command.applications ?? []) {
      await this.applyPayment(ctx, payment.id, application.billId, application.amountMinor);
    }
    return (await this.payments.findById(ctx.tenantId, payment.id))!;
  }

  async applyPayment(
    ctx: TenantContext,
    paymentId: ApPaymentId,
    billId: ApBillId,
    amountMinor: number,
  ): Promise<{ payment: ApPayment; bill: ApBill }> {
    const payment = await this.getPayment(ctx, paymentId);
    const bill = await this.getBill(ctx, billId);
    if (payment.currency !== bill.currency) {
      throw new ConflictError(
        `payment currency ${payment.currency} does not match bill currency ${bill.currency}`,
      );
    }
    if (payment.supplierId !== bill.supplierId) {
      throw new ConflictError(
        `payment ${payment.paymentNo} belongs to ${payment.supplierId}, bill to ${bill.supplierId}`,
      );
    }
    expectOk(bill.applyPayment(amountMinor), "APPLICATION_REJECTED");
    expectOk(payment.apply(billId, amountMinor), "APPLICATION_REJECTED");
    await this.bills.save(bill);
    await this.payments.save(payment);
    this.outbox.publishAll(bill.pullEvents());
    return { payment, bill };
  }

  async voidBill(ctx: TenantContext, billId: ApBillId, reason: string): Promise<ApBill> {
    const bill = await this.getBill(ctx, billId);
    const journalId = bill.journalId;
    expectOk(bill.voidBill(reason), "VOID_REJECTED");
    if (journalId) {
      await this.journalService.reverse(ctx, journalId, {
        memo: `Void AP bill ${bill.billNo}: ${reason}`,
      });
    }
    await this.bills.save(bill);
    this.outbox.publishAll(bill.pullEvents());
    return bill;
  }

  async getBill(ctx: TenantContext, id: ApBillId): Promise<ApBill> {
    const bill = await this.bills.findById(ctx.tenantId, id);
    if (!bill) throw new NotFoundError("ApBill", id);
    return bill;
  }

  async getPayment(ctx: TenantContext, id: ApPaymentId): Promise<ApPayment> {
    const payment = await this.payments.findById(ctx.tenantId, id);
    if (!payment) throw new NotFoundError("ApPayment", id);
    return payment;
  }

  async listBills(ctx: TenantContext, filter?: {
    supplierId?: string;
    status?: string;
  }): Promise<ApBill[]> {
    return this.bills.list(ctx.tenantId, filter);
  }

  async listPayments(ctx: TenantContext, filter?: { supplierId?: string }): Promise<ApPayment[]> {
    return this.payments.list(ctx.tenantId, filter);
  }

  /** Open (unpaid) AP balance per supplier. */
  async openBalanceBySupplier(ctx: TenantContext): Promise<{
    supplierId: string;
    openMinor: number;
    billCount: number;
  }[]> {
    const bills = await this.bills.list(ctx.tenantId);
    const bySupplier = new Map<string, { openMinor: number; billCount: number }>();
    for (const bill of bills) {
      if (bill.status !== "APPROVED" && bill.status !== "PARTIALLY_PAID") continue;
      const entry = bySupplier.get(bill.supplierId) ?? { openMinor: 0, billCount: 0 };
      entry.openMinor += bill.balanceMinor();
      entry.billCount += 1;
      bySupplier.set(bill.supplierId, entry);
    }
    return [...bySupplier.entries()]
      .map(([supplierId, entry]) => ({ supplierId, ...entry }))
      .sort((a, b) => b.openMinor - a.openMinor);
  }
}
