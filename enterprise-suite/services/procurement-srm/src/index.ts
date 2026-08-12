// Domain
export * from "./domain/common.js";
export * from "./domain/errors.js";
export * from "./domain/events.js";
export * from "./domain/numbering.js";
export * from "./domain/supplier.js";
export * from "./domain/requisition.js";
export * from "./domain/approval.js";
export * from "./domain/rfq.js";
export * from "./domain/quote.js";
export * from "./domain/quote-evaluation.js";
export * from "./domain/purchase-order.js";
export * from "./domain/receipt.js";
export * from "./domain/invoice.js";
export * from "./domain/three-way-match.js";
export * from "./domain/blanket-agreement.js";

// Application
export * from "./application/ports.js";
export * from "./application/supplier-directory-service.js";
export * from "./application/approval-service.js";
export * from "./application/requisition-service.js";
export * from "./application/sourcing-service.js";
export * from "./application/purchase-order-service.js";
export * from "./application/receipt-service.js";
export * from "./application/matching-service.js";
export * from "./application/agreement-service.js";
export * from "./application/spend-service.js";

// Infrastructure
export * from "./infrastructure/in-memory.js";

// Composition + HTTP
export * from "./module.js";
export { buildProcurementRouter } from "./http/app.js";
export { createProcurementServer } from "./http/server.js";
export { Router, jsonOk, created, noContent, errorToResponse } from "./http/router.js";
export type { HttpRequest, HttpResponse, RouteHandler } from "./http/router.js";

// Fixtures
export { seedDemoTenant, type SeedResult } from "./fixtures/seed.js";
