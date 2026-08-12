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
import { ConflictError, NotFoundError, } from "@enterprise-suite/shared-kernel";
import { InspectionLot } from "../domain/inspection-lot.js";
import { determineSampling } from "../domain/sampling.js";
import { documentSeries } from "./ports.js";
export class InspectionLotService {
    lots;
    plans;
    outbox;
    numbers;
    clock;
    ncrService;
    supplierQuality;
    constructor(lots, plans, outbox, numbers, clock, ncrService, supplierQuality) {
        this.lots = lots;
        this.plans = plans;
        this.outbox = outbox;
        this.numbers = numbers;
        this.clock = clock;
        this.ncrService = ncrService;
        this.supplierQuality = supplierQuality;
    }
    async flush(lot) {
        await this.lots.save(lot);
        await this.outbox.append(lot.pullEvents());
    }
    async createLot(ctx, cmd) {
        const plan = await this.plans.findById(ctx.tenantId, cmd.planId);
        if (!plan)
            throw new NotFoundError("InspectionPlan", cmd.planId);
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
    async startInspection(ctx, lotId) {
        const lot = await this.getLot(ctx, lotId);
        lot.start();
        await this.flush(lot);
        return lot;
    }
    async recordQuantitativeResult(ctx, lotId, characteristicCode, readings, note) {
        const lot = await this.getLot(ctx, lotId);
        lot.recordQuantitativeResult(characteristicCode, { readings }, ctx.userId, note);
        await this.flush(lot);
        return lot;
    }
    async recordAttributeResult(ctx, lotId, characteristicCode, counts, note) {
        const lot = await this.getLot(ctx, lotId);
        lot.recordAttributeResult(characteristicCode, counts, ctx.userId, note);
        await this.flush(lot);
        return lot;
    }
    async completeInspection(ctx, lotId) {
        const lot = await this.getLot(ctx, lotId);
        lot.complete();
        await this.flush(lot);
        return lot;
    }
    async decideUsage(ctx, lotId, cmd) {
        const lot = await this.getLot(ctx, lotId);
        const failedBefore = lot.failedResults();
        const usage = lot.decide(cmd.decision, ctx.userId, {
            note: cmd.note,
            acceptedQuantity: cmd.acceptedQuantity,
        });
        await this.flush(lot);
        const outcome = { lot };
        const shouldOpenNcr = (cmd.autoCreateNcr ?? true) && usage.rejectedQuantity > 0;
        if (shouldOpenNcr) {
            const severity = lot.hasCriticalFailure()
                ? "critical"
                : failedBefore.some((r) => r.criticality === "major")
                    ? "major"
                    : "minor";
            outcome.ncr = await this.ncrService.createNcr(ctx, {
                title: `Inspection lot ${lot.lotNumber} ${usage.decision}`,
                description: `Usage decision '${usage.decision}' on lot ${lot.lotNumber} ` +
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
            }, { autoSubmit: true, recordSupplierEvent: false });
        }
        if (usage.rejectedQuantity > 0 && lot.origin === "goods-receipt" && lot.linkage.supplierId) {
            outcome.supplierEvent = await this.supplierQuality.recordEvent(ctx, {
                supplierId: lot.linkage.supplierId,
                eventType: "incoming-inspection-failure",
                severity: lot.hasCriticalFailure() ? "critical" : "major",
                description: `Incoming inspection failure on lot ${lot.lotNumber}: ` +
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
    async cancelLot(ctx, lotId, reason) {
        const lot = await this.getLot(ctx, lotId);
        lot.cancel(reason);
        await this.flush(lot);
        return lot;
    }
    async getLot(ctx, lotId) {
        const lot = await this.lots.findById(ctx.tenantId, lotId);
        if (!lot)
            throw new NotFoundError("InspectionLot", lotId);
        return lot;
    }
    async listLots(ctx, filter) {
        return this.lots.list(ctx.tenantId, filter);
    }
}
//# sourceMappingURL=inspection-lot-service.js.map