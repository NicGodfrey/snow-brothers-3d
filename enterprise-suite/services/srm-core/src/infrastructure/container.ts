import { CategoryService } from "../application/category-service.js";
import { ContractService } from "../application/contract-service.js";
import { EligibilityService } from "../application/eligibility-service.js";
import { OnboardingService } from "../application/onboarding-service.js";
import { PerformanceService } from "../application/performance-service.js";
import type { Clock } from "../application/ports.js";
import { QualificationService } from "../application/qualification-service.js";
import { RiskService } from "../application/risk-service.js";
import { SupplierService } from "../application/supplier-service.js";
import {
  InMemoryCategoryRepository,
  InMemoryCertificationRepository,
  InMemoryContractRepository,
  InMemoryKpiDefinitionRepository,
  InMemoryOnboardingRepository,
  InMemoryOutbox,
  InMemoryQualificationRepository,
  InMemoryRiskProfileRepository,
  InMemoryScorecardRepository,
  InMemorySupplierRepository,
  SystemClock,
} from "./memory/stores.js";

/** Composition root: repositories, outbox, clock and application services. */
export interface SrmContainer {
  readonly repos: {
    readonly suppliers: InMemorySupplierRepository;
    readonly categories: InMemoryCategoryRepository;
    readonly onboarding: InMemoryOnboardingRepository;
    readonly certifications: InMemoryCertificationRepository;
    readonly qualifications: InMemoryQualificationRepository;
    readonly kpis: InMemoryKpiDefinitionRepository;
    readonly scorecards: InMemoryScorecardRepository;
    readonly contracts: InMemoryContractRepository;
    readonly riskProfiles: InMemoryRiskProfileRepository;
  };
  readonly outbox: InMemoryOutbox;
  readonly clock: Clock;
  readonly services: {
    readonly category: CategoryService;
    readonly supplier: SupplierService;
    readonly onboarding: OnboardingService;
    readonly qualification: QualificationService;
    readonly performance: PerformanceService;
    readonly contract: ContractService;
    readonly risk: RiskService;
    readonly eligibility: EligibilityService;
  };
}

export function createContainer(options: { readonly clock?: Clock } = {}): SrmContainer {
  const clock = options.clock ?? new SystemClock();
  const outbox = new InMemoryOutbox();

  const suppliers = new InMemorySupplierRepository();
  const categories = new InMemoryCategoryRepository();
  const onboardingCases = new InMemoryOnboardingRepository();
  const certifications = new InMemoryCertificationRepository();
  const qualifications = new InMemoryQualificationRepository();
  const kpis = new InMemoryKpiDefinitionRepository();
  const scorecards = new InMemoryScorecardRepository();
  const contracts = new InMemoryContractRepository();
  const riskProfiles = new InMemoryRiskProfileRepository();

  const category = new CategoryService(categories, outbox, clock);
  const supplier = new SupplierService(
    suppliers,
    categories,
    certifications,
    qualifications,
    riskProfiles,
    outbox,
    clock,
  );
  const onboarding = new OnboardingService(onboardingCases, suppliers, certifications, riskProfiles, outbox, clock);
  const qualification = new QualificationService(
    qualifications,
    certifications,
    suppliers,
    categories,
    riskProfiles,
    outbox,
    clock,
  );
  const contract = new ContractService(contracts, suppliers, categories, riskProfiles, outbox, clock);
  const performance = new PerformanceService(scorecards, kpis, suppliers, contracts, riskProfiles, outbox, clock);
  const risk = new RiskService(riskProfiles, suppliers, outbox, clock);
  const eligibility = new EligibilityService(
    suppliers,
    categories,
    qualifications,
    certifications,
    contracts,
    scorecards,
    riskProfiles,
    clock,
  );

  return {
    repos: {
      suppliers,
      categories,
      onboarding: onboardingCases,
      certifications,
      qualifications,
      kpis,
      scorecards,
      contracts,
      riskProfiles,
    },
    outbox,
    clock,
    services: {
      category,
      supplier,
      onboarding,
      qualification,
      performance,
      contract,
      risk,
      eligibility,
    },
  };
}
