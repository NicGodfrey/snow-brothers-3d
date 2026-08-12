import { count, days } from "../../api/module-api.js";
import type {
  JournalDto,
  PayableDto,
  PeriodDto,
  ReceivableDto,
} from "../../api/finance.js";
import {
  amount,
  dateOnly,
  docNumber,
  resource,
  type FixtureBuilder,
} from "./types.js";

export const buildFinanceFixture: FixtureBuilder = (ctx) => {
  const receivables: ReceivableDto[] = [
    {
      id: "ar-1",
      invoiceNumber: docNumber(ctx, "INV", 1),
      customerId: "cus-initech",
      customerName: "Initech Systems",
      status: "open",
      issuedOn: dateOnly(ctx, -95),
      dueOn: dateOnly(ctx, -65),
      ageingBucket: "61-90",
      amount: amount(ctx, 82_400_00),
      outstanding: amount(ctx, 82_400_00),
    },
    {
      id: "ar-2",
      invoiceNumber: docNumber(ctx, "INV", 2),
      customerId: "cus-hooli",
      customerName: "Hooli Labs",
      status: "part-paid",
      issuedOn: dateOnly(ctx, -50),
      dueOn: dateOnly(ctx, -20),
      ageingBucket: "1-30",
      amount: amount(ctx, 120_000_00),
      outstanding: amount(ctx, 48_770_00),
    },
    {
      id: "ar-3",
      invoiceNumber: docNumber(ctx, "INV", 3),
      customerId: "cus-northwind",
      customerName: "Northwind Traders",
      status: "open",
      issuedOn: dateOnly(ctx, -12),
      dueOn: dateOnly(ctx, 18),
      ageingBucket: "current",
      amount: amount(ctx, 41_300_00),
      outstanding: amount(ctx, 41_300_00),
    },
    {
      id: "ar-4",
      invoiceNumber: docNumber(ctx, "INV", 4),
      customerId: "cus-umbrella",
      customerName: "Umbrella Retail",
      status: "paid",
      issuedOn: dateOnly(ctx, -40),
      dueOn: dateOnly(ctx, -10),
      ageingBucket: "current",
      amount: amount(ctx, 9_915_00),
      outstanding: amount(ctx, 0),
    },
    {
      id: "ar-5",
      invoiceNumber: docNumber(ctx, "INV", 5),
      customerId: "cus-initech",
      customerName: "Initech Systems",
      status: "open",
      issuedOn: dateOnly(ctx, -130),
      dueOn: dateOnly(ctx, -100),
      ageingBucket: "90+",
      amount: amount(ctx, 24_600_00),
      outstanding: amount(ctx, 24_600_00),
    },
  ];

  const payables: PayableDto[] = [
    {
      id: "ap-1",
      invoiceNumber: "KRAFT-99812",
      supplierId: "sup-kraft",
      supplierName: "Kraftwerk Components",
      status: "open",
      dueOn: dateOnly(ctx, 6),
      amount: amount(ctx, 33_660_00),
      outstanding: amount(ctx, 33_660_00),
      purchaseOrderId: "po-2043",
      discountIfPaidBy: dateOnly(ctx, 1),
    },
    {
      id: "ap-2",
      invoiceNumber: "TOKEI-4471",
      supplierId: "sup-tokei",
      supplierName: "Tokei Precision",
      status: "open",
      dueOn: dateOnly(ctx, 21),
      amount: amount(ctx, 28_800_00),
      outstanding: amount(ctx, 28_800_00),
      purchaseOrderId: "po-2044",
    },
    {
      id: "ap-3",
      invoiceNumber: "NWOOD-2201",
      supplierId: "sup-northwood",
      supplierName: "Northwood Timber",
      status: "part-paid",
      dueOn: dateOnly(ctx, -4),
      amount: amount(ctx, 14_400_00),
      outstanding: amount(ctx, 7_200_00),
      purchaseOrderId: "po-2045",
    },
  ];

  const journals: JournalDto[] = [
    {
      id: "jrn-1",
      reference: docNumber(ctx, "JE", 1),
      period: "2026-02",
      status: "draft",
      preparedBy: "u-rin",
      total: amount(ctx, 12_500_00),
    },
    {
      id: "jrn-2",
      reference: docNumber(ctx, "JE", 2),
      period: "2026-02",
      status: "draft",
      preparedBy: "u-rin",
      total: amount(ctx, 3_180_00),
    },
    {
      id: "jrn-3",
      reference: docNumber(ctx, "JE", 3),
      period: "2026-01",
      status: "posted",
      postedOn: dateOnly(ctx, -32),
      preparedBy: "u-rin",
      total: amount(ctx, 96_400_00),
    },
    {
      id: "jrn-4",
      reference: docNumber(ctx, "JE", 4),
      period: "2026-01",
      status: "reversed",
      postedOn: dateOnly(ctx, -30),
      preparedBy: "u-rin",
      total: amount(ctx, 1_050_00),
    },
  ];

  const periods: PeriodDto[] = [
    {
      id: "per-2026-01",
      code: "2026-01",
      status: "closed",
      startsOn: "2026-01-01",
      endsOn: "2026-01-31",
      openTasks: 0,
      closedBy: "u-rin",
    },
    {
      id: "per-2026-02",
      code: "2026-02",
      status: "closing",
      startsOn: "2026-02-01",
      endsOn: "2026-02-28",
      openTasks: 4,
    },
    {
      id: "per-2026-03",
      code: "2026-03",
      status: "open",
      startsOn: "2026-03-01",
      endsOn: "2026-03-31",
      openTasks: 11,
    },
  ];

  return {
    module: "finance",
    resources: [
      resource<ReceivableDto>({
        slug: "receivables",
        rows: receivables,
        searchable: ["invoiceNumber", "customerName", "ageingBucket", "status"],
        title: (row) => `${row.invoiceNumber} · ${row.customerName}`,
        subtitle: (row) => `Receivable · ${row.ageingBucket}`,
      }),
      resource<PayableDto>({
        slug: "payables",
        rows: payables,
        searchable: ["invoiceNumber", "supplierName", "status"],
        title: (row) => `${row.invoiceNumber} · ${row.supplierName}`,
        subtitle: (row) => `Payable · due ${row.dueOn}`,
      }),
      resource<JournalDto>({
        slug: "journals",
        rows: journals,
        searchable: ["reference", "period", "status"],
        title: (row) => `${row.reference} · ${row.period}`,
        subtitle: (row) => `Journal · ${row.status}`,
      }),
      resource<PeriodDto>({
        slug: "periods",
        rows: periods,
        searchable: ["code", "status"],
        title: (row) => row.code,
        subtitle: (row) => `Period · ${row.status}`,
      }),
    ],
    summary: {
      module: "finance",
      asOf: ctx.now,
      metrics: {
        receivablesOutstanding: { kind: "money", value: amount(ctx, 197_070_00) },
        payablesOutstanding: { kind: "money", value: amount(ctx, 69_660_00) },
        overdueInvoices: count(
          receivables.filter(
            (r) => r.outstanding.amountMinor > 0 && Date.parse(r.dueOn) < Date.parse(ctx.now),
          ).length,
        ),
        daysSalesOutstanding: days(47.2),
        draftJournals: count(journals.filter((j) => j.status === "draft").length),
      },
      deltas: { receivablesOutstanding: 0.06, overdueInvoices: 0.5, daysSalesOutstanding: 0.09 },
    },
  };
};
