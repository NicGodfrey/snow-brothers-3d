import type { TenantId } from "@enterprise-suite/shared-kernel";
import type { CapacityCalendar } from "../../domain/capacity-calendar.js";
import type {
  CapacityCalendarId,
  MaterialIssueId,
  ProductionReceiptId,
  RoutingId,
  ScrapRecordId,
  ShiftTemplateId,
  WorkCenterId,
  WorkOrderId,
} from "../../domain/ids.js";
import type { MaterialIssue } from "../../domain/material-issue.js";
import type { ProductionReceipt } from "../../domain/production-receipt.js";
import type { Routing, RoutingStatus } from "../../domain/routing.js";
import type { ScrapRecord } from "../../domain/scrap-record.js";
import type { ShiftTemplate } from "../../domain/shift-template.js";
import type { WorkCenter } from "../../domain/work-center.js";
import type { WorkOrder, WorkOrderStatus } from "../../domain/work-order.js";
import type {
  CapacityCalendarRepository,
  MaterialIssueRepository,
  ProductionReceiptRepository,
  RoutingRepository,
  ScrapRecordRepository,
  ShiftTemplateRepository,
  WorkCenterRepository,
  WorkOrderRepository,
} from "../../application/ports.js";
import { InMemoryStore } from "./base-repository.js";

export class InMemoryWorkCenterRepository implements WorkCenterRepository {
  private readonly store = new InMemoryStore<WorkCenter>();

  async save(workCenter: WorkCenter): Promise<void> {
    this.store.set(workCenter);
  }

  async findById(tenantId: TenantId, id: WorkCenterId): Promise<WorkCenter | null> {
    return this.store.get(tenantId, id);
  }

  async findByCode(tenantId: TenantId, code: string): Promise<WorkCenter | null> {
    return this.store.allForTenant(tenantId).find((wc) => wc.code === code) ?? null;
  }

  async list(tenantId: TenantId): Promise<WorkCenter[]> {
    return this.store.allForTenant(tenantId);
  }
}

export class InMemoryShiftTemplateRepository implements ShiftTemplateRepository {
  private readonly store = new InMemoryStore<ShiftTemplate>();

  async save(template: ShiftTemplate): Promise<void> {
    this.store.set(template);
  }

  async findById(tenantId: TenantId, id: ShiftTemplateId): Promise<ShiftTemplate | null> {
    return this.store.get(tenantId, id);
  }

  async findByCode(tenantId: TenantId, code: string): Promise<ShiftTemplate | null> {
    return this.store.allForTenant(tenantId).find((t) => t.code === code) ?? null;
  }

  async list(tenantId: TenantId): Promise<ShiftTemplate[]> {
    return this.store.allForTenant(tenantId);
  }
}

export class InMemoryCapacityCalendarRepository implements CapacityCalendarRepository {
  private readonly store = new InMemoryStore<CapacityCalendar>();

  async save(calendar: CapacityCalendar): Promise<void> {
    this.store.set(calendar);
  }

  async findById(tenantId: TenantId, id: CapacityCalendarId): Promise<CapacityCalendar | null> {
    return this.store.get(tenantId, id);
  }

  async findByCode(tenantId: TenantId, code: string): Promise<CapacityCalendar | null> {
    return this.store.allForTenant(tenantId).find((c) => c.code === code) ?? null;
  }

  async list(tenantId: TenantId): Promise<CapacityCalendar[]> {
    return this.store.allForTenant(tenantId);
  }
}

export class InMemoryRoutingRepository implements RoutingRepository {
  private readonly store = new InMemoryStore<Routing>();

  async save(routing: Routing): Promise<void> {
    this.store.set(routing);
  }

  async findById(tenantId: TenantId, id: RoutingId): Promise<Routing | null> {
    return this.store.get(tenantId, id);
  }

  async findBySkuRevision(
    tenantId: TenantId,
    sku: string,
    revision: string,
  ): Promise<Routing | null> {
    return (
      this.store
        .allForTenant(tenantId)
        .find((r) => r.sku === sku && r.revision === revision) ?? null
    );
  }

  async findReleasedForSku(tenantId: TenantId, sku: string): Promise<Routing | null> {
    const released = this.store
      .allForTenant(tenantId)
      .filter((r) => r.sku === sku && r.status === "RELEASED")
      .sort((a, b) => (b.toJSON().releasedAt ?? "").localeCompare(a.toJSON().releasedAt ?? ""));
    return released[0] ?? null;
  }

  async list(
    tenantId: TenantId,
    filter?: { sku?: string; status?: RoutingStatus },
  ): Promise<Routing[]> {
    return this.store.allForTenant(tenantId).filter((r) => {
      if (filter?.sku && r.sku !== filter.sku.toUpperCase()) return false;
      if (filter?.status && r.status !== filter.status) return false;
      return true;
    });
  }
}

export class InMemoryWorkOrderRepository implements WorkOrderRepository {
  private readonly store = new InMemoryStore<WorkOrder>();
  private readonly sequences = new Map<string, number>();

  async save(workOrder: WorkOrder): Promise<void> {
    this.store.set(workOrder);
  }

  async findById(tenantId: TenantId, id: WorkOrderId): Promise<WorkOrder | null> {
    return this.store.get(tenantId, id);
  }

  async findByOrderNumber(tenantId: TenantId, orderNumber: string): Promise<WorkOrder | null> {
    return (
      this.store.allForTenant(tenantId).find((wo) => wo.orderNumber === orderNumber) ?? null
    );
  }

  async list(
    tenantId: TenantId,
    filter?: { status?: WorkOrderStatus; sku?: string; dueBefore?: string },
  ): Promise<WorkOrder[]> {
    return this.store.allForTenant(tenantId).filter((wo) => {
      if (filter?.status && wo.status !== filter.status) return false;
      if (filter?.sku && wo.sku !== filter.sku.toUpperCase()) return false;
      if (filter?.dueBefore && wo.dueDate >= filter.dueBefore) return false;
      return true;
    });
  }

  async nextOrderNumber(tenantId: TenantId): Promise<string> {
    const next = (this.sequences.get(tenantId) ?? 0) + 1;
    this.sequences.set(tenantId, next);
    return `WO-${String(next).padStart(6, "0")}`;
  }
}

export class InMemoryMaterialIssueRepository implements MaterialIssueRepository {
  private readonly store = new InMemoryStore<MaterialIssue>();

  async save(doc: MaterialIssue): Promise<void> {
    this.store.set(doc);
  }

  async findById(tenantId: TenantId, id: MaterialIssueId): Promise<MaterialIssue | null> {
    return this.store.get(tenantId, id);
  }

  async listByWorkOrder(tenantId: TenantId, workOrderId: WorkOrderId): Promise<MaterialIssue[]> {
    return this.store
      .allForTenant(tenantId)
      .filter((doc) => doc.workOrderRef === workOrderId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}

export class InMemoryProductionReceiptRepository implements ProductionReceiptRepository {
  private readonly store = new InMemoryStore<ProductionReceipt>();

  async save(doc: ProductionReceipt): Promise<void> {
    this.store.set(doc);
  }

  async findById(tenantId: TenantId, id: ProductionReceiptId): Promise<ProductionReceipt | null> {
    return this.store.get(tenantId, id);
  }

  async listByWorkOrder(
    tenantId: TenantId,
    workOrderId: WorkOrderId,
  ): Promise<ProductionReceipt[]> {
    return this.store
      .allForTenant(tenantId)
      .filter((doc) => doc.workOrderRef === workOrderId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}

export class InMemoryScrapRecordRepository implements ScrapRecordRepository {
  private readonly store = new InMemoryStore<ScrapRecord>();

  async save(record: ScrapRecord): Promise<void> {
    this.store.set(record);
  }

  async findById(tenantId: TenantId, id: ScrapRecordId): Promise<ScrapRecord | null> {
    return this.store.get(tenantId, id);
  }

  async listByWorkOrder(tenantId: TenantId, workOrderId: WorkOrderId): Promise<ScrapRecord[]> {
    return this.store
      .allForTenant(tenantId)
      .filter((record) => record.workOrderRef === workOrderId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async list(tenantId: TenantId, filter?: { reasonCode?: string }): Promise<ScrapRecord[]> {
    return this.store
      .allForTenant(tenantId)
      .filter((record) => !filter?.reasonCode || record.reasonCode === filter.reasonCode)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}
