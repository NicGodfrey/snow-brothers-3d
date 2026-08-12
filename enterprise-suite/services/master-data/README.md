# @enterprise-suite/master-data

Master data management: the customers, sites and addresses every selling
context points at, plus the shared reference data they depend on — currencies
and FX rates, units of measure and their conversions, payment and shipping
terms, and versioned code lists.

Master data is read by nearly every other bounded context, so the rules here
are conservative: identifiers are check-digit validated before they are
stored, addresses are validated against their country's own structure, code
lists are versioned rather than edited in place, and events carry the changed
values (not just ids) so consumers can maintain a local projection without
calling back.

## Domain model

| Aggregate / value object | Purpose |
| --- | --- |
| `Customer` | The sold-to party: profile, status machine, registration identifiers, contacts, commercial defaults, credit limit, parent link and merge history. |
| `Site` | A customer location with one or more roles (`sold_to`, `ship_to`, `bill_to`, `payer`, `service`, `return_to`), an effective-dated address history, and per-role primary designation. |
| `PostalAddress` | Value object, normalized then validated per country (postal layout, subdivision, required fields) with a comparison fingerprint for deduplication. |
| `PartyIdentifier` | VAT, national tax id, D-U-N-S, GLN, LEI, IBAN, BIC or an internal reference, each validated by its own algorithm. |
| `TenantCurrency`, `Money` | Which ISO currencies a tenant transacts in, its functional currency, and minor-unit-exact money arithmetic. |
| `FxRate` | Effective-dated, typed (`spot`, `daily`, `monthly-average`, `budget`, `hedge`, `statutory`) rate with a quotation unit, plus corrections. |
| `UnitOfMeasure`, `UomConversion` | Dimensional units with a factor (and offset) to their dimension's base unit, plus product-scoped conversions that bridge dimensions. |
| `PaymentTerm` | A rule turning a document date into a schedule: due rule, discount ladder, instalments, grace days and a rolling convention. |
| `ShippingTerm` | An Incoterms 2020 rule pinned to a named place, freight payer, billing method and carrier defaults. |
| `HolidayCalendar` | Per-tenant working calendar: weekend days are data, not an assumption. |
| `CodeList` | A governed vocabulary with draft/published/retired versions, effective dating, hierarchy and deprecation with succession. |

Every aggregate carries `tenantId`; every repository method takes the tenant
explicitly, and every SQL unique key starts with `tenant_id`.

Reference data shipped with the package: 59 countries (with postal patterns,
subdivision tables for the US/CA/AU, VAT prefixes and EU membership), 48 ISO
4217 currencies with minor units and cash-rounding increments, 44 standard
units across 8 dimensions, the 11 Incoterms 2020 rules, 12 standard payment
terms and 4 seeded code lists.

## State machines

```
Customer      draft → active → on_hold ⇄ active
                 │        ├──→ blocked → active
                 │        └──→ inactive → active
                 └──→ inactive
              any → merged (terminal; the record becomes read-only)

Site          active ⇄ inactive          (deactivation blocked while primary)

Code list     draft → published → retired
              (one open draft, one effective version at any instant)

Payment /     active → retired           (codes are never redefined in place)
shipping term
```

Illegal transitions raise `INVALID_STATE` (422). `blocked` and `on_hold` demand
a reason; the first activation out of `draft` demands at least one registration
identifier.

## Addresses and identifiers

`normalizeAddress` is separate from `validateAddress` so an import pipeline can
normalize a whole batch and then triage the failures, rather than dying on the
first bad row. Normalization regroups postal codes into their country's display
form (`021101234` → `02110-1234`, `K1A0B1` → `K1A 0B1`) and maps subdivision
names onto codes; validation reports every issue at once. `renderAddress`
follows the country's label layout, including the postal-region-city ordering
used in Japan and China.

Identifier validation implements the real algorithms rather than a regex:
mod-11 and mod-97 VAT checks for the schemes that publish one, the GS1 mod-10
check digit for GLN, ISO 7064 mod 97-10 for LEI and IBAN, the base-36 GSTIN
check character, and Luhn for the Canadian business number. A VAT number's own
prefix is enough to identify its country, so `DE136695976` validates without a
separate country field.

## Money and FX

`Money` is minor units plus a currency, never a float: `toMinorUnits` respects
each currency's scale (the yen has none, the dinar has three), `allocate`
distributes an amount across weights by largest remainder so the parts always
sum back to the total, and `roundToCash` applies the cash increment where one
exists (five rappen in Switzerland).

Rate lookup tries the direct quote, then the inverse of the opposite quote,
then triangulation through a pivot, and the resolution records which path it
took and the factor it produced, so a posting can show its working. Rates are
never overwritten: a correction supersedes the original and both remain
queryable.

## Units of measure

Two kinds of conversion, deliberately kept apart:

- **Dimensional** (`KG → LB`, `°C → K`) is universal, computed as
  `value * toBase + offset`; the offset is what makes the affine temperature
  scales work.
- **Item** (`CASE → EA`, `CASE → KG`) is not universal — a case holds 24 of one
  product and 6 of another — so those are directed edges, optionally scoped to a
  product code, which the converter walks to bridge dimensions. A
  product-specific edge shadows the catalog-wide one.

Results round to the target unit's precision, and `roundToMultiple` snaps an
order quantity onto a packaging increment.

## Terms

Payment terms cover the shapes trade actually uses: net days from invoice,
delivery or goods receipt; end-of-month (`EOM+15`); a fixed day N months out;
proximo with a cutoff (`the 15th, unless dated after the 25th`); discount
ladders (`2/10 1/20 net 30`); and instalment plans. `computePaymentSchedule`
applies grace days, rolls onto a working day using the term's calendar, and
splits amounts through the same allocator money uses, so instalments never lose
a cent. Discount ladders must decline over time and cannot outlive the term.

Shipping terms name an Incoterms 2020 rule; the allocations that follow from it
(export/import clearance, main carriage, insurance, unloading, where risk
passes) are read from the published table rather than stored per term, so a
term can never drift out of line with the rule it claims. The four maritime
rules are rejected for road and air, group C and D rules cannot be billed
collect, and every rule outside group E must name a place.

## Code lists

Editing happens on a draft. Publishing fixes the draft to an effective date and
closes the previous version at the same instant, so exactly one version is
effective at any moment and a document raised last quarter still resolves the
label the code had then. Published entries are never deleted — they are
deprecated, optionally with a successor — and `translate` follows those
successors to migrate a historical code forward. `diff` reports additions,
removals, relabels, deprecations and reparenting for change approval.

## Duplicate detection and merges

Scoring runs on a `MatchProfile` projection, so the same logic serves a stored
customer, a CSV row and an inbound integration payload. A shared
check-digit-validated identifier is decisive, as is an identical normalized
name at an identical normalized address; otherwise name (0.5), address (0.35)
and shared email domain (0.15) accumulate towards review and duplicate
thresholds. Names are compared with both Jaro-Winkler (after stripping ~60
legal-form suffixes) and token-set similarity, so `Acme Ltd`/`ACME Limited` and
`Northwind Trading`/`Trading Northwind` both score 1. Cross-border pairs are
capped below the duplicate bar: two entities in different countries are legally
distinct even when the branding matches, so they go to a steward.

`planMerge` is the dry run — what would move, what disagrees. `merge` moves
sites (suffixing a code that collides with the survivor's), copies identifiers,
contacts and external ids the survivor lacks, and marks the loser `merged` so
`GET /customers/:id/resolved` forwards its id forever.

## HTTP API

Identity comes from the `x-tenant-id`, `x-user-id` and `x-roles` headers;
`GET /health` is the only route that does not need a tenant. Errors are
`{ code, message, details? }` with the domain's own status: `VALIDATION` 400,
`ADDRESS_INVALID` 400, `CURRENCY_ERROR` 400, `UOM_ERROR` 400, `NOT_FOUND` 404,
`CONFLICT` 409, `INVALID_STATE` 422, `CODE_LIST_ERROR` 422,
`FX_RATE_UNAVAILABLE` 422.

```
GET  /health                              GET  /events?type=&aggregateType=

GET  /countries[?eu=&search=]             GET  /countries/:code[/subdivisions]
POST /addresses/{validate,format}         POST /identifiers/validate
POST /geo/distance

GET  /currencies[?enabled=true]           GET  /currencies/{iso,functional}
POST /currencies                          POST /currencies/:code/functional
DELETE /currencies/:code                  POST /currencies/:code/allocate
GET  /fx/{rates,history,resolve}          POST /fx/rates[/bulk]
POST /fx/{convert,express}                POST /fx/rates/:id/correction

GET  /uoms[?dimension=]                   GET  /uoms/{dimensions,convertible,round}
POST /uoms                                GET  /uoms/:code
GET  /uom-conversions                     POST /uoms/convert
POST /uom-conversions                     DELETE /uom-conversions/:from/:to

GET  /calendars[, /:code]                 POST /calendars[, /:code/holidays]
GET  /calendars/:code/business-days       POST /calendars/:code/adjust
GET  /payment-terms[, /:code]             POST /payment-terms[/preview]
POST /payment-terms/:code/{schedule,retire}
GET  /incoterms[, /:code]                 GET  /shipping-terms[, /:code]
GET  /shipping-terms/:code/{responsibilities,delivery-estimate}
POST /shipping-terms[, /:code/retire]

GET  /code-lists[, /:listCode]            POST /code-lists[, /:listCode/versions]
GET  /code-lists/:listCode/entries[?asOf=&includeDeprecated=&parent=]
GET  /code-lists/:listCode/entries/:code[/descendants]
GET  /code-lists/:listCode/{translate,diff}
POST /code-lists/:listCode/entries        DELETE /code-lists/:listCode/entries/:code
POST /code-lists/:listCode/entries/:code/deprecate
POST /code-lists/:listCode/{publish,retire}
DELETE /code-lists/:listCode/draft

GET  /customers[?status=&classification=&country=&segment=&industry=&tag=&search=]
POST /customers                           GET  /customers/by-number/:number
GET  /customers/:id[/{resolved,hierarchy,duplicates,sites}]
PATCH /customers/:id                      POST /customers/:id/{status,terms,parent}
POST /customers/:id/{identifiers,contacts,credit-limit}
DELETE /customers/:id/identifiers/:scheme/:value
DELETE /customers/:id/contacts/:contactId
POST /customers/:id/{merge-plan,merge}

GET  /sites[?customerId=&role=&country=&active=&search=]
GET  /sites/{nearest,resolve}             POST /sites
GET  /sites/:id[/address]                 PATCH /sites/:id
POST /sites/:id/{address,roles,primary,deactivate,reactivate}
```

## Events

Published through the outbox port as shared-kernel envelopes, namespaced
`mdm.<aggregate>.<event>`:

`mdm.customer.{created,updated,status-changed,identifier-added,identifier-removed,contact-added,contact-removed,terms-assigned,credit-limit-changed,hierarchy-changed,merged}`,
`mdm.site.{created,updated,address-changed,roles-changed,primary-changed,deactivated,reactivated}`,
`mdm.currency.{enabled,disabled}`, `mdm.fx-rate.{quoted,corrected}`,
`mdm.uom.{created,conversion-defined}`,
`mdm.{payment-term,shipping-term}.{created,retired}`,
`mdm.code-list.{created,version-drafted,version-published,version-retired,entry-deprecated}`.

Payload contracts live in `src/domain/events.ts`.

## Persistence

In-memory repositories implement the ports in `src/application/ports.ts`.
`migrations/0001..0006` define the Postgres schema those ports map onto — 20
tables including the effective-dated `mdm_site_addresses`, the superseding
`mdm_fx_rates` with its correction log, the normalized payment-term discount
and instalment tables, versioned `mdm_code_list_entries`, and the
`mdm_outbox_events` table backing the transactional outbox. Tenant scoping,
status/enum checks, and the one-primary-per-role and one-effective-version
constraints are enforced in the schema as well as the domain.

## Layout

```
src/domain            aggregates, value objects, reference tables, event contracts
src/application       ports and use-case services
src/infrastructure    in-memory repos, outbox, clock, container, seed data
src/http              micro-router, validation helpers, route modules, server
migrations            SQL schema (0001..0006)
tests                 domain, service and HTTP suites
```

## Usage

```ts
import { createContainer, createMasterDataServer, seedDemoData } from "@enterprise-suite/master-data";

const container = createContainer();
await seedDemoData(container, "demo");
createMasterDataServer(container).listen(3020);
```

Or use a service directly:

```ts
import { createContainer } from "@enterprise-suite/master-data";
import { createTenantContext } from "@enterprise-suite/shared-kernel";

const { services } = createContainer();
const ctx = createTenantContext("acme", "steward-1", ["mdm.admin"]);

const schedule = await services.paymentTerm.preview(
  ctx,
  { code: "2-10-NET30", name: "2% 10, net 30", due: { kind: "net_days", days: 30 },
    discounts: [{ percent: 2, days: 10 }] },
  { invoiceDate: "2026-06-01", amountMinor: 500_000, currency: "USD" },
);
// schedule.dueDate === "2026-07-01", discount of 100.00 USD until 2026-06-11
```

## Scripts

```
npm run build       # tsc -b
npm run typecheck   # tsc -b && tsc -p tsconfig.tests.json
npm test            # node --test via tsx (198 tests)
npm run dev         # seeded HTTP server on :3020 (PORT, MDM_SEED=false)
npm run lint
```
