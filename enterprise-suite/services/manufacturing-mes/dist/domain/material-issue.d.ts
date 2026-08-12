import { AggregateRoot, type TenantId } from "@enterprise-suite/shared-kernel";
import { type UnitOfMeasure, type WorkOrderId } from "./ids.js";
export type MaterialDirection = "ISSUE" | "RETURN";
/**
 * A posted, immutable inventory movement document: components issued from a
 * warehouse to a work order (or returned back). Inventory-wms consumes the
 * corresponding event to adjust stock.
 */
export interface MaterialIssueLine {
    readonly componentSku: string;
    readonly qty: number;
    readonly uom: UnitOfMeasure;
    readonly lotNumber: string | null;
    readonly binCode: string | null;
    /** True when the component was not on the work order BOM. */
    readonly unplanned: boolean;
}
export interface MaterialIssueProps {
    readonly workOrderId: WorkOrderId;
    readonly direction: MaterialDirection;
    readonly warehouseCode: string;
    readonly lines: readonly MaterialIssueLine[];
    readonly postedBy: string;
    readonly note: string | null;
}
export interface MaterialIssueLineInput {
    componentSku: string;
    qty: number;
    uom: string;
    lotNumber?: string;
    binCode?: string;
    unplanned?: boolean;
}
export declare class MaterialIssue extends AggregateRoot<MaterialIssueProps> {
    private constructor();
    static post(tenantId: TenantId, input: {
        workOrderId: WorkOrderId;
        direction: MaterialDirection;
        warehouseCode: string;
        lines: MaterialIssueLineInput[];
        postedBy: string;
        note?: string;
    }): MaterialIssue;
    get workOrderRef(): WorkOrderId;
    get direction(): MaterialDirection;
    get lines(): readonly MaterialIssueLine[];
}
//# sourceMappingURL=material-issue.d.ts.map