import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  addressFingerprint,
  buildAddress,
  formatAddress,
  haversineKm,
  normalizeAddress,
  sameAddress,
  validateAddress,
} from "../src/domain/address.js";
import { findSubdivision, isEuMember, requireCountry, vatPrefixFor } from "../src/domain/country.js";
import { validateIdentifier } from "../src/domain/identifiers.js";
import { expectThrows } from "./helpers.js";

describe("postal codes", () => {
  it("regroups codes into the country's display form", () => {
    const ca = normalizeAddress({
      line1: "150 Elgin Street",
      city: "Ottawa",
      region: "Ontario",
      postalCode: "k1a0b1",
      countryCode: "ca",
    });
    assert.equal(ca.postalCode, "K1A 0B1");
    // Subdivision names resolve to their ISO code.
    assert.equal(ca.region, "ON");
    assert.equal(String(ca.countryCode), "CA");

    const us = normalizeAddress({
      line1: "1200 Harbor Boulevard",
      city: "Boston",
      region: "MA",
      postalCode: "021101234",
      countryCode: "US",
    });
    assert.equal(us.postalCode, "02110-1234");
  });

  it("leaves half-entered codes alone so validation can report them", () => {
    const address = normalizeAddress({
      line1: "1 Somewhere",
      city: "Boston",
      region: "MA",
      postalCode: "021",
      countryCode: "US",
    });
    assert.equal(address.postalCode, "021");
    const issues = validateAddress(address);
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.field, "postalCode");
  });

  it("collapses whitespace and drops empty optional lines", () => {
    const address = normalizeAddress({
      line1: "  1200   Harbor   Boulevard ",
      line2: "   ",
      city: " Boston ",
      region: "ma",
      postalCode: "02110",
      countryCode: "us",
    });
    assert.equal(address.line1, "1200 Harbor Boulevard");
    assert.equal(address.line2, undefined);
    assert.equal(address.city, "Boston");
    assert.equal(address.region, "MA");
  });
});

describe("address validation", () => {
  it("requires a state where the country demands one", () => {
    const issues = validateAddress(
      normalizeAddress({ line1: "1 Pitt Street", city: "Sydney", postalCode: "2000", countryCode: "AU" }),
    );
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.field, "region");
  });

  it("rejects a state that is not a subdivision of the country", () => {
    const issues = validateAddress(
      normalizeAddress({
        line1: "1 Main Street",
        city: "Springfield",
        region: "ZZ",
        postalCode: "62701",
        countryCode: "US",
      }),
    );
    assert.equal(issues.length, 1);
    assert.match(issues[0]!.message, /not a subdivision/);
  });

  it("accepts countries that do not use postal codes", () => {
    const address = buildAddress({
      line1: "Sheikh Zayed Road, Tower 2",
      city: "Dubai",
      countryCode: "AE",
    });
    assert.equal(address.postalCode, undefined);
  });

  it("reports every problem at once when building", () => {
    expectThrows(
      () => buildAddress({ line1: "", city: "", countryCode: "XX" }),
      "ADDRESS_INVALID",
      "countryCode",
    );
  });

  it("bounds coordinates", () => {
    const issues = validateAddress(
      normalizeAddress({
        line1: "1 Main Street",
        city: "Boston",
        region: "MA",
        postalCode: "02110",
        countryCode: "US",
        coordinates: { latitude: 95, longitude: -71 },
      }),
    );
    assert.deepEqual(
      issues.map((issue) => issue.field),
      ["coordinates.latitude"],
    );
  });
});

describe("rendering", () => {
  it("uses the country's line order", () => {
    const us = formatAddress(
      buildAddress({
        organization: "Northwind Traders Inc.",
        line1: "1200 Harbor Boulevard",
        city: "Boston",
        region: "MA",
        postalCode: "02110",
        countryCode: "US",
      }),
    );
    assert.equal(
      us,
      ["Northwind Traders Inc.", "1200 Harbor Boulevard", "Boston MA 02110", "United States"].join("\n"),
    );

    // German addresses put the postal code before the city.
    const de = formatAddress(
      buildAddress({ line1: "Industriestrasse 14", city: "Konstanz", postalCode: "78462", countryCode: "DE" }),
    );
    assert.equal(de, ["Industriestrasse 14", "78462 Konstanz", "Germany"].join("\n"));

    // Japanese addresses are rendered largest-unit-first.
    const jp = formatAddress(
      buildAddress({ line1: "2-7-2 Marunouchi", city: "Chiyoda-ku", region: "Tokyo", postalCode: "1000005", countryCode: "JP" }),
    );
    assert.equal(jp.split("\n")[0], "100-0005");
  });
});

describe("fingerprinting", () => {
  it("folds abbreviations, casing and punctuation", () => {
    const a = buildAddress({
      line1: "1 Elm Street",
      line2: "Apartment 4",
      city: "Boston",
      region: "MA",
      postalCode: "02110",
      countryCode: "US",
    });
    const b = buildAddress({
      line1: "1 elm st.",
      line2: "apt 4",
      city: "boston",
      region: "MA",
      postalCode: "02110",
      countryCode: "US",
    });
    assert.equal(addressFingerprint(a), addressFingerprint(b));
    assert.ok(sameAddress(a, b));
  });

  it("keeps different streets apart", () => {
    const a = buildAddress({ line1: "1 Elm Street", city: "Boston", region: "MA", postalCode: "02110", countryCode: "US" });
    const b = buildAddress({ line1: "2 Elm Street", city: "Boston", region: "MA", postalCode: "02110", countryCode: "US" });
    assert.ok(!sameAddress(a, b));
  });
});

describe("geography reference data", () => {
  it("knows EU membership and VAT prefixes", () => {
    assert.ok(isEuMember("DE"));
    assert.ok(!isEuMember("GB"));
    assert.equal(vatPrefixFor("GR"), "EL");
    assert.equal(requireCountry("840").alpha2, "US");
  });

  it("resolves subdivisions by code or name", () => {
    assert.equal(findSubdivision("US", "california")?.code, "CA");
    assert.equal(findSubdivision("US", "ca")?.name, "California");
    assert.equal(findSubdivision("US", "Atlantis"), undefined);
  });

  it("measures distance between coordinates", () => {
    // Boston to Worcester is roughly 61 km.
    const km = haversineKm({ latitude: 42.3554, longitude: -71.0524 }, { latitude: 42.2626, longitude: -71.8023 });
    assert.ok(km > 59 && km < 64, `expected ~61 km, got ${km}`);
    assert.equal(haversineKm({ latitude: 10, longitude: 10 }, { latitude: 10, longitude: 10 }), 0);
  });
});

describe("identifier validation", () => {
  it("checks VAT numbers with the issuing country's algorithm", () => {
    // The prefix identifies the country, so no separate field is needed.
    const de = validateIdentifier({ scheme: "vat", value: "DE 136695976" });
    assert.ok(de.valid);
    assert.equal(de.normalized, "DE136695976");
    assert.ok(de.checkedDigits);

    const badDe = validateIdentifier({ scheme: "vat", value: "DE136695977" });
    assert.ok(!badDe.valid);
    assert.match(badDe.reason ?? "", /check digit/);

    // Equally, the prefix is added when the value omits it.
    const prefixed = validateIdentifier({ scheme: "vat", value: "136695976", countryCode: "DE" });
    assert.equal(prefixed.normalized, "DE136695976");
    assert.ok(prefixed.valid);
  });

  it("check-digits GLN, LEI and IBAN", () => {
    assert.ok(validateIdentifier({ scheme: "gln", value: "0614141123452" }).valid);
    assert.equal(
      validateIdentifier({ scheme: "gln", value: "0614141123453" }).reason,
      "check digit should be 2",
    );
    assert.ok(validateIdentifier({ scheme: "lei", value: "529900T8BM49AURSDO55" }).valid);
    assert.ok(validateIdentifier({ scheme: "iban", value: "DE89 3704 0044 0532 0130 00" }).valid);
    assert.ok(!validateIdentifier({ scheme: "iban", value: "DE89 3704 0044 0532 0130 01" }).valid);
    assert.equal(
      validateIdentifier({ scheme: "iban", value: "DE89 3704 0044 0532 0130 00" }).normalized,
      "DE89370400440532013000",
    );
  });

  it("normalizes a US EIN into its printed form", () => {
    const ein = validateIdentifier({ scheme: "tax", value: "123456789", countryCode: "US" });
    assert.ok(ein.valid);
    assert.equal(ein.normalized, "12-3456789");
  });

  it("only format-checks schemes with no checksum", () => {
    const internal = validateIdentifier({ scheme: "internal", value: "legacy-99" });
    assert.ok(internal.valid);
    assert.ok(!internal.checkedDigits);
  });
});
