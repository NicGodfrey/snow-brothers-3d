/**
 * Demo data: dimension members plus a synthetic stream of upstream domain
 * events, fed through the *real* ingest path.
 *
 * Seeding through mappings rather than writing facts directly is deliberate.
 * It means the demo dataset exercises the same code an integration does, so
 * a broken mapping shows up the moment someone boots the service with seed
 * data instead of the first time a real event arrives.
 *
 * The generator is a seeded LCG, so the same seed produces the same
 * warehouse on every run — demos and snapshot tests need that.
 */
import { brand, type IsoDateTime, type TenantContext } from "@enterprise-suite/shared-kernel";
import type { IngestResult } from "../application/ingest-service.js";
import type { MemberInput } from "../application/dimension-service.js";
import type { SourceEvent } from "../domain/ingest.js";
import type { KpiSnapshot } from "../domain/kpi.js";
import type { ReportingBiModule } from "./module.js";

export interface SeedOptions {
  /** How many days of history to generate, ending at the anchor. */
  days?: number;
  anchor?: IsoDateTime;
  seed?: number;
  computeKpis?: boolean;
}

export interface SeedResult {
  readonly events: number;
  readonly ingest: IngestResult;
  readonly snapshots: readonly KpiSnapshot[];
}

/** Deterministic linear congruential generator (Numerical Recipes). */
class Rng {
  constructor(private state: number) {}

  next(): number {
    this.state = (this.state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return this.state / 4_294_967_296;
  }

  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick<T>(values: readonly T[]): T {
    return values[Math.min(values.length - 1, Math.floor(this.next() * values.length))]!;
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }
}

const SEGMENTS = ["SEG-ENT", "SEG-MID", "SEG-SMB"] as const;
const ACCOUNTS = ["ACC-001", "ACC-002", "ACC-003", "ACC-004", "ACC-005", "ACC-006"] as const;
const SKUS = ["SKU-1001", "SKU-1002", "SKU-2001", "SKU-2002", "SKU-3001"] as const;
const SITES = ["WH-BER", "WH-AMS", "WH-CHI"] as const;
const CELLS = ["WC-ASSY", "WC-PAINT", "WC-TEST"] as const;
const CAMPAIGNS = ["CMP-SPRING", "CMP-WEBINAR"] as const;
const CHANNELS = ["email", "paid-search", "events"] as const;
const CARRIERS = ["DHL", "UPS", "MAERSK"] as const;
const SUPPLIERS = ["SUP-001", "SUP-002", "SUP-003"] as const;

export function demoMembers(): Record<string, MemberInput[]> {
  return {
    product: [
      { key: "FAM-ELEC", label: "Electronics", levelKey: "family" },
      { key: "FAM-MECH", label: "Mechanical", levelKey: "family" },
      { key: "CAT-SENSOR", label: "Sensors", levelKey: "category", parentKey: "FAM-ELEC" },
      { key: "CAT-CONTROL", label: "Controllers", levelKey: "category", parentKey: "FAM-ELEC" },
      { key: "CAT-BRACKET", label: "Brackets", levelKey: "category", parentKey: "FAM-MECH" },
      { key: "SKU-1001", label: "Proximity sensor", levelKey: "sku", parentKey: "CAT-SENSOR" },
      { key: "SKU-1002", label: "Temperature sensor", levelKey: "sku", parentKey: "CAT-SENSOR" },
      { key: "SKU-2001", label: "PLC controller", levelKey: "sku", parentKey: "CAT-CONTROL" },
      { key: "SKU-2002", label: "IO module", levelKey: "sku", parentKey: "CAT-CONTROL" },
      { key: "SKU-3001", label: "Mounting bracket", levelKey: "sku", parentKey: "CAT-BRACKET" },
    ],
    customer: [
      { key: "SEG-ENT", label: "Enterprise", levelKey: "segment" },
      { key: "SEG-MID", label: "Mid-market", levelKey: "segment" },
      { key: "SEG-SMB", label: "Small business", levelKey: "segment" },
      { key: "ACC-001", label: "Northwind Industrial", levelKey: "account", parentKey: "SEG-ENT" },
      { key: "ACC-002", label: "Contoso Manufacturing", levelKey: "account", parentKey: "SEG-ENT" },
      { key: "ACC-003", label: "Fabrikam Robotics", levelKey: "account", parentKey: "SEG-MID" },
      { key: "ACC-004", label: "Tailspin Systems", levelKey: "account", parentKey: "SEG-MID" },
      { key: "ACC-005", label: "Wingtip Devices", levelKey: "account", parentKey: "SEG-SMB" },
      { key: "ACC-006", label: "Litware Controls", levelKey: "account", parentKey: "SEG-SMB" },
    ],
    warehouse: [
      { key: "REG-EU", label: "Europe", levelKey: "region" },
      { key: "REG-NA", label: "North America", levelKey: "region" },
      { key: "WH-BER", label: "Berlin DC", levelKey: "site", parentKey: "REG-EU" },
      { key: "WH-AMS", label: "Amsterdam DC", levelKey: "site", parentKey: "REG-EU" },
      { key: "WH-CHI", label: "Chicago DC", levelKey: "site", parentKey: "REG-NA" },
    ],
    work_center: [
      { key: "PLANT-1", label: "Plant 1", levelKey: "plant" },
      { key: "WC-ASSY", label: "Assembly", levelKey: "cell", parentKey: "PLANT-1" },
      { key: "WC-PAINT", label: "Paint line", levelKey: "cell", parentKey: "PLANT-1" },
      { key: "WC-TEST", label: "Test bench", levelKey: "cell", parentKey: "PLANT-1" },
    ],
    campaign: [
      { key: "PRG-DEMANDGEN", label: "Demand generation", levelKey: "program" },
      {
        key: "CMP-SPRING",
        label: "Spring promotion",
        levelKey: "campaign_code",
        parentKey: "PRG-DEMANDGEN",
      },
      {
        key: "CMP-WEBINAR",
        label: "Webinar series",
        levelKey: "campaign_code",
        parentKey: "PRG-DEMANDGEN",
      },
    ],
    supplier: SUPPLIERS.map((key, index) => ({
      key,
      label: `Supplier ${index + 1}`,
    })),
    carrier: CARRIERS.map((key) => ({ key, label: key })),
    channel: CHANNELS.map((key) => ({ key, label: key })),
  };
}

/** Generates the synthetic upstream event stream. */
export function demoEvents(
  tenantId: TenantContext["tenantId"],
  options?: SeedOptions,
): SourceEvent[] {
  const days = options?.days ?? 120;
  const anchor = new Date(options?.anchor ?? new Date().toISOString());
  const rng = new Rng(options?.seed ?? 20_260_812);
  const events: SourceEvent[] = [];
  let sequence = 0;

  const emit = (
    eventType: string,
    aggregateType: string,
    at: Date,
    payload: Record<string, unknown>,
  ): void => {
    // Today is only half over: events later in the day than the anchor have
    // not happened yet, and a warehouse with facts in the future reads as a
    // bug in every freshness indicator.
    if (at > anchor) return;
    sequence += 1;
    events.push({
      eventId: brand<string, "Ulid">(`seed-evt-${String(sequence).padStart(6, "0")}`),
      eventType,
      aggregateType,
      aggregateId: brand<string, "Ulid">(`seed-agg-${String(sequence).padStart(6, "0")}`),
      tenantId,
      occurredAt: brand<string, "IsoDateTime">(at.toISOString()),
      schemaVersion: 1,
      payload,
    });
  };

  for (let dayOffset = days - 1; dayOffset >= 0; dayOffset -= 1) {
    const day = new Date(anchor.getTime() - dayOffset * 86_400_000);
    const weekday = day.getUTCDay();
    const isWeekend = weekday === 0 || weekday === 6;
    // Gentle upward trend so period-over-period comparisons are meaningful.
    const trend = 1 + (days - dayOffset) / (days * 2);

    const at = (hour: number, minute = 0): Date =>
      new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour, minute));

    // --- sales ------------------------------------------------------------
    const orderCount = isWeekend ? rng.int(0, 2) : Math.round(rng.int(3, 7) * trend);
    for (let i = 0; i < orderCount; i += 1) {
      const account = rng.pick(ACCOUNTS);
      const amount = rng.int(80_000, 900_000);
      const orderNumber = `SO-${day.getUTCFullYear()}-${String(sequence + 1).padStart(5, "0")}`;
      emit("sales.order.confirmed", "SalesOrder", at(9 + (i % 8), 15), {
        orderNumber,
        accountId: account,
        grandTotalMinor: amount,
        currency: "EUR",
        creditDecision: rng.chance(0.9) ? "approved" : "manual-review",
        quoteId: rng.chance(0.6) ? `QT-${i}` : undefined,
      });
      if (rng.chance(0.06)) {
        emit("sales.order.cancelled", "SalesOrder", at(16), {
          orderNumber,
          accountId: account,
          reason: rng.pick(["customer-request", "credit-hold", "stock-out"]),
          previousStatus: "confirmed",
        });
        continue;
      }
      if (rng.chance(0.85)) {
        const lines = Array.from({ length: rng.int(1, 3) }, (_, line) => ({
          lineId: `L-${line}`,
          sku: rng.pick(SKUS),
          qty: rng.int(1, 40),
        }));
        emit("sales.order.shipped", "SalesOrder", at(14), {
          orderNumber,
          accountId: account,
          shipments: lines,
          fullyShipped: true,
        });
        emit("sales.order.invoiced", "SalesOrder", at(15), { orderNumber, accountId: account });
        emit("finance.ar.invoice-issued", "ArInvoice", at(15, 5), {
          invoiceId: `INV-${sequence}`,
          invoiceNo: `AR-${String(sequence).padStart(5, "0")}`,
          customerId: account,
          currency: "EUR",
          totalMinor: amount,
          journalId: `JRN-${sequence}`,
        });
        if (rng.chance(0.78)) {
          emit("finance.ar.payment-received", "ArPayment", at(17), {
            paymentNo: `RCPT-${sequence}`,
            customerId: account,
            currency: "EUR",
            amountMinor: amount,
            method: rng.pick(["bank-transfer", "card", "direct-debit"]),
          });
        }
      }
    }

    // --- pipeline ---------------------------------------------------------
    if (!isWeekend) {
      for (let i = 0; i < rng.int(1, 4); i += 1) {
        const amount = rng.int(200_000, 2_500_000);
        emit("sales.opportunity.created", "Opportunity", at(10, i * 5), {
          accountId: rng.pick(ACCOUNTS),
          ownerId: rng.pick(["rep-anna", "rep-ben", "rep-chen"]),
          stage: "qualification",
          amountMinor: amount,
          currency: "EUR",
        });
        if (rng.chance(0.35)) {
          emit("sales.opportunity.won", "Opportunity", at(11), {
            stage: "won",
            accountId: rng.pick(ACCOUNTS),
            ownerId: rng.pick(["rep-anna", "rep-ben", "rep-chen"]),
            amountMinor: amount,
            currency: "EUR",
          });
        } else if (rng.chance(0.4)) {
          emit("sales.opportunity.lost", "Opportunity", at(11, 30), {
            stage: "lost",
            accountId: rng.pick(ACCOUNTS),
            amountMinor: amount,
            currency: "EUR",
            lostReason: rng.pick(["price", "timing", "competitor", "no-decision"]),
          });
        }
      }
    }

    // --- marketing --------------------------------------------------------
    // Lead volume is sized against the campaign spend emitted below, so
    // cost-per-lead lands either side of its target rather than reading
    // permanently off-track.
    const leadCount = isWeekend ? rng.int(2, 6) : rng.int(12, 20);
    for (let i = 0; i < leadCount; i += 1) {
      emit("marketing.lead.captured.v1", "Lead", at(8, i * 3), {
        leadId: `LEAD-${sequence}`,
        email: `lead${sequence}@example.com`,
        source: rng.pick(["web-form", "webinar", "referral", "tradeshow"]),
        utm: { campaign: rng.pick(CAMPAIGNS), medium: rng.pick(CHANNELS), source: "newsletter" },
      });
    }
    if (rng.chance(0.3)) {
      emit("marketing.lead.converted.v1", "Lead", at(12), {
        leadId: `LEAD-${sequence}`,
        campaignId: rng.pick(CAMPAIGNS),
        source: "web-form",
        estimatedValue: { amountMinor: rng.int(150_000, 900_000), currency: "EUR" },
      });
    }
    if (weekday === 2) {
      const sent = rng.int(1_800, 4_200);
      const delivered = Math.round(sent * 0.96);
      emit("marketing.send-job.completed.v1", "SendJob", at(7), {
        sendJobId: `SEND-${sequence}`,
        campaignId: rng.pick(CAMPAIGNS),
        channelKind: "email",
        sent,
        delivered,
        bounced: sent - delivered,
        opened: Math.round(delivered * (0.22 + rng.next() * 0.1)),
        clicked: Math.round(delivered * (0.03 + rng.next() * 0.02)),
        unsubscribed: rng.int(1, 12),
      });
    }
    // Spend is booked weekly rather than as a monthly lump: a lumpy
    // denominator would make every month-to-date efficiency ratio meaningless.
    if (weekday === 1) {
      for (const campaign of CAMPAIGNS) {
        emit("marketing.budget.spend-recorded.v1", "Budget", at(6), {
          budgetId: `BUD-${campaign}`,
          campaignId: campaign,
          channelId: rng.pick(CHANNELS),
          category: rng.pick(["media", "content", "events"]),
          amount: { amountMinor: rng.int(90_000, 280_000), currency: "EUR" },
        });
      }
    }

    // --- inventory --------------------------------------------------------
    for (let i = 0; i < rng.int(4, 12); i += 1) {
      const inbound = rng.chance(0.45);
      emit(
        inbound ? "inventory.stock.received" : "inventory.stock.issued",
        "InventoryTransaction",
        at(6 + (i % 12), 30),
        {
          transactionId: `TX-${sequence}`,
          warehouseId: rng.pick(SITES),
          sku: rng.pick(SKUS),
          lotId: rng.chance(0.5) ? `LOT-${rng.int(1, 20)}` : null,
          uom: "EA",
          quantity: rng.int(5, 250),
          fromBinId: null,
          toBinId: null,
          refType: inbound ? "purchase-order" : "sales-order",
          refId: `REF-${sequence}`,
          reasonCode: null,
        },
      );
    }
    if (weekday === 4) {
      const variances = Array.from({ length: rng.int(3, 8) }, (_, line) => {
        const expected = rng.int(20, 400);
        const counted = rng.chance(0.85) ? expected : expected + rng.int(-6, 6);
        return {
          lineId: `CL-${line}`,
          binId: `BIN-${line}`,
          sku: rng.pick(SKUS),
          lotId: null,
          expectedQty: expected,
          countedQty: counted,
          varianceQty: counted - expected,
        };
      });
      emit("inventory.cycle-count.completed", "CycleCount", at(18), {
        warehouseId: rng.pick(SITES),
        countedLines: variances.length,
        variances,
      });
    }

    // --- logistics --------------------------------------------------------
    for (let i = 0; i < rng.int(1, 6); i += 1) {
      const carrier = rng.pick(CARRIERS);
      emit("logistics.shipment.booked", "Shipment", at(13, i * 7), {
        shipmentId: `SHP-${sequence}`,
        reference: `SHP-${sequence}`,
        orderRef: `SO-${sequence}`,
        carrierId: `CAR-${carrier}`,
        carrierCode: carrier,
        serviceLevelCode: rng.pick(["standard", "express", "economy"]),
        trackingNumber: `TRK${sequence}`,
        totalMinor: rng.int(4_000, 45_000),
        currency: "EUR",
      });
      if (rng.chance(0.93)) {
        const deliveredAt = new Date(at(13).getTime() + rng.int(1, 4) * 86_400_000);
        // Shipments booked in the last few days are still in transit at the
        // anchor. Emitting their delivery would stamp a fact in the future
        // and inflate the current period's delivery rate.
        if (deliveredAt <= anchor) {
          emit("logistics.shipment.delivered", "Shipment", deliveredAt, {
            shipmentId: `SHP-${sequence}`,
            reference: `SHP-${sequence}`,
            carrierCode: carrier,
            orderRef: `SO-${sequence}`,
            deliveredAt: deliveredAt.toISOString(),
          });
        }
      } else {
        emit("logistics.shipment.exception", "Shipment", at(20), {
          shipmentId: `SHP-${sequence}`,
          carrierCode: carrier,
          code: rng.pick(["customs-hold", "weather", "address-issue"]),
          status: "delayed",
        });
      }
    }

    // --- production -------------------------------------------------------
    if (!isWeekend) {
      for (let i = 0; i < rng.int(4, 10); i += 1) {
        const good = rng.int(20, 180);
        const scrap = rng.chance(0.35) ? rng.int(1, 8) : 0;
        emit("mes.work-order.operation-reported", "WorkOrder", at(7 + (i % 10)), {
          workOrderId: `WO-${rng.int(1, 60)}`,
          operationSeq: rng.int(10, 40),
          workCenterId: rng.pick(CELLS),
          qtyGood: good,
          qtyScrapped: scrap,
          operationStatus: "completed",
          laborMinutes: rng.int(30, 240),
          machineMinutes: rng.int(20, 300),
        });
        if (scrap > 0) {
          emit("mes.scrap.recorded", "ScrapRecord", at(8 + (i % 10)), {
            scrapRecordId: `SCR-${sequence}`,
            workOrderId: `WO-${rng.int(1, 60)}`,
            operationSeq: 20,
            sku: rng.pick(SKUS),
            qty: scrap,
            uom: "EA",
            reasonCode: rng.pick(["material-defect", "setup", "operator-error", "tooling"]),
            disposition: "scrap",
          });
        }
      }
      emit("mes.production-receipt.posted", "ProductionReceipt", at(19), {
        productionReceiptId: `PR-${sequence}`,
        workOrderId: `WO-${rng.int(1, 60)}`,
        sku: rng.pick(SKUS),
        qtyGood: rng.int(50, 400),
        uom: "EA",
        warehouseCode: rng.pick(SITES),
        lotNumber: null,
      });
    }

    // --- quality ----------------------------------------------------------
    for (let i = 0; i < rng.int(0, 3); i += 1) {
      const quantity = rng.int(100, 1_000);
      const rejected = rng.chance(0.18) ? rng.int(1, Math.max(2, Math.round(quantity * 0.05))) : 0;
      const supplier = rng.pick(SUPPLIERS);
      emit("quality.inspection-lot.usage-decided", "InspectionLot", at(11, i * 20), {
        lotNumber: `LOT-${sequence}`,
        planId: `PLAN-${rng.int(1, 5)}`,
        origin: "goods-receipt",
        materialCode: rng.pick(SKUS),
        decision: rejected > 0 ? "partial-accept" : "accept",
        acceptedQuantity: quantity - rejected,
        rejectedQuantity: rejected,
        supplierId: supplier,
        failedCharacteristicCodes: rejected > 0 ? ["DIA"] : [],
      });
      if (rejected > 0) {
        emit("quality.ncr.opened", "NonConformanceReport", at(12, i * 20), {
          ncrNumber: `NCR-${sequence}`,
          source: "incoming-inspection",
          severity: rng.pick(["minor", "major", "critical"]),
          supplierId: supplier,
          quantityAffected: rejected,
        });
        emit("quality.supplier-event.recorded", "SupplierQualityEvent", at(12, i * 20 + 5), {
          supplierId: supplier,
          eventType: "rejected-lot",
          severity: "major",
          demeritPoints: rng.int(5, 25),
        });
      }
    }
  }

  return events;
}

/**
 * Loads demo members and ingests the synthetic event stream. Assumes the
 * catalog has already been installed.
 */
export async function seedDemoData(
  ctx: TenantContext,
  module: ReportingBiModule,
  options?: SeedOptions,
): Promise<SeedResult> {
  for (const [dimensionKey, members] of Object.entries(demoMembers())) {
    await module.services.dimensions.loadMembers(ctx, dimensionKey, members);
  }

  const events = demoEvents(ctx.tenantId, options);
  const ingest = await module.services.ingest.ingest(ctx, events);

  const snapshots = options?.computeKpis === false ? [] : await module.services.kpis.computeAll(ctx, options?.anchor);

  return { events: events.length, ingest, snapshots };
}
