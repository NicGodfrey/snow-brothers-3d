import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { brand, tenantId, type IsoDateTime } from "@enterprise-suite/shared-kernel";
import {
  buildTrackingUrl,
  normalizeUtm,
  parseUtmFromUrl,
  TrackedLink,
  utmEquals,
} from "../src/domain/utm.js";

const tenant = tenantId("t_utm");
const at = (iso: string): IsoDateTime => brand<string, "IsoDateTime">(iso);

describe("normalizeUtm", () => {
  it("lowercases, trims and snake_cases values", () => {
    const utm = normalizeUtm({ source: " Google ", medium: "CPC", campaign: "Fall Launch" });
    assert.deepEqual(utm, { source: "google", medium: "cpc", campaign: "fall_launch" });
  });

  it("keeps optional term/content only when present", () => {
    const utm = normalizeUtm({ source: "x", medium: "y", campaign: "z", term: "", content: "Ad-1" });
    assert.equal(utm.term, undefined);
    assert.equal(utm.content, "ad-1");
  });

  it("rejects empty and oversized values", () => {
    assert.throws(() => normalizeUtm({ source: "  ", medium: "cpc", campaign: "c" }), /empty/);
    assert.throws(
      () => normalizeUtm({ source: "a".repeat(200), medium: "cpc", campaign: "c" }),
      /128/,
    );
  });
});

describe("parseUtmFromUrl / buildTrackingUrl", () => {
  it("round-trips utm parameters through a URL", () => {
    const utm = normalizeUtm({
      source: "google",
      medium: "cpc",
      campaign: "q3-launch",
      term: "erp suite",
      content: "headline-a",
    });
    const url = buildTrackingUrl("https://acme.example/landing?ref=x", utm);
    const parsed = parseUtmFromUrl(url);
    assert.ok(utmEquals(parsed, utm));
    assert.ok(url.includes("ref=x"), "existing query params are preserved");
  });

  it("returns undefined for partially tagged URLs", () => {
    assert.equal(
      parseUtmFromUrl("https://acme.example/?utm_source=google&utm_medium=cpc"),
      undefined,
    );
  });

  it("throws on invalid URLs", () => {
    assert.throws(() => parseUtmFromUrl("not a url"), /valid URL/);
  });

  it("replaces stale utm values instead of appending", () => {
    const url = buildTrackingUrl(
      "https://acme.example/?utm_source=old&utm_campaign=old&utm_medium=old&utm_term=old",
      normalizeUtm({ source: "new", medium: "email", campaign: "newsletter" }),
    );
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get("utm_source"), "new");
    assert.equal(parsed.searchParams.get("utm_term"), null, "unused optional params are removed");
    assert.equal(parsed.searchParams.getAll("utm_source").length, 1);
  });
});

describe("TrackedLink", () => {
  function makeLink(): TrackedLink {
    return TrackedLink.create({
      tenantId: tenant,
      shortCode: "q3promo",
      destinationUrl: "https://acme.example/launch",
      utm: normalizeUtm({ source: "google", medium: "cpc", campaign: "q3-launch" }),
    });
  }

  it("exposes the full tracking url", () => {
    const link = makeLink();
    const url = new URL(link.trackingUrl);
    assert.equal(url.searchParams.get("utm_campaign"), "q3-launch");
  });

  it("counts clicks and stamps the last click time", () => {
    const link = makeLink();
    link.recordClick(at("2026-08-05T10:00:00.000Z"));
    link.recordClick(at("2026-08-05T11:00:00.000Z"));
    assert.equal(link.clickCount, 2);
  });

  it("refuses clicks after deactivation", () => {
    const link = makeLink();
    link.deactivate();
    assert.throws(() => link.recordClick(at("2026-08-05T10:00:00.000Z")), /deactivated/);
  });

  it("validates the short code format", () => {
    assert.throws(
      () =>
        TrackedLink.create({
          tenantId: tenant,
          shortCode: "a!",
          destinationUrl: "https://acme.example",
          utm: normalizeUtm({ source: "a", medium: "b", campaign: "c" }),
        }),
      /4-16 alphanumeric/,
    );
  });
});
