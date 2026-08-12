import { AggregateRoot, type Money, type TenantId } from "@enterprise-suite/shared-kernel";
import { type UnitOfMeasure, type WorkOrderId } from "./ids.js";
export declare const SCRAP_REASON_CODES: readonly ["MATERIAL_DEFECT", "OPERATOR_ERROR", "MACHINE_FAULT", "SETUP_LOSS", "TOOLING_WEAR", "PROCESS_DRIFT", "HANDLING_DAMAGE", "OTHER"];
export type ScrapReasonCode = (typeof SCRAP_REASON_CODES)[number];
export declare function isScrapReasonCode(value: string): value is ScrapReasonCode;
/**
 * SCRAP      — units destroyed, quantity lost.
 * REWORK     — units routed to a rework work order.
 * USE_AS_IS  — deviation accepted (quality waiver), units continue.
 */
export declare const SCRAP_DISPOSITIONS: readonly ["SCRAP", "REWORK", "USE_AS_IS"];
export type ScrapDisposition = (typeof SCRAP_DISPOSITIONS)[number];
export interface ScrapRecordProps {
    readonly workOrderId: WorkOrderId;
    readonly operationSeq: number;
    readonly sku: string;
    readonly quantity: number;
    readonly uom: UnitOfMeasure;
    readonly reasonCode: ScrapReasonCode;
    readonly disposition: ScrapDisposition;
    readonly notes: string | null;
    readonly reportedBy: string;
    readonly costImpact: Money | null;
    /** Set when disposition = REWORK and a rework order has been spawned. */
    reworkWorkOrderId: WorkOrderId | null;
}
export declare class ScrapRecord extends AggregateRoot<ScrapRecordProps> {
    private constructor();
    static record(tenantId: TenantId, input: {
        workOrderId: WorkOrderId;
        operationSeq: number;
        sku: string;
        quantity: number;
        uom: UnitOfMeasure;
        reasonCode: ScrapReasonCode;
        disposition: ScrapDisposition;
        notes?: string;
        reportedBy: string;
        costImpact?: Money;
    }): ScrapRecord;
    get workOrderRef(): WorkOrderId;
    get disposition(): ScrapDisposition;
    get quantity(): number;
    get reasonCode(): ScrapReasonCode;
    get reworkWorkOrderId(): WorkOrderId | null;
    linkReworkOrder(reworkWorkOrderId: WorkOrderId): void;
}
//# sourceMappingURL=scrap-record.d.ts.map