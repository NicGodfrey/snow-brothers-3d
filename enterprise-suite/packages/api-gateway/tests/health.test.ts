import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HealthService } from "../src/application/health-service.js";
import type { ProbeKind, ProbeResult, UpstreamProbe } from "../src/application/ports.js";
import { ServiceCatalog, defineService, type UpstreamService } from "../src/domain/service-catalog.js";
import { FixedClock } from "../src/infrastructure/clock.js";
import { MemoryLogger } from "../src/infrastructure/logger.js";
import { StaticUpstreamProbe } from "../src/infrastructure/http-probe.js";

function catalog(): ServiceCatalog {
  return new ServiceCatalog([
    defineService({ id: "finance-erp", label: "Finance", system: "ERP", prefix: "/api/finance", baseUrl: "http://127.0.0.1:4108", critical: true }),
    defineService({ id: "marketing-erp", label: "Marketing", system: "ERP", prefix: "/api/marketing", baseUrl: "http://127.0.0.1:4104" }),
    defineService({ id: "prm-core", label: "PRM", system: "PRM", prefix: "/api/prm", baseUrl: "http://127.0.0.1:4115", planned: true }),
  ]);
}

class CountingProbe implements UpstreamProbe {
  calls = 0;
  constructor(private readonly clock: FixedClock) {}
  async probe(service: UpstreamService, kind: ProbeKind): Promise<ProbeResult> {
    this.calls += 1;
    return {
      serviceId: service.id,
      status: "up",
      latencyMs: 1,
      checkedAt: this.clock.now(),
      detail: kind,
    };
  }
}

describe("liveness", () => {
  it("never touches the network and reports uptime", () => {
    const clock = new FixedClock();
    const health = new HealthService(catalog(), new StaticUpstreamProbe({}, clock), clock);
    clock.advance(1_500);
    const report = health.live();
    assert.equal(report.status, "ok");
    assert.equal(report.service, "api-gateway");
    assert.equal(report.uptimeMs, 1_500);
  });
});

describe("readiness", () => {
  it("is ready when every deployed upstream answers", async () => {
    const clock = new FixedClock();
    const health = new HealthService(catalog(), new StaticUpstreamProbe({}, clock), clock);
    const report = await health.ready();
    assert.equal(report.status, "ready");
    assert.equal(report.httpStatus, 200);
    assert.equal(report.summary.up, 2);
    assert.equal(report.summary.unknown, 1, "planned services report unknown, not down");
    assert.deepEqual(
      report.upstreams.map((u) => u.serviceId),
      ["finance-erp", "marketing-erp", "prm-core"],
    );
  });

  it("degrades on a non-critical failure but stays in rotation", async () => {
    const clock = new FixedClock();
    const logger = new MemoryLogger();
    const probe = new StaticUpstreamProbe({ "marketing-erp": "down" }, clock);
    const health = new HealthService(catalog(), probe, clock, logger);
    const report = await health.ready();
    assert.equal(report.status, "degraded");
    assert.equal(report.httpStatus, 200);
    assert.deepEqual(report.summary.criticalDown, []);
    assert.equal(logger.withLevel("warn").length, 1);
  });

  it("goes unready with 503 when a critical upstream is down", async () => {
    const clock = new FixedClock();
    const probe = new StaticUpstreamProbe({ "finance-erp": "down" }, clock);
    const report = await new HealthService(catalog(), probe, clock).ready();
    assert.equal(report.status, "unready");
    assert.equal(report.httpStatus, 503);
    assert.deepEqual(report.summary.criticalDown, ["finance-erp"]);
  });

  it("treats a slow upstream as degraded", async () => {
    const clock = new FixedClock();
    const probe = new StaticUpstreamProbe({ "finance-erp": "degraded" }, clock);
    const report = await new HealthService(catalog(), probe, clock).ready();
    assert.equal(report.status, "degraded");
    assert.equal(report.summary.degraded, 1);
  });

  it("converts a throwing probe into a down result instead of failing the check", async () => {
    const clock = new FixedClock();
    const exploding: UpstreamProbe = {
      async probe(service) {
        if (service.id === "finance-erp") throw new Error("ECONNREFUSED");
        return { serviceId: service.id, status: "up", latencyMs: 1, checkedAt: clock.now() };
      },
    };
    const report = await new HealthService(catalog(), exploding, clock).ready();
    assert.equal(report.status, "unready");
    assert.equal(report.upstreams.find((u) => u.serviceId === "finance-erp")?.detail, "ECONNREFUSED");
  });

  it("caches probe results for the TTL and refreshes on force", async () => {
    const clock = new FixedClock();
    const probe = new CountingProbe(clock);
    const health = new HealthService(catalog(), probe, clock, undefined, { cacheTtlMs: 5_000 });

    await health.ready();
    await health.ready();
    assert.equal(probe.calls, 2, "two deployed upstreams probed once, second call served from cache");

    await health.ready({ force: true });
    assert.equal(probe.calls, 4);

    clock.advance(5_001);
    await health.ready();
    assert.equal(probe.calls, 6, "cache expired");
  });

  it("can probe a subset of the catalog", async () => {
    const clock = new FixedClock();
    const health = new HealthService(catalog(), new StaticUpstreamProbe({}, clock), clock);
    const report = await health.ready({ only: ["finance-erp"] });
    assert.equal(report.summary.total, 1);
    assert.equal(report.upstreams[0]?.serviceId, "finance-erp");
  });
});
