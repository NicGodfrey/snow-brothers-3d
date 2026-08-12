-- Procurement SRM: local supplier directory.
--
-- srm-core owns supplier onboarding, qualification and compliance. This is
-- procurement's own projection, fed by srm.supplier.* events, and it is
-- authoritative only for "may we transact with this supplier today".

CREATE TABLE proc_suppliers (
    id                     TEXT        PRIMARY KEY,
    tenant_id              TEXT        NOT NULL,
    supplier_number        TEXT        NOT NULL CHECK (supplier_number ~ '^[A-Z0-9][A-Z0-9-]{1,39}$'),
    legal_name             TEXT        NOT NULL CHECK (length(legal_name) >= 2),
    display_name           TEXT        NOT NULL CHECK (length(display_name) >= 2),
    status                 TEXT        NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'active', 'blocked', 'inactive')),
    currency               CHAR(3)     NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    payment_terms_days     SMALLINT    NOT NULL DEFAULT 30 CHECK (payment_terms_days BETWEEN 0 AND 365),
    default_incoterm       TEXT        NOT NULL DEFAULT 'DAP' CHECK (default_incoterm IN (
        'EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP')),
    risk_tier              TEXT        NOT NULL DEFAULT 'medium' CHECK (risk_tier IN ('low', 'medium', 'high')),
    -- Scorecard mirrored from quality-qms / srm-core; used to rank quotes.
    quality_score_bps      INTEGER     NOT NULL DEFAULT 7500 CHECK (quality_score_bps BETWEEN 0 AND 10000),
    default_lead_time_days SMALLINT    NOT NULL DEFAULT 14 CHECK (default_lead_time_days BETWEEN 0 AND 365),
    minimum_order_minor    BIGINT      CHECK (minimum_order_minor >= 0),
    contact_email          TEXT        CHECK (contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
    block_reason           TEXT,
    source_system          TEXT        NOT NULL DEFAULT 'local' CHECK (source_system IN ('srm-core', 'local')),
    external_id            TEXT,
    version                INTEGER     NOT NULL DEFAULT 1,
    created_at             TIMESTAMPTZ NOT NULL,
    updated_at             TIMESTAMPTZ NOT NULL,
    UNIQUE (tenant_id, supplier_number),
    -- A block must say why; buyers see the reason when an order is refused.
    CHECK (status <> 'blocked' OR block_reason IS NOT NULL),
    -- A mirrored record keeps the master id so re-syncs are idempotent.
    CHECK (source_system <> 'srm-core' OR external_id IS NOT NULL)
);
CREATE INDEX proc_suppliers_tenant_status_idx ON proc_suppliers (tenant_id, status);
CREATE UNIQUE INDEX proc_suppliers_external_idx
    ON proc_suppliers (tenant_id, external_id) WHERE external_id IS NOT NULL;

-- Categories a supplier is approved to quote and be ordered against. Sourcing
-- and ordering both refuse a supplier that is not approved for the category.
CREATE TABLE proc_supplier_categories (
    tenant_id     TEXT NOT NULL,
    supplier_id   TEXT NOT NULL REFERENCES proc_suppliers (id) ON DELETE CASCADE,
    category_code TEXT NOT NULL CHECK (category_code ~ '^[A-Z0-9][A-Z0-9._-]{0,39}$'),
    PRIMARY KEY (supplier_id, category_code)
);
CREATE INDEX proc_supplier_categories_lookup_idx
    ON proc_supplier_categories (tenant_id, category_code);
