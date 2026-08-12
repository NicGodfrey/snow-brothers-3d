-- Master data: customers, their identifiers and contacts, and customer sites
-- with effective-dated addresses. Postgres dialect.
--
-- Every table is tenant-scoped and natural keys are always (tenant_id, key),
-- so two tenants can both own customer "C-000001". Addresses are stored as
-- flattened columns rather than JSONB because they are queried (by country,
-- by postal code, by proximity) rather than merely carried.

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE mdm_customers (
    id                  TEXT        PRIMARY KEY,
    tenant_id           TEXT        NOT NULL,
    number              TEXT        NOT NULL CHECK (number ~ '^[A-Z0-9][A-Z0-9-]{2,31}$'),
    legal_name          TEXT        NOT NULL CHECK (length(btrim(legal_name)) > 0),
    trading_name        TEXT,
    party_type          TEXT        NOT NULL DEFAULT 'organization'
        CHECK (party_type IN ('organization', 'person')),
    classification      TEXT        NOT NULL
        CHECK (classification IN ('enterprise', 'mid_market', 'small_business', 'government',
                                  'education', 'non_profit', 'individual', 'intercompany')),
    status              TEXT        NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'active', 'on_hold', 'blocked', 'inactive', 'merged')),
    status_reason       TEXT,

    -- Registered (legal) address; trading locations live in mdm_sites.
    addr_organization   TEXT,
    addr_attention      TEXT,
    addr_line1          TEXT        NOT NULL,
    addr_line2          TEXT,
    addr_line3          TEXT,
    addr_city           TEXT        NOT NULL,
    addr_region         TEXT,
    addr_postal_code    TEXT,
    addr_country        CHAR(2)     NOT NULL,
    addr_latitude       NUMERIC(9, 6)  CHECK (addr_latitude BETWEEN -90 AND 90),
    addr_longitude      NUMERIC(9, 6)  CHECK (addr_longitude BETWEEN -180 AND 180),

    currency            CHAR(3)     NOT NULL,
    -- Code-list references, validated by the code-list service on write.
    industry_code       TEXT,
    segment_code        TEXT,
    tax_category_code   TEXT,

    payment_term_code   TEXT,
    shipping_term_code  TEXT,
    price_list_code     TEXT,
    incoterm_place      TEXT,

    credit_limit_minor  BIGINT      CHECK (credit_limit_minor >= 0),
    credit_currency     CHAR(3)     NOT NULL,
    risk_rating         TEXT,
    credit_approved_by  TEXT,
    credit_approved_at  TIMESTAMPTZ,
    credit_review_due   TIMESTAMPTZ,

    parent_id           TEXT        REFERENCES mdm_customers (id) ON DELETE RESTRICT,
    -- Set when this record lost a merge; reads follow the survivor.
    merged_into_id      TEXT        REFERENCES mdm_customers (id) ON DELETE RESTRICT,
    tags                TEXT[]      NOT NULL DEFAULT '{}',
    external_ids        JSONB       NOT NULL DEFAULT '{}',
    activated_at        TIMESTAMPTZ,
    version             INTEGER     NOT NULL DEFAULT 1,
    created_at          TIMESTAMPTZ NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL,

    UNIQUE (tenant_id, number),
    CHECK (parent_id IS NULL OR parent_id <> id),
    CHECK (merged_into_id IS NULL OR merged_into_id <> id),
    CHECK ((status = 'merged') = (merged_into_id IS NOT NULL)),
    -- A credit limit is meaningless without the approval that granted it.
    CHECK (credit_limit_minor IS NULL OR credit_approved_by IS NOT NULL)
);
CREATE INDEX mdm_customers_tenant_status_idx ON mdm_customers (tenant_id, status);
CREATE INDEX mdm_customers_tenant_parent_idx ON mdm_customers (tenant_id, parent_id)
    WHERE parent_id IS NOT NULL;
CREATE INDEX mdm_customers_tenant_country_idx ON mdm_customers (tenant_id, addr_country);
CREATE INDEX mdm_customers_tenant_segment_idx ON mdm_customers (tenant_id, segment_code)
    WHERE segment_code IS NOT NULL;
CREATE INDEX mdm_customers_external_ids_idx ON mdm_customers USING GIN (external_ids jsonb_path_ops);
CREATE INDEX mdm_customers_tags_idx ON mdm_customers USING GIN (tags);
-- Duplicate detection scans on a normalized name; keep it indexable.
CREATE INDEX mdm_customers_tenant_name_idx ON mdm_customers (tenant_id, lower(legal_name));

-- Registration and tax identifiers. Uniqueness is per scheme within a tenant:
-- two customers cannot share one VAT number, but the same string may legally
-- appear under different schemes.
CREATE TABLE mdm_customer_identifiers (
    tenant_id       TEXT        NOT NULL,
    customer_id     TEXT        NOT NULL REFERENCES mdm_customers (id) ON DELETE CASCADE,
    scheme          TEXT        NOT NULL
        CHECK (scheme IN ('vat', 'tax', 'duns', 'gln', 'lei', 'iban', 'bic', 'internal')),
    value           TEXT        NOT NULL,
    country_code    CHAR(2),
    -- Set once the value passed its scheme's checksum, not merely its format.
    verified_at     TIMESTAMPTZ,
    PRIMARY KEY (customer_id, scheme, value),
    UNIQUE (tenant_id, scheme, value),
    CHECK (value = upper(btrim(value)))
);
CREATE INDEX mdm_customer_identifiers_lookup_idx ON mdm_customer_identifiers (tenant_id, scheme, value);

CREATE TABLE mdm_customer_contacts (
    id              TEXT        PRIMARY KEY,
    tenant_id       TEXT        NOT NULL,
    customer_id     TEXT        NOT NULL REFERENCES mdm_customers (id) ON DELETE CASCADE,
    name            TEXT        NOT NULL CHECK (length(btrim(name)) > 0),
    email           TEXT        CHECK (email IS NULL OR email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'),
    phone           TEXT,
    job_title       TEXT,
    roles           TEXT[]      NOT NULL DEFAULT '{primary}',
    site_id         TEXT,
    created_at      TIMESTAMPTZ NOT NULL,
    CHECK (roles <@ ARRAY['primary', 'billing', 'shipping', 'technical', 'executive', 'legal']::TEXT[])
);
CREATE INDEX mdm_customer_contacts_customer_idx ON mdm_customer_contacts (customer_id);
-- At most one primary contact per customer.
CREATE UNIQUE INDEX mdm_customer_contacts_primary_uq
    ON mdm_customer_contacts (customer_id)
    WHERE 'primary' = ANY (roles);

CREATE TABLE mdm_sites (
    id                    TEXT        PRIMARY KEY,
    tenant_id             TEXT        NOT NULL,
    customer_id           TEXT        NOT NULL REFERENCES mdm_customers (id) ON DELETE CASCADE,
    code                  TEXT        NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9-_]{1,31}$'),
    name                  TEXT        NOT NULL CHECK (length(btrim(name)) > 0),
    roles                 TEXT[]      NOT NULL,
    primary_for_roles     TEXT[]      NOT NULL DEFAULT '{}',
    timezone              TEXT        NOT NULL DEFAULT 'UTC',
    active                BOOLEAN     NOT NULL DEFAULT TRUE,
    deactivation_reason   TEXT,
    tax_jurisdiction_code TEXT,
    delivery_instructions TEXT,
    gln                   TEXT        CHECK (gln IS NULL OR gln ~ '^[0-9]{13}$'),
    external_ids          JSONB       NOT NULL DEFAULT '{}',
    version               INTEGER     NOT NULL DEFAULT 1,
    created_at            TIMESTAMPTZ NOT NULL,
    updated_at            TIMESTAMPTZ NOT NULL,

    -- Site codes are unique per customer, not per tenant: "HQ" is expected to
    -- recur across the customer book.
    UNIQUE (customer_id, code),
    CHECK (cardinality(roles) > 0),
    CHECK (roles <@ ARRAY['sold_to', 'ship_to', 'bill_to', 'payer', 'service', 'return_to']::TEXT[]),
    CHECK (primary_for_roles <@ roles),
    CHECK (active OR deactivation_reason IS NOT NULL)
);
CREATE INDEX mdm_sites_tenant_customer_idx ON mdm_sites (tenant_id, customer_id);
CREATE INDEX mdm_sites_roles_idx ON mdm_sites USING GIN (roles);

-- One primary site per role per customer. Enforced per role with a partial
-- unique index; order entry relies on this being true, not merely intended.
CREATE UNIQUE INDEX mdm_sites_primary_sold_to_uq ON mdm_sites (customer_id)
    WHERE 'sold_to' = ANY (primary_for_roles);
CREATE UNIQUE INDEX mdm_sites_primary_ship_to_uq ON mdm_sites (customer_id)
    WHERE 'ship_to' = ANY (primary_for_roles);
CREATE UNIQUE INDEX mdm_sites_primary_bill_to_uq ON mdm_sites (customer_id)
    WHERE 'bill_to' = ANY (primary_for_roles);
CREATE UNIQUE INDEX mdm_sites_primary_payer_uq ON mdm_sites (customer_id)
    WHERE 'payer' = ANY (primary_for_roles);
CREATE UNIQUE INDEX mdm_sites_primary_service_uq ON mdm_sites (customer_id)
    WHERE 'service' = ANY (primary_for_roles);
CREATE UNIQUE INDEX mdm_sites_primary_return_to_uq ON mdm_sites (customer_id)
    WHERE 'return_to' = ANY (primary_for_roles);

-- Effective-dated address history. A relocation is a new row with a future
-- start, not an update: documents dated before the move must keep resolving
-- the old address.
CREATE TABLE mdm_site_addresses (
    id                TEXT        PRIMARY KEY,
    tenant_id         TEXT        NOT NULL,
    site_id           TEXT        NOT NULL REFERENCES mdm_sites (id) ON DELETE CASCADE,
    effective_from    TIMESTAMPTZ NOT NULL,
    effective_to      TIMESTAMPTZ,
    reason            TEXT,
    organization      TEXT,
    attention         TEXT,
    line1             TEXT        NOT NULL,
    line2             TEXT,
    line3             TEXT,
    city              TEXT        NOT NULL,
    region            TEXT,
    postal_code       TEXT,
    country_code      CHAR(2)     NOT NULL,
    latitude          NUMERIC(9, 6) CHECK (latitude BETWEEN -90 AND 90),
    longitude         NUMERIC(9, 6) CHECK (longitude BETWEEN -180 AND 180),
    created_at        TIMESTAMPTZ NOT NULL,

    CHECK (effective_to IS NULL OR effective_to > effective_from),
    CHECK ((latitude IS NULL) = (longitude IS NULL)),
    -- No two addresses for one site may claim the same instant.
    EXCLUDE USING GIST (
        site_id WITH =,
        tstzrange(effective_from, effective_to, '[)') WITH &&
    )
);
CREATE INDEX mdm_site_addresses_site_from_idx ON mdm_site_addresses (site_id, effective_from DESC);
CREATE INDEX mdm_site_addresses_country_idx ON mdm_site_addresses (tenant_id, country_code);
