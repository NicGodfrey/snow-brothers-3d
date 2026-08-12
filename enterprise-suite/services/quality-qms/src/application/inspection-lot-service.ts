/**
 * Inspection lot use-cases.
 *
 * Orchestration on usage decision (the cross-aggregate policy lives here,
 * not in the aggregates):
 *  - reject / partial with a rejected quantity  -> auto-create an NCR
 *    referencing the lot (unless the caller opts out)
 *  - rejected goods-receipt lots with a supplier -> record a supplier
 *    quality event ("incoming-inspection-failure") for SRM scorecards
 */
import {
  ConflictError,
  NotFoundError,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { InspectionLot, type LotStatus, type UsageDecisionType } from "../domain/inspection-lot.js";
import type { LotOrigin } from "../domain/inspection-plan.js";
import type { NonConformanceReport } from "../domain/ncr.js";
import type { InspectionLotRepository, InspectionPlanRepository } from "../domain/repositories.js";
import { determineSampling } from "../domain/sampling.js";
import type { SupplierQualityEvent } from "../domain/supplier-quality.js";
import type { NcrService } from "./ncr-service.js";
import { documentSeries, type Clock, type NumberSeries, type Outbox } from "./ports.js";
import type { SupplierQualityService } from "./supplier-quality-service.js";

export interface CreateLotCommand {
  planId: Ulid;
  origin: LotOrigin;
  quantity: number;
  uom: string;
  /** Defaults to the plan's materialCode; required for process plans. */
  materialCode?: string;
  supplierId?: string;
  purchaseOrderRef?: string;
  workOrderRef?: string;
  customerRef?: string;
  batchNumber?: string;
}

export interface DecideUsageCommand {
  decision: UsageDecisionType;
  note?: string;
  acceptedQuantity?: number;
  /** Default true: rejected material automatically opens an NCR. */
  autoCreateNcr?: boolean;
}

export interface UsageDecisionOutcome {
  lot: InspectionLot;
  ncr?: NonConformanceReport;
  supplierEvent?: SupplierQualityEvent;
}

export class InspectionLotService {
  constructor(
    private readonly lots: InspectionLotRepository,
    private readonly plans: InspectionPlanRepository,
    private readonly outbox: Outbox,
    private readonly numbers: NumberSeries,
    private readonly clock: Clock,
    private readonly ncrService: NcrService,
    private readonly supplierQuality: SupplierQualityService,
  ) {}

  private async flush(lot: InspectionLot): Promise<void> {
    await this.lots.save(lot);
    await this.outbox.append(lot.pullEvents());
  }

  async createLot(ctx: TenantContext, cmd: CreateLotCommand): Promise<InspectionLot> {
    const plan = await this.plans.findById(ctx.tenantId, cmd.planId);
    if (!plan) throw new NotFoundError("InspectionPlan", cmd.planId);
    if (plan.status !== "active") {
      throw new ConflictError(`Inspection plan ${plan.planCode} rev ${plan.revision} is not active`);
    }
    if (!plan.allowsOrigin(cmd.origin)) {
      throw new ConflictError(`Plan ${plan.planCode} does not allow origin '${cmd.origin}'`);
    }
    const materialCode = cmd.materialCode ?? plan.materialCode;
    if (!materialCode) {
      throw new ConflictError("materialCode is required (plan has no default material)");
    }

    const sampling = determineSampling(plan.samplingRule, cmd.quantity);
    const lotNumber = await this.numbers.next(ctx.tenantId, documentSeries.inspectionLot);
    const lot = InspectionLot.create(ctx.tenantId, {
      lotNumber,
      planId: plan.id,
      planCode: plan.planCode,
      planRevision: plan.revision,
      origin: cmd.origin,
      materialCode,
      quantity: cmd.quantity,
      uom: cmd.uom,
      linkage: {
        supplierId: cmd.supplierId,
        purchaseOrderRef: cmd.purchaseOrderRef,
        workOrderRef: cmd.workOrderRef,
        customerRef: cmd.customerRef,
        batchNumber: cmd.batchNumber,
      },
      sampling,
      characteristics: plan.characteristics,
    });
    await this.flush(lot);
    return lot;
  }

  async startInspection(ctx: TenantContext, lotId: Ulid): Promise<InspectionLot> {
    const lot = await this.getLot(ctx, lotId);
    lot.start();
    await this.flush(lot);
    return lot;
  }

  async recordQuantitativeResult(
    ctx: TenantContext,
    lotId: Ulid,
    characteristicCode: string,
    readings: number[],
    note?: string,
  ): Promise<InspectionLot> {
    const lot = await this.getLot(ctx, lotId);
    lot.recordQuantitativeResult(characteristicCode, { readings }, ctx.userId, note);
    await this.flush(lot);
    return lot;
  }

  async recordAttributeResult(
    ctx: TenantContext,
    lotId: Ulid,
    characteristicCode: string,
    counts: { inspected: number; defective: number },
    note?: string,
  ): Promise<InspectionLot> {
    const lot = await this.getLot(ctx, lotId);
    lot.recordAttributeResult(characteristicCode, counts, ctx.userId, note);
    await this.flush(lot);
    return lot;
  }

  async completeInspection(ctx: TenantContext, lotId: Ulid): Promise<InspectionLot> {
    const lot = await this.getLot(ctx, lotId);
    lot.complete();
    await this.flush(lot);
    return lot;
  }

  async decideUsage(ctx: TenantContext, lotId: Ulid, cmd: DecideUsageCommand): Promise<UsageDecisionOutcome> {
    const lot = await this.getLot(ctx, lotId);
    const failedBefore = lot.failedResults();
    const usage = lot.decide(cmd.decision, ctx.userId, {
      note: cmd.note,
      acceptedQuantity: cmd.acceptedQuantity,
    });
    await this.flush(lot);

    const outcome: UsageDecisionOutcome = { lot };
    const shouldOpenNcr = (cmd.autoCreateNcr ?? true) && usage.rejectedQuantity > 0;

    if (shouldOpenNcr) {
      const severity = lot.hasCriticalFailure()
        ? "critical"
        : failedBefore.some((r) => r.criticality === "major")
          ? "major"
          : "minor";
      outcome.ncr = await this.ncrService.createNcr(
        ctx,
        {
          title: `Inspection lot ${lot.lotNumber} ${usage.decision}`,
          description:
            `Usage decision '${usage.decision}' on lot ${lot.lotNumber} ` +
            `(${lot.materialCode}, ${usage.rejectedQuantity} ${lot.uom} rejected). ` +
            (failedBefore.length > 0
              ? `Failed characteristics: ${failedBefore.map((r) => r.code).join(", ")}.`
              : `No failed characteristics; reason: ${cmd.note ?? "n/a"}.`),
          source: "inspection",
          severity,
          quantityAffected: usage.rejectedQuantity,
          uom: lot.uom,
          materialCode: lot.materialCode,
          linkage: {
            inspectionLotId: lot.id,
            supplierId: lot.linkage.supplierId,
            purchaseOrderRef: lot.linkage.purchaseOrderRef,
            workOrderRef: lot.linkage.workOrderRef,
          },
        },
        { autoSubmit: true, recordSupplierEvent: false },
      );
    }

    if (usage.rejectedQuantity > 0 && lot.origin === "goods-receipt" && lot.linkage.supplierId) {
      outcome.supplierEvent = await this.supplierQuality.recordEvent(ctx, {
        supplierId: lot.linkage.supplierId,
        eventType: "incoming-inspection-failure",
        severity: lot.hasCriticalFailure() ? "critical" : "major",
        description:
          `Incoming inspection failure on lot ${lot.lotNumber}: ` +
          `${usage.rejectedQuantity}/${lot.quantity} ${lot.uom} of ${lot.materialCode} rejected`,
        linkage: {
          inspectionLotId: lot.id,
          ncrId: outcome.ncr?.id,
          purchaseOrderRef: lot.linkage.purchaseOrderRef,
          materialCode: lot.materialCode,
        },
      });
    }

    return outcome;
  }

  async cancelLot(ctx: TenantContext, lotId: Ulid, reason: string): Promise<InspectionLot> {
    const lot = await this.getLot(ctx, lotId);
    lot.cancel(reason);
    await this.flush(lot);
    return lot;
  }

  async getLot(ctx: TenantContext, lotId: Ulid): Promise<InspectionLot> {
    const lot = await this.lots.findById(ctx.tenantId, lotId);
    if (!lot) throw new NotFoundError("InspectionLot", lotId);
    return lot;
  }

  async listLots(
    ctx: TenantContext,
    filter?: { status?: LotStatus; origin?: LotOrigin; supplierId?: string; materialCode?: string },
  ): Promise<InspectionLot[]> {
    return this.lots.list(ctx.tenantId, filter);
  }
}
