// Domain
export * from "./domain/events.js";
export * from "./domain/utm.js";
export * from "./domain/channel.js";
export * from "./domain/campaign.js";
export * from "./domain/segment.js";
export * from "./domain/audience.js";
export * from "./domain/lead.js";
export * from "./domain/lead-scoring.js";
export * from "./domain/content-asset.js";
export * from "./domain/touchpoint.js";
export * from "./domain/send-job.js";
export * from "./domain/attribution.js";
export * from "./domain/budget.js";

// Application
export * from "./application/ports.js";
export * from "./application/dto.js";
export * from "./application/channel-service.js";
export * from "./application/campaign-service.js";
export * from "./application/segment-service.js";
export * from "./application/audience-service.js";
export * from "./application/lead-service.js";
export * from "./application/lead-scoring-service.js";
export * from "./application/handoff-service.js";
export * from "./application/content-service.js";
export * from "./application/send-job-service.js";
export * from "./application/attribution-service.js";
export * from "./application/budget-service.js";
export * from "./application/tracked-link-service.js";

// Infrastructure
export * from "./infrastructure/clock.js";
export * from "./infrastructure/outbox.js";
export * from "./infrastructure/in-memory-repos.js";
export * from "./infrastructure/simulated-sender.js";
export * from "./infrastructure/container.js";
export * from "./infrastructure/seed.js";

// HTTP
export { Router, type HttpRequest, type HttpResponse, type RouteHandler } from "./http/router.js";
export { tenantContextFromHeaders } from "./http/context.js";
export { buildRouter, createMarketingServer } from "./http/server.js";
