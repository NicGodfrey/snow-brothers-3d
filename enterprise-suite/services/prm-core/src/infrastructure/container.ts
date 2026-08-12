import { ContractService } from "../application/contract-service.js";
import { EntitlementService } from "../application/entitlement-service.js";
import { MdfBudgetService } from "../application/mdf-budget-service.js";
import { MdfService } from "../application/mdf-service.js";
import { PartnerService } from "../application/partner-service.js";
import { PortalService } from "../application/portal-service.js";
import type { Clock, TokenIssuer } from "../application/ports.js";
import { TierService } from "../application/tier-service.js";
import { TrainingService } from "../application/training-service.js";
import {
  InMemoryCertificationDefinitionRepository,
  InMemoryCertificationRepository,
  InMemoryContractRepository,
  InMemoryCourseRepository,
  InMemoryEnrollmentRepository,
  InMemoryEntitlementDefinitionRepository,
  InMemoryEntitlementGrantRepository,
  InMemoryMdfBudgetRepository,
  InMemoryMdfClaimRepository,
  InMemoryMdfRequestRepository,
  InMemoryOutbox,
  InMemoryPartnerRepository,
  InMemoryPerformanceRepository,
  InMemoryPortalUserRepository,
  InMemorySequenceRepository,
  InMemoryTierDefinitionRepository,
  RandomTokenIssuer,
  SystemClock,
} from "./memory/stores.js";

/** Composition root: repositories, outbox, clock, token issuer and services. */
export interface PrmContainer {
  readonly repos: {
    readonly partners: InMemoryPartnerRepository;
    readonly tiers: InMemoryTierDefinitionRepository;
    readonly performance: InMemoryPerformanceRepository;
    readonly contracts: InMemoryContractRepository;
    readonly budgets: InMemoryMdfBudgetRepository;
    readonly requests: InMemoryMdfRequestRepository;
    readonly claims: InMemoryMdfClaimRepository;
    readonly courses: InMemoryCourseRepository;
    readonly certificationDefinitions: InMemoryCertificationDefinitionRepository;
    readonly enrollments: InMemoryEnrollmentRepository;
    readonly certifications: InMemoryCertificationRepository;
    readonly portalUsers: InMemoryPortalUserRepository;
    readonly entitlementDefinitions: InMemoryEntitlementDefinitionRepository;
    readonly entitlementGrants: InMemoryEntitlementGrantRepository;
    readonly sequences: InMemorySequenceRepository;
  };
  readonly outbox: InMemoryOutbox;
  readonly clock: Clock;
  readonly tokens: TokenIssuer;
  readonly services: {
    readonly partner: PartnerService;
    readonly tier: TierService;
    readonly contract: ContractService;
    readonly mdfBudget: MdfBudgetService;
    readonly mdf: MdfService;
    readonly training: TrainingService;
    readonly portal: PortalService;
    readonly entitlement: EntitlementService;
  };
}

export function createContainer(
  options: { readonly clock?: Clock; readonly tokens?: TokenIssuer } = {},
): PrmContainer {
  const clock = options.clock ?? new SystemClock();
  const tokens = options.tokens ?? new RandomTokenIssuer();
  const outbox = new InMemoryOutbox();

  const partners = new InMemoryPartnerRepository();
  const tiers = new InMemoryTierDefinitionRepository();
  const performance = new InMemoryPerformanceRepository();
  const contracts = new InMemoryContractRepository();
  const budgets = new InMemoryMdfBudgetRepository();
  const requests = new InMemoryMdfRequestRepository();
  const claims = new InMemoryMdfClaimRepository();
  const courses = new InMemoryCourseRepository();
  const certificationDefinitions = new InMemoryCertificationDefinitionRepository();
  const enrollments = new InMemoryEnrollmentRepository();
  const certifications = new InMemoryCertificationRepository();
  const portalUsers = new InMemoryPortalUserRepository();
  const entitlementDefinitions = new InMemoryEntitlementDefinitionRepository();
  const entitlementGrants = new InMemoryEntitlementGrantRepository();
  const sequences = new InMemorySequenceRepository();

  const partner = new PartnerService(partners, contracts, performance, sequences, outbox, clock);
  const contract = new ContractService(contracts, partners, sequences, outbox, clock);
  const tier = new TierService(tiers, partners, contracts, performance, certifications, outbox, clock);
  const mdfBudget = new MdfBudgetService(budgets, partners, outbox, clock);
  const mdf = new MdfService(
    budgets,
    requests,
    claims,
    partners,
    contracts,
    tiers,
    sequences,
    outbox,
    clock,
  );
  const portal = new PortalService(portalUsers, partners, tokens, outbox, clock);
  const training = new TrainingService(
    courses,
    certificationDefinitions,
    enrollments,
    certifications,
    portalUsers,
    outbox,
    clock,
  );
  const entitlement = new EntitlementService(
    entitlementDefinitions,
    entitlementGrants,
    partners,
    portalUsers,
    contracts,
    certifications,
    outbox,
    clock,
  );

  return {
    repos: {
      partners,
      tiers,
      performance,
      contracts,
      budgets,
      requests,
      claims,
      courses,
      certificationDefinitions,
      enrollments,
      certifications,
      portalUsers,
      entitlementDefinitions,
      entitlementGrants,
      sequences,
    },
    outbox,
    clock,
    tokens,
    services: { partner, tier, contract, mdfBudget, mdf, training, portal, entitlement },
  };
}
