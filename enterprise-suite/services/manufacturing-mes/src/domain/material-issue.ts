import {
  AggregateRoot,
  DomainError,
  envelope,
  type TenantId,
} from "@enterprise-suite/shared-kernel";
import { MesEvents, type MaterialIssuedPayload } from "./events.js";
import { asUlid, isUnitOfMeasure, type UnitOfMeasure, type WorkOrderId } from "./ids.js";

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

export class MaterialIssue extends AggregateRoot<MaterialIssueProps> {
  private constructor(tenantId: TenantId, props: MaterialIssueProps) {
    super(tenantId, props);
  }

  static post(
    tenantId: TenantId,
    input: {
      workOrderId: WorkOrderId;
      direction: MaterialDirection;
      warehouseCode: string;
      lines: MaterialIssueLineInput[];
      postedBy: string;
      note?: string;
    },
  ): MaterialIssue {
    if (!input.warehouseCode.trim()) {
      throw new DomainError("warehouseCode is required", "MATERIAL_INVALID_WAREHOUSE");
    }
    if (input.lines.length === 0) {
      throw new DomainError("Material document requires at least one line", "MATERIAL_NO_LINES");
    }
    const lines: MaterialIssueLine[] = input.lines.map((line, i) => {
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
    const payload: MaterialIssuedPayload = {
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
    doc.raise(
      envelope({
        eventType:
          input.direction === "ISSUE" ? MesEvents.MaterialIssued : MesEvents.MaterialReturned,
        aggregateType: "MaterialIssue",
        aggregateId: asUlid(doc.id),
        tenantId,
        payload,
      }),
    );
    return doc;
  }

  get workOrderRef(): WorkOrderId {
    return this.props.workOrderId;
  }

  get direction(): MaterialDirection {
    return this.props.direction;
  }

  get lines(): readonly MaterialIssueLine[] {
    return this.props.lines;
  }
}
