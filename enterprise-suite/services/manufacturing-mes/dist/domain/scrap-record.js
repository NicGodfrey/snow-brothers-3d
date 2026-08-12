import { AggregateRoot, DomainError, envelope, } from "@enterprise-suite/shared-kernel";
import { MesEvents } from "./events.js";
import { asUlid } from "./ids.js";
export const SCRAP_REASON_CODES = [
    "MATERIAL_DEFECT",
    "OPERATOR_ERROR",
    "MACHINE_FAULT",
    "SETUP_LOSS",
    "TOOLING_WEAR",
    "PROCESS_DRIFT",
    "HANDLING_DAMAGE",
    "OTHER",
];
export function isScrapReasonCode(value) {
    return SCRAP_REASON_CODES.includes(value);
}
/**
 * SCRAP      — units destroyed, quantity lost.
 * REWORK     — units routed to a rework work order.
 * USE_AS_IS  — deviation accepted (quality waiver), units continue.
 */
export const SCRAP_DISPOSITIONS = ["SCRAP", "REWORK", "USE_AS_IS"];
export class ScrapRecord extends AggregateRoot {
    constructor(tenantId, props) {
        super(tenantId, props);
    }
    static record(tenantId, input) {
        if (!(input.quantity > 0)) {
            throw new DomainError("Scrap quantity must be positive", "SCRAP_INVALID_QTY");
        }
        if (!Number.isInteger(input.operationSeq) || input.operationSeq < 1) {
            throw new DomainError("operationSeq must be a positive integer", "SCRAP_INVALID_SEQ");
        }
        const record = new ScrapRecord(tenantId, {
            workOrderId: input.workOrderId,
            operationSeq: input.operationSeq,
            sku: input.sku.trim().toUpperCase(),
            quantity: input.quantity,
            uom: input.uom,
            reasonCode: input.reasonCode,
            disposition: input.disposition,
            notes: input.notes?.trim() || null,
            reportedBy: input.reportedBy,
            costImpact: input.costImpact ?? null,
            reworkWorkOrderId: null,
        });
        const payload = {
            scrapRecordId: record.id,
            workOrderId: input.workOrderId,
            operationSeq: input.operationSeq,
            sku: record.props.sku,
            qty: input.quantity,
            uom: input.uom,
            reasonCode: input.reasonCode,
            disposition: input.disposition,
        };
        record.raise(envelope({
            eventType: MesEvents.ScrapRecorded,
            aggregateType: "ScrapRecord",
            aggregateId: asUlid(record.id),
            tenantId,
            payload,
        }));
        return record;
    }
    get workOrderRef() {
        return this.props.workOrderId;
    }
    get disposition() {
        return this.props.disposition;
    }
    get quantity() {
        return this.props.quantity;
    }
    get reasonCode() {
        return this.props.reasonCode;
    }
    get reworkWorkOrderId() {
        return this.props.reworkWorkOrderId;
    }
    linkReworkOrder(reworkWorkOrderId) {
        if (this.props.disposition !== "REWORK") {
            throw new DomainError(`Cannot link rework order: disposition is ${this.props.disposition}`, "SCRAP_NOT_REWORK", 422);
        }
        if (this.props.reworkWorkOrderId) {
            throw new DomainError("Rework order already linked to this scrap record", "SCRAP_REWORK_EXISTS", 409);
        }
        this.props.reworkWorkOrderId = reworkWorkOrderId;
        this.raise(envelope({
            eventType: MesEvents.ReworkOrderCreated,
            aggregateType: "ScrapRecord",
            aggregateId: asUlid(this.id),
            tenantId: this.tenantId,
            payload: {
                scrapRecordId: this.id,
                workOrderId: this.props.workOrderId,
                reworkWorkOrderId,
                qty: this.props.quantity,
                uom: this.props.uom,
            },
        }));
    }
}
//# sourceMappingURL=scrap-record.js.map