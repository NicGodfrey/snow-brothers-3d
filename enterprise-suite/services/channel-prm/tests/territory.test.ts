import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  customerKey,
  normalizeCompanyName,
  normalizeDomain,
  normalizeProductLines,
  normalizeTerritory,
  productLineOverlap,
  regionOf,
  slugify,
  territoryCovers,
  validateEndCustomer,
} from "../src/domain/territory.js";
import { expectThrows } from "./helpers.js";

describe("end-customer identity", () => {
  it("prefers a verified domain, which crosses borders", () => {
    const us = customerKey({ name: "Contoso Manufacturing Inc", domain: "contoso.com", country: "US" });
    const de = customerKey({ name: "Contoso Manufacturing GmbH", domain: "https://www.contoso.com/about", country: "DE" });
    assert.equal(us, "domain:contoso.com");
    assert.equal(us, de, "a domain match is the same corporate entity wherever it buys");
  });

  it("falls back to a country-scoped legal name when no domain is known", () => {
    const de = customerKey({ name: "Acme Holdings GmbH", country: "DE" });
    const us = customerKey({ name: "ACME, Inc.", country: "US" });
    assert.equal(de, "name:acme|DE");
    assert.equal(us, "name:acme|US");
    assert.notEqual(de, us, "same name in two countries is not one buying centre");
  });

  it("strips legal-form suffixes but never the whole name", () => {
    assert.equal(normalizeCompanyName("Northwind Technology Group Ltd"), "northwind-technology");
    assert.equal(normalizeCompanyName("Meridian Systems Integration Pte Ltd"), "meridian-systems-integration");
    assert.equal(normalizeCompanyName("Söderberg & Partners AB"), "soderberg-and-partners");
    assert.equal(normalizeCompanyName("GmbH"), "gmbh", "the last token survives even when it is a suffix");
    assert.equal(slugify("  Multi   Word --- Name "), "multi-word-name");
  });

  it("rejects mailbox providers and unroutable strings as company domains", () => {
    assert.equal(normalizeDomain("user@corp.example.com"), "corp.example.com");
    assert.equal(normalizeDomain("WWW.Example.CO.UK."), "example.co.uk");
    assert.equal(normalizeDomain("https://shop.example.com:8443/path?x=1"), "shop.example.com");
    assert.equal(normalizeDomain("gmail.com"), undefined);
    assert.equal(normalizeDomain("localhost"), undefined);
    assert.equal(normalizeDomain(""), undefined);
    assert.equal(normalizeDomain(undefined), undefined);
  });

  it("validates and canonicalizes the customer a registration carries", () => {
    const customer = validateEndCustomer({
      name: "  Fabrikam AG ",
      domain: "WWW.Fabrikam.de",
      country: "de",
      city: " Munich ",
      region: "",
    });
    assert.deepEqual(customer, {
      name: "Fabrikam AG",
      domain: "fabrikam.de",
      country: "DE",
      region: undefined,
      city: "Munich",
      taxId: undefined,
      accountRef: undefined,
    });

    expectThrows(() => validateEndCustomer({ name: "A", country: "DE" }), "VALIDATION", "at least 2 characters");
    expectThrows(() => validateEndCustomer({ name: "Fabrikam", country: "Germany" }), "VALIDATION", "alpha-2");
    expectThrows(
      () => validateEndCustomer({ name: "Fabrikam", domain: "someone@gmail.com", country: "DE" }),
      "VALIDATION",
      "public mailbox providers are rejected",
    );
  });
});

describe("territory and product-line grants", () => {
  it("resolves region membership and honours wildcard grants", () => {
    assert.equal(regionOf("de"), "EMEA");
    assert.equal(regionOf("SG"), "APAC");
    assert.equal(regionOf("AQ"), undefined);

    assert.equal(territoryCovers(["EMEA"], "DE"), true);
    assert.equal(territoryCovers(["EMEA"], "US"), false);
    assert.equal(territoryCovers(["US"], "us"), true);
    assert.equal(territoryCovers(["*"], "AQ"), true, "a global grant covers countries outside every region");
    assert.equal(territoryCovers([], "US"), false);
  });

  it("normalizes grants and refuses ones nobody can evaluate", () => {
    assert.equal(normalizeTerritory("global"), "*");
    assert.equal(normalizeTerritory(" emea "), "EMEA");
    assert.equal(normalizeTerritory("jp"), "JP");
    expectThrows(() => normalizeTerritory("Northern Europe"), "VALIDATION", "neither");
  });

  it("de-duplicates and sorts product lines, and computes overlap", () => {
    assert.deepEqual(normalizeProductLines(["Endpoint", "network security", "endpoint"]), [
      "endpoint",
      "network-security",
    ]);
    expectThrows(() => normalizeProductLines([]), "VALIDATION", "at least one product line");
    expectThrows(() => normalizeProductLines(["   "]), "VALIDATION", "non-empty identifier");

    assert.deepEqual(productLineOverlap(["endpoint", "cloud-platform"], ["cloud-platform", "managed-services"]), [
      "cloud-platform",
    ]);
    assert.deepEqual(productLineOverlap(["endpoint"], ["cloud-platform"]), []);
  });
});
