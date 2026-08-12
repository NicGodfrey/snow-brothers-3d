import { AggregateRoot, DomainError, envelope, } from "@enterprise-suite/shared-kernel";
import { MesEvents } from "./events.js";
import { asUlid, isUnitOfMeasure } from "./ids.js";
export class MaterialIssue extends AggregateRoot {
    constructor(tenantId, props) {
        super(tenantId, props);
    }
    static post(tenantId, input) {
        if (!input.warehouseCode.trim()) {
            throw new DomainError("warehouseCode is required", "MATERIAL_INVALID_WAREHOUSE");
        }
        if (input.lines.length === 0) {
            throw new DomainError("Material document requires at least one line", "MATERIAL_NO_LINES");
        }
        const lines = input.lines.map((line, i) => {
            if (!line.componentSku.trim()) {
                throw new DomainError(`Line ${i + 1}: componentSku is required`, "MATERIAL_INVALID_LINE");
            }
            if (!(line.qty > 0)) {
                throw new DomainError(`Line ${i + 1}: qty must be positive`, "MATERIAL_INVALID_LINE");
            }
            if (!isUnitOfMeasure(line.uom)) {
                throw new DomainError(`Line ${i + 1}: unknown UoM '${line.uom}'`, "MATERIAL_INVALID_UOM");
            }
            return {
                componentSku: line.componentSku.trim().toUpperCase(),
                qty: line.qty,
                uom: line.uom,
                lotNumber: line.lotNumber?.trim() || null,
                binCode: line.binCode?.trim() || null,
                unplanned: line.unplanned ?? false,
            };
        });
        const doc = new MaterialIssue(tenantId, {
            workOrderId: input.workOrderId,
            direction: input.direction,
            warehouseCode: input.warehouseCode.trim().toUpperCase(),
            lines,
            postedBy: input.postedBy,
            note: input.note?.trim() || null,
        });
        const payload = {
            materialIssueId: doc.id,
            workOrderId: input.workOrderId,
            direction: input.direction,
            warehouseCode: doc.props.warehouseCode,
            lines: lines.map((l) => ({
                componentSku: l.componentSku,
                qty: l.qty,
                uom: l.uom,
                lotNumber: l.lotNumber,
                unplanned: l.unplanned,
            })),
        };
        doc.raise(envelope({
            eventType: input.direction === "ISSUE" ? MesEvents.MaterialIssued : MesEvents.MaterialReturned,
            aggregateType: "MaterialIssue",
            aggregateId: asUlid(doc.id),
            tenantId,
            payload,
        }));
        return doc;
    }
    get workOrderRef() {
        return this.props.workOrderId;
    }
    get direction() {
        return this.props.direction;
    }
    get lines() {
        return this.props.lines;
    }
}
//# sourceMappingURL=material-issue.js.map