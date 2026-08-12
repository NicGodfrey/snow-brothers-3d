import type { Clock, MessageSenderPort } from "../application/ports.js";
import { AttributionService } from "../application/attribution-service.js";
import { AudienceService } from "../application/audience-service.js";
import { BudgetService } from "../application/budget-service.js";
import { CampaignService } from "../application/campaign-service.js";
import { ChannelService } from "../application/channel-service.js";
import { ContentService } from "../application/content-service.js";
import { HandoffService } from "../application/handoff-service.js";
import { LeadService } from "../application/lead-service.js";
import { LeadScoringService } from "../application/lead-scoring-service.js";
import { SegmentService } from "../application/segment-service.js";
import { SendJobService } from "../application/send-job-service.js";
import { TrackedLinkService } from "../application/tracked-link-service.js";
import { SystemClock } from "./clock.js";
import {
  InMemoryAudienceRepository,
  InMemoryBudgetRepository,
  InMemoryCampaignRepository,
  InMemoryChannelRepository,
  InMemoryContentAssetRepository,
  InMemoryLeadRepository,
  InMemoryScoringModelRepository,
  InMemorySegmentRepository,
  InMemorySendJobRepository,
  InMemoryTouchpointRepository,
  InMemoryTrackedLinkRepository,
} from "./in-memory-repos.js";
import { InMemoryOutbox } from "./outbox.js";
import { SimulatedMessageSender } from "./simulated-sender.js";

export interface MarketingModule {
  readonly repos: {
    readonly channels: InMemoryChannelRepository;
    readonly campaigns: InMemoryCampaignRepository;
    readonly segments: InMemorySegmentRepository;
    readonly audiences: InMemoryAudienceRepository;
    readonly leads: InMemoryLeadRepository;
    readonly scoringModels: InMemoryScoringModelRepository;
    readonly contents: InMemoryContentAssetRepository;
    readonly sendJobs: InMemorySendJobRepository;
    readonly touchpoints: InMemoryTouchpointRepository;
    readonly trackedLinks: InMemoryTrackedLinkRepository;
    readonly budgets: InMemoryBudgetRepository;
  };
  readonly services: {
    readonly channels: ChannelService;
    readonly campaigns: CampaignService;
    readonly segments: SegmentService;
    readonly audiences: AudienceService;
    readonly leads: LeadService;
    readonly scoring: LeadScoringService;
    readonly handoff: HandoffService;
    readonly content: ContentService;
    readonly sendJobs: SendJobService;
    readonly attribution: AttributionService;
    readonly budgets: BudgetService;
    readonly trackedLinks: TrackedLinkService;
  };
  readonly outbox: InMemoryOutbox;
  readonly clock: Clock;
  readonly sender: MessageSenderPort;
}

/** Composition root: wires repositories, ports, and services together. */
export function createMarketingModule(options?: {
  clock?: Clock;
  sender?: MessageSenderPort;
}): MarketingModule {
  const clock = options?.clock ?? new SystemClock();
  const sender = options?.sender ?? new SimulatedMessageSender();
  const outbox = new InMemoryOutbox();

  const repos = {
    channels: new InMemoryChannelRepository(),
    campaigns: new InMemoryCampaignRepository(),
    segments: new InMemorySegmentRepository(),
    audiences: new InMemoryAudienceRepository(),
    leads: new InMemoryLeadRepository(),
    scoringModels: new InMemoryScoringModelRepository(),
    contents: new InMemoryContentAssetRepository(),
    sendJobs: new InMemorySendJobRepository(),
    touchpoints: new InMemoryTouchpointRepository(),
    trackedLinks: new InMemoryTrackedLinkRepository(),
    budgets: new InMemoryBudgetRepository(),
  };

  const attribution = new AttributionService(repos.leads, repos.touchpoints);

  const services = {
    channels: new ChannelService(repos.channels, outbox),
    campaigns: new CampaignService(repos.campaigns, repos.channels, outbox),
    segments: new SegmentService(repos.segments, repos.leads, outbox),
    audiences: new AudienceService(
      repos.audiences,
      repos.segments,
      repos.leads,
      repos.campaigns,
      clock,
      outbox,
    ),
    leads: new LeadService(repos.leads, repos.touchpoints, repos.campaigns, clock, outbox),
    scoring: new LeadScoringService(repos.scoringModels, repos.leads, clock, outbox),
    handoff: new HandoffService(repos.leads, repos.touchpoints, repos.campaigns, clock, outbox),
    content: new ContentService(repos.contents, clock, outbox),
    sendJobs: new SendJobService(
      repos.sendJobs,
      repos.audiences,
      repos.contents,
      repos.campaigns,
      repos.channels,
      repos.leads,
      repos.touchpoints,
      sender,
      clock,
      outbox,
    ),
    attribution,
    budgets: new BudgetService(repos.budgets, repos.campaigns, attribution, clock, outbox),
    trackedLinks: new TrackedLinkService(
      repos.trackedLinks,
      repos.campaigns,
      repos.channels,
      repos.leads,
      repos.touchpoints,
      clock,
      outbox,
    ),
  };

  return { repos, services, outbox, clock, sender };
}
