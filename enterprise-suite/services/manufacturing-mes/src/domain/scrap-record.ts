import {
  AggregateRoot,
  DomainError,
  envelope,
  type Money,
  type TenantId,
} from "@enterprise-suite/shared-kernel";
import { MesEvents, type ScrapRecordedPayload } from "./events.js";
import { asUlid, type UnitOfMeasure, type WorkOrderId } from "./ids.js";

export const SCRAP_REASON_CODES = [
  "MATERIAL_DEFECT",
  "OPERATOR_ERROR",
  "MACHINE_FAULT",
  "SETUP_LOSS",
  "TOOLING_WEAR",
  "PROCESS_DRIFT",
  "HANDLING_DAMAGE",
  "OTHER",
] as const;
export type ScrapReasonCode = (typeof SCRAP_REASON_CODES)[number];

export function isScrapReasonCode(value: string): value is ScrapReasonCode {
  return (SCRAP_REASON_CODES as readonly string[]).includes(value);
}

/**
 * SCRAP      — units destroyed, quantity lost.
 * REWORK     — units routed to a rework work order.
 * USE_AS_IS  — deviation accepted (quality waiver), units continue.
 */
export const SCRAP_DISPOSITIONS = ["SCRAP", "REWORK", "USE_AS_IS"] as const;
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

export class ScrapRecord extends AggregateRoot<ScrapRecordProps> {
  private constructor(tenantId: TenantId, props: ScrapRecordProps) {
    super(tenantId, props);
  }

  static record(
    tenantId: TenantId,
    input: {
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
    },
  ): ScrapRecord {
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
    const payload: ScrapRecordedPayload = {
      scrapRecordId: record.id,
      workOrderId: input.workOrderId,
      operationSeq: input.operationSeq,
      sku: record.props.sku,
      qty: input.quantity,
      uom: input.uom,
      reasonCode: input.reasonCode,
      disposition: input.disposition,
    };
    record.raise(
      envelope({
        eventType: MesEvents.ScrapRecorded,
        aggregateType: "ScrapRecord",
        aggregateId: asUlid(record.id),
        tenantId,
        payload,
      }),
    );
    return record;
  }

  get workOrderRef(): WorkOrderId {
    return this.props.workOrderId;
  }

  get disposition(): ScrapDisposition {
    return this.props.disposition;
  }

  get quantity(): number {
    return this.props.quantity;
  }

  get reasonCode(): ScrapReasonCode {
    return this.props.reasonCode;
  }

  get reworkWorkOrderId(): WorkOrderId | null {
    return this.props.reworkWorkOrderId;
  }

  linkReworkOrder(reworkWorkOrderId: WorkOrderId): void {
    if (this.props.disposition !== "REWORK") {
      throw new DomainError(
        `Cannot link rework order: disposition is ${this.props.disposition}`,
        "SCRAP_NOT_REWORK",
        422,
      );
    }
    if (this.props.reworkWorkOrderId) {
      throw new DomainError(
        "Rework order already linked to this scrap record",
        "SCRAP_REWORK_EXISTS",
        409,
      );
    }
    this.props.reworkWorkOrderId = reworkWorkOrderId;
    this.raise(
      envelope({
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
      }),
    );
  }
}
