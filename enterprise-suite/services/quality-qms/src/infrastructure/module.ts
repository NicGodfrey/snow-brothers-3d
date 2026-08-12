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
import { SystemClock } from "./in-memory/clock.js";
import { InMemoryNumberSeries } from "./in-memory/number-series.js";
import { InMemoryOutbox } from "./in-memory/outbox.js";
import {
  InMemoryAuditRepository,
  InMemoryAuditTemplateRepository,
  InMemoryCapaRepository,
  InMemoryInspectionLotRepository,
  InMemoryInspectionPlanRepository,
  InMemoryNcrRepository,
  InMemorySupplierQualityEventRepository,
} from "./in-memory/repositories.js";

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

export function createQualityQmsModule(options?: { clock?: Clock }): QualityQmsModule {
  const clock = options?.clock ?? new SystemClock();
  const outbox = new InMemoryOutbox();
  const numbers = new InMemoryNumberSeries(clock);

  const repos = {
    plans: new InMemoryInspectionPlanRepository(),
    lots: new InMemoryInspectionLotRepository(),
    ncrs: new InMemoryNcrRepository(),
    capas: new InMemoryCapaRepository(),
    supplierEvents: new InMemorySupplierQualityEventRepository(),
    auditTemplates: new InMemoryAuditTemplateRepository(),
    audits: new InMemoryAuditRepository(),
  };

  const capas = new CapaService(repos.capas, outbox, numbers, clock);
  const supplierQuality = new SupplierQualityService(repos.supplierEvents, outbox, numbers, clock);
  const ncrs = new NcrService(repos.ncrs, outbox, numbers, capas, supplierQuality);
  const plans = new InspectionPlanService(repos.plans, outbox);
  const lots = new InspectionLotService(
    repos.lots,
    repos.plans,
    outbox,
    numbers,
    clock,
    ncrs,
    supplierQuality,
  );
  const audits = new AuditService(
    repos.auditTemplates,
    repos.audits,
    repos.ncrs,
    repos.capas,
    outbox,
    numbers,
    supplierQuality,
  );

  return {
    clock,
    outbox,
    repos,
    services: { plans, lots, ncrs, capas, supplierQuality, audits },
  };
}
