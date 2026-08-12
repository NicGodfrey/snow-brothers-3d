import { createTenantContext, type TenantContext } from "@enterprise-suite/shared-kernel";
import { createFinanceApp, type FinanceApp } from "../../src/http/app.js";

export interface Fixture {
  app: FinanceApp;
  ctx: TenantContext;
}

export const FY = 2026;

/**
 * Boots a tenant with a realistic minimal ledger:
 * chart of accounts, 2026 calendar periods, cost centers, tax codes,
 * and control-account settings for AR/AP posting.
 */
export async function bootstrapTenant(tenant = "acme"): Promise<Fixture> {
  const app = createFinanceApp();
  const ctx = createTenantContext(tenant, "user-cfo", ["finance-admin"]);
  const { accounts, periods, costCenters, tax, settings } = app.services;

  const coa: [string, string, "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE"][] = [
    ["1000", "Cash and Bank", "ASSET"],
    ["1100", "Accounts Receivable", "ASSET"],
    ["1200", "Purchase Tax Receivable", "ASSET"],
    ["1500", "Equipment", "ASSET"],
    ["2000", "Accounts Payable", "LIABILITY"],
    ["2100", "Sales Tax Payable", "LIABILITY"],
    ["3000", "Share Capital", "EQUITY"],
    ["4000", "Product Revenue", "REVENUE"],
    ["4100", "Service Revenue", "REVENUE"],
    ["5000", "Salaries Expense", "EXPENSE"],
    ["5100", "Rent Expense", "EXPENSE"],
    ["5200", "IT Infrastructure Expense", "EXPENSE"],
  ];
  for (const [code, name, type] of coa) {
    await accounts.createAccount(ctx, { code, name, type, currency: "EUR" });
  }

  await periods.openCalendarYear(ctx, FY);

  for (const [code, name] of [
    ["OPS", "Operations"],
    ["ENG", "Engineering"],
    ["SALES", "Sales"],
    ["IT", "Central IT"],
  ]) {
    await costCenters.createCostCenter(ctx, { code, name });
  }

  await tax.createTaxCode(ctx, { code: "VAT20", name: "VAT 20%", rateBps: 2000, scope: "BOTH" });
  await tax.createTaxCode(ctx, { code: "VAT5", name: "VAT reduced 5%", rateBps: 500, scope: "BOTH" });

  await settings.configure(ctx, {
    baseCurrency: "EUR",
    arControlAccountCode: "1100",
    apControlAccountCode: "2000",
    cashAccountCode: "1000",
    salesTaxPayableAccountCode: "2100",
    purchaseTaxReceivableAccountCode: "1200",
  });

  return { app, ctx };
}

/** Posts a simple balanced two-line journal: DR debitCode / CR creditCode. */
export async function postSimpleJournal(
  fixture: Fixture,
  options: {
    date: string;
    amountMinor: number;
    debitCode: string;
    creditCode: string;
    debitCostCenter?: string;
    memo?: string;
  },
) {
  const draft = await fixture.app.services.journals.createDraft(fixture.ctx, {
    journalDate: options.date,
    currency: "EUR",
    memo: options.memo,
    lines: [
      {
        accountCode: options.debitCode,
        debitMinor: options.amountMinor,
        costCenterCode: options.debitCostCenter,
      },
      { accountCode: options.creditCode, creditMinor: options.amountMinor },
    ],
  });
  return fixture.app.services.journals.post(fixture.ctx, draft.id);
}
