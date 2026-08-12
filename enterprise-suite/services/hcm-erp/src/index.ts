// Domain
export * from "./domain/common.js";
export * from "./domain/events.js";
export * from "./domain/org-unit.js";
export * from "./domain/position.js";
export * from "./domain/employee.js";
export * from "./domain/employment-contract.js";
export * from "./domain/leave.js";
export * from "./domain/attendance.js";
export * from "./domain/compensation.js";
export * from "./domain/skills.js";
export * from "./domain/requisition.js";

// Application
export * from "./application/ports.js";
export * from "./application/org-service.js";
export * from "./application/employee-service.js";
export * from "./application/contract-service.js";
export * from "./application/leave-service.js";
export * from "./application/attendance-service.js";
export * from "./application/compensation-service.js";
export * from "./application/skills-service.js";
export * from "./application/requisition-service.js";

// Infrastructure
export * from "./infrastructure/in-memory.js";

// Composition + HTTP
export * from "./module.js";
export { buildHcmRouter } from "./http/app.js";
export { createHcmServer } from "./http/server.js";
export { Router, jsonOk, created, errorToResponse } from "./http/router.js";
export type { HttpRequest, HttpResponse, RouteHandler } from "./http/router.js";

// Fixtures
export { seedDemoTenant, type SeedResult } from "./fixtures/seed.js";
