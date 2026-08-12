/**
 * Composition root: wires repositories, ports and application services
 * into one QualityQmsModule. Tests and the HTTP server both build on this.
 */
import { AuditService } from "../application/audit-service.js";
import { CapaService } from "../application/capa-service.js";
import { InspectionLotService } from "../application/inspection-lot-service.js";
import { InspectionPlanService } from "../application/inspection-plan-service.js";
import { NcrService } from "../application/ncr-service.js";
import type { Clock } from "../application/ports.js";
import { SupplierQualityService } from "../application/supplier-quality-service.js";
import { InMemoryOutbox } from "./in-memory/outbox.js";
import { InMemoryAuditRepository, InMemoryAuditTemplateRepository, InMemoryCapaRepository, InMemoryInspectionLotRepository, InMemoryInspectionPlanRepository, InMemoryNcrRepository, InMemorySupplierQualityEventRepository } from "./in-memory/repositories.js";
export interface QualityQmsModule {
    clock: Clock;
    outbox: InMemoryOutbox;
    repos: {
        plans: InMemoryInspectionPlanRepository;
        lots: InMemoryInspectionLotRepository;
        ncrs: InMemoryNcrRepository;
        capas: InMemoryCapaRepository;
        supplierEvents: InMemorySupplierQualityEventRepository;
        auditTemplates: InMemoryAuditTemplateRepository;
        audits: InMemoryAuditRepository;
    };
    services: {
        plans: InspectionPlanService;
        lots: InspectionLotService;
        ncrs: NcrService;
        capas: CapaService;
        supplierQuality: SupplierQualityService;
        audits: AuditService;
    };
}
export declare function createQualityQmsModule(options?: {
    clock?: Clock;
}): QualityQmsModule;
//# sourceMappingURL=module.d.ts.map