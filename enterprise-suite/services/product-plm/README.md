# @enterprise-suite/product-plm

Product lifecycle management (PLM) bounded context: the engineering master
data every downstream domain (MRP, procurement, manufacturing, sales) reads
from. Owns products/variants/SKUs, categories, attributes, multi-level BOMs
with revisioning and date effectivity, engineering change orders (ECO),
standard-cost rollup, and units of measure.

## Domain model

| Concept | Shape | Key invariants |
| --- | --- | --- |
| **Product** | Aggregate | Unique code + SKU per tenant; lifecycle `design → pilot → active → end_of_life` (only `pilot → design` goes backward); manufactured products cannot go active without a currently effective released BOM; EOL requires a reason, freezes the record and discontinues all variants. |
| **Variant** | Entity inside Product | Fixes one combination of the attribute set's *variant axes* (single-select, required attributes); combination and SKU unique; SKU auto-derived `CODE-AXISVALUES` when not given; variant space frozen once the product leaves design/pilot. |
| **Category** | Record + tree service | Slug-unique per tenant; materialized `path`; moves reject cycles and rewrite descendant paths. |
| **Attribute / AttributeSet** | Records | Typed (`text/number/boolean/select/multiselect/date`) with options, bounds, regex; sets compose definitions and flag axes; values validated on write, never stored dirty. |
| **BOM** | Aggregate (one per product) | Only manufactured/phantom products carry BOMs; single draft at a time; released revisions immutable; released effectivity windows never overlap — releasing revision N auto-truncates an open-ended predecessor; every release after the first requires an **approved ECO** covering that revision; line units must be dimension-convertible to the component's base unit; graph-wide cycle rejection. |
| **ECO** | Aggregate | `draft → submitted → approved → implemented`, plus `rejected`/`cancelled`; typed change items (`bom_release`, `lifecycle_transition`, `attribute_update`, `variant_discontinue`); approval quorum, one vote per user, no self-approval, rejection needs a comment; implementation applies items in order and aborts on first conflict. |
| **Costing** | Domain service | Leaf cost = standard cost (variant override first); make items roll up `Σ componentCost × qty(inComponentBaseUom) × (1 + scrap)` over the revision effective at the requested date; phantoms pass through; money stays in integer minor units, one rounding per line; missing costs are *reported*, and an incomplete rollup can never be persisted as standard cost; no silent FX. |
| **UoM** | Registry per tenant | Six dimensions (count/mass/length/area/volume/time), standard catalog + tenant-defined units; conversion only within a dimension, rounded to the target unit's precision. |

Multi-level explosion (`/bom/explosion`) walks effective revisions at a date,
applies scrap and unit conversion, detects cycles, and (by default) flattens
phantom kits the way MRP expects; `/bom/requirements` aggregates the leaves
into total procurement quantities.

## Layout

```
src/domain/          aggregates, value objects, state machines, tree walkers
src/application/     use-case services + ports (repos, outbox, clock)
src/infrastructure/  in-memory adapters, composition root, demo seed
src/http/            dependency-free router, validation, route modules
migrations/          Postgres DDL mirroring the domain invariants
tests/               node:test suites (unit + full HTTP integration)
```

Repositories are interfaces (`application/ports.ts`); the in-memory adapters
are single-process stand-ins and the SQL migrations encode the same
constraints for a later Postgres adapter (including a `tstzrange` exclusion
constraint for revision effectivity and a partial unique index for the
single-draft rule). Domain events use the shared-kernel envelope and flow
through an in-memory transactional-outbox stand-in; `GET /events` exposes the
tenant's stream.

## HTTP API

Multi-tenancy via headers: `x-tenant-id` (required), `x-user-id`, `x-roles`.

- `GET /health`, `GET /events?type=`
- `POST|GET /uoms`, `GET /uoms/convert?value&from&to`
- `POST|GET /categories`, `POST /categories/:id/move`, `PATCH /categories/:id`
- `POST|GET /attribute-definitions`, `POST|GET /attribute-sets`, `GET /attribute-sets/:id`
- `POST|GET /products`, `GET|PATCH /products/:id`, `PUT /products/:id/attributes`,
  `POST /products/:id/category|lifecycle|cost`, `GET /skus/:sku`
- `POST /products/:id/variants`, `POST /products/:id/variants/:variantId/discontinue`
- `POST|GET /products/:id/bom`, `POST /products/:id/bom/revisions`,
  `POST|PATCH|DELETE .../revisions/:revisionId/lines[/:lineId]`,
  `POST .../revisions/:revisionId/release|obsolete`,
  `GET /products/:id/bom/effective|explosion|requirements`
- `GET /products/:id/cost-rollup`, `POST /products/:id/cost-rollup/apply`
- `POST|GET /ecos`, `GET /ecos/:id`, `POST /ecos/:id/items`,
  `DELETE /ecos/:id/items/:itemId`,
  `POST /ecos/:id/submit|approve|reject|cancel|implement`

## Run it

```bash
npm run build      # tsc -b (builds shared-kernel reference too)
npm test           # build + 66 node:test cases, includes HTTP integration
npm run typecheck  # src + tests
npm run dev        # seeded demo server on :3010 (PLM_SEED=false to skip)
```

Demo walk-through (the seed ships a skateboard factory — three-level BOM,
phantom hardware kit, deck variants, and a pending ECO swapping 54 mm wheels
for 56 mm):

```bash
curl -s -H 'x-tenant-id: demo' localhost:3010/products?type=manufactured
curl -s -H 'x-tenant-id: demo' "localhost:3010/products/<completeId>/bom/explosion?quantity=10"
curl -s -H 'x-tenant-id: demo' "localhost:3010/products/<completeId>/cost-rollup"
curl -s -H 'x-tenant-id: demo' -H 'x-user-id: chief' -X POST localhost:3010/ecos/<ecoId>/approve
curl -s -H 'x-tenant-id: demo' -X POST localhost:3010/ecos/<ecoId>/implement
```

## Design notes

- **Aggregate boundaries.** BOM is a separate aggregate from Product (they
  change at different cadences and the BOM graph spans products); variants
  live inside Product because their invariants (axis/SKU uniqueness, lifecycle
  freeze) are product-local. Cross-aggregate rules — tenant-wide SKU
  uniqueness, ECO gating of releases, activation-needs-BOM — sit in the
  application services, checked before any aggregate is mutated.
- **Effectivity over deletion.** BOM history is never rewritten: revisions
  supersede each other through date windows, so any past explosion or cost
  rollup stays reproducible with `?at=`.
- **Deterministic tests.** Services take a `Clock` port; tests use a fixed,
  manually advanced clock to exercise effectivity windows.
