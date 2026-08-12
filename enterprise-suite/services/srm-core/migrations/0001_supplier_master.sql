-- SRM core: procurement category taxonomy and supplier master data.

-- Categories carry the sourcing policy. `path` is materialized so reads never
-- need a recursive query; `level` is derived from it and kept consistent by
-- the service, which rewrites the whole subtree on a move.
CREATE TABLE srm_categories (
    id                       TEXT        PRIMARY KEY,
    tenant_id                TEXT        NOT NULL,
    code                     TEXT        NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9-]{1,63}$'),
    name                     TEXT        NOT NULL,
    parent_id                TEXT        REFERENCES srm_categories (id) ON DELETE RESTRICT,
    path                     TEXT        NOT NULL,
    level                    SMALLINT    NOT NULL CHECK (level BETWEEN 0 AND 8),
    risk_tier                TEXT        NOT NULL DEFAULT 'medium'
        CHECK (risk_tier IN ('low', 'medium', 'high', 'critical')),
    requires_qualification   BOOLEAN     NOT NULL DEFAULT FALSE,
    -- Certification type codes; the effective set is the union up the tree.
    required_certifications  TEXT[]      NOT NULL DEFAULT '{}',
    requalification_months   SMALLINT    NOT NULL DEFAULT 24
        CHECK (requalification_months BETWEEN 3 AND 60),
    manager_user_id          TEXT,
    sort_order               INTEGER     NOT NULL DEFAULT 0,
    is_active                BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at               TIMESTAMPTZ NOT NULL,
    updated_at               TIMESTAMPTZ NOT NULL,
    UNIQUE (tenant_id, code),
    UNIQUE (tenant_id, path),
    CHECK (parent_id IS NOT NULL OR level = 0),
    CHECK (id <> parent_id)
);
CREATE INDEX srm_categories_tree_idx ON srm_categories (tenant_id, path);

CREATE TABLE srm_suppliers (
    id                   TEXT        PRIMARY KEY,
    tenant_id            TEXT        NOT NULL,
    code                 TEXT        NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9._-]{1,31}$'),
    legal_name           TEXT        NOT NULL,
    trade_name           TEXT,
    status               TEXT        NOT NULL DEFAULT 'prospect' CHECK (status IN (
        'prospect', 'onboarding', 'active', 'suspended', 'blocked', 'rejected', 'inactive')),
    classification       TEXT        NOT NULL DEFAULT 'unclassified' CHECK (classification IN (
        'strategic', 'preferred', 'approved', 'transactional', 'tail', 'unclassified')),
    country_code         CHAR(2)     NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
    tax_id               TEXT,
    duns_number          TEXT,
    registration_number  TEXT,
    website              TEXT,
    default_currency     CHAR(3)     NOT NULL DEFAULT 'USD' CHECK (default_currency ~ '^[A-Z]{3}$'),
    payment_terms_code   TEXT        NOT NULL DEFAULT 'NET30',
    default_incoterm     TEXT CHECK (default_incoterm IN (
        'EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP')),
    -- Corporate hierarchy: subsidiaries point at their group parent.
    parent_supplier_id   TEXT        REFERENCES srm_suppliers (id) ON DELETE SET NULL,
    tags                 TEXT[]      NOT NULL DEFAULT '{}',
    onboarding_case_id   TEXT,
    status_reason        TEXT,
    status_changed_at    TIMESTAMPTZ,
    activated_on         DATE,
    blocked_reason       TEXT,
    version              INTEGER     NOT NULL DEFAULT 1,
    created_at           TIMESTAMPTZ NOT NULL,
    updated_at           TIMESTAMPTZ NOT NULL,
    UNIQUE (tenant_id, code),
    CHECK (id <> parent_supplier_id),
    -- Activation stamps the date; blocking always records why.
    CHECK (status <> 'active' OR activated_on IS NOT NULL),
    CHECK (status <> 'blocked' OR blocked_reason IS NOT NULL)
);
CREATE INDEX srm_suppliers_status_idx ON srm_suppliers (tenant_id, status);
CREATE INDEX srm_suppliers_parent_idx ON srm_suppliers (tenant_id, parent_supplier_id);
CREATE INDEX srm_suppliers_name_idx ON srm_suppliers (tenant_id, lower(legal_name));

CREATE TABLE srm_supplier_sites (
    id                  TEXT        PRIMARY KEY,
    tenant_id           TEXT        NOT NULL,
    supplier_id         TEXT        NOT NULL REFERENCES srm_suppliers (id) ON DELETE CASCADE,
    code                TEXT        NOT NULL,
    name                TEXT        NOT NULL,
    type                TEXT        NOT NULL CHECK (type IN (
        'headquarters', 'manufacturing', 'warehouse', 'distribution', 'service', 'remit_to')),
    address_line1       TEXT        NOT NULL,
    address_line2       TEXT,
    city                TEXT        NOT NULL,
    region              TEXT,
    postal_code         TEXT,
    country_code        CHAR(2)     NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
    is_primary          BOOLEAN     NOT NULL DEFAULT FALSE,
    is_active           BOOLEAN     NOT NULL DEFAULT TRUE,
    capabilities        TEXT[]      NOT NULL DEFAULT '{}',
    lead_time_days      SMALLINT    CHECK (lead_time_days BETWEEN 0 AND 365),
    timezone            TEXT,
    deactivated_reason  TEXT,
    UNIQUE (supplier_id, code),
    CHECK (is_active OR deactivated_reason IS NOT NULL)
);
-- At most one primary site per supplier, and only an active one may hold it.
CREATE UNIQUE INDEX srm_supplier_sites_primary_idx
    ON srm_supplier_sites (supplier_id)
    WHERE is_primary;
CREATE INDEX srm_supplier_sites_country_idx ON srm_supplier_sites (tenant_id, country_code);

CREATE TABLE srm_supplier_contacts (
    id           TEXT    PRIMARY KEY,
    tenant_id    TEXT    NOT NULL,
    supplier_id  TEXT    NOT NULL REFERENCES srm_suppliers (id) ON DELETE CASCADE,
    name         TEXT    NOT NULL,
    email        TEXT    NOT NULL,
    phone        TEXT,
    role         TEXT    NOT NULL CHECK (role IN (
        'primary', 'sales', 'quality', 'logistics', 'finance', 'compliance', 'engineering', 'executive')),
    title        TEXT,
    site_id      TEXT    REFERENCES srm_supplier_sites (id) ON DELETE SET NULL,
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (supplier_id, email, role)
);
-- Exactly one active primary contact is the invariant the aggregate enforces.
CREATE UNIQUE INDEX srm_supplier_contacts_primary_idx
    ON srm_supplier_contacts (supplier_id)
    WHERE role = 'primary' AND is_active;

CREATE TABLE srm_supplier_categories (
    tenant_id          TEXT        NOT NULL,
    supplier_id        TEXT        NOT NULL REFERENCES srm_suppliers (id) ON DELETE CASCADE,
    category_id        TEXT        NOT NULL REFERENCES srm_categories (id) ON DELETE RESTRICT,
    category_code      TEXT        NOT NULL,
    status             TEXT        NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'restricted')),
    assigned_at        TIMESTAMPTZ NOT NULL,
    approved_at        TIMESTAMPTZ,
    approved_by        TEXT,
    restricted_reason  TEXT,
    note               TEXT,
    PRIMARY KEY (supplier_id, category_id),
    CHECK (status <> 'approved' OR approved_at IS NOT NULL),
    CHECK (status <> 'restricted' OR restricted_reason IS NOT NULL)
);
CREATE INDEX srm_supplier_categories_panel_idx
    ON srm_supplier_categories (tenant_id, category_id, status);

-- Only the last four digits of an account number are retained; the raw value
-- never enters this system.
CREATE TABLE srm_supplier_bank_accounts (
    id               TEXT        PRIMARY KEY,
    tenant_id        TEXT        NOT NULL,
    supplier_id      TEXT        NOT NULL REFERENCES srm_suppliers (id) ON DELETE CASCADE,
    label            TEXT        NOT NULL,
    bank_name        TEXT        NOT NULL,
    country_code     CHAR(2)     NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
    currency         CHAR(3)     NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    account_masked   TEXT        NOT NULL CHECK (account_masked ~ '^\*{4}[0-9A-Za-z]{4}$'),
    status           TEXT        NOT NULL DEFAULT 'unverified'
        CHECK (status IN ('unverified', 'verified', 'rejected', 'archived')),
    is_primary       BOOLEAN     NOT NULL DEFAULT FALSE,
    added_at         TIMESTAMPTZ NOT NULL,
    verified_at      TIMESTAMPTZ,
    verified_by      TEXT,
    rejected_reason  TEXT,
    CHECK (status <> 'verified' OR verified_at IS NOT NULL),
    CHECK (status <> 'rejected' OR rejected_reason IS NOT NULL),
    -- An unverified account can never be the one invoices are paid to.
    CHECK (NOT is_primary OR status = 'verified')
);
CREATE UNIQUE INDEX srm_supplier_bank_primary_idx
    ON srm_supplier_bank_accounts (supplier_id)
    WHERE is_primary;

-- Self-declared until the matching certificate is verified; spend reporting
-- only counts the verified rows.
CREATE TABLE srm_supplier_diversity (
    tenant_id         TEXT        NOT NULL,
    supplier_id       TEXT        NOT NULL REFERENCES srm_suppliers (id) ON DELETE CASCADE,
    flag              TEXT        NOT NULL CHECK (flag IN (
        'small_business', 'minority_owned', 'women_owned', 'veteran_owned',
        'disability_owned', 'lgbtq_owned', 'social_enterprise', 'local')),
    declared_at       TIMESTAMPTZ NOT NULL,
    verified          BOOLEAN     NOT NULL DEFAULT FALSE,
    certification_id  TEXT,
    verified_at       TIMESTAMPTZ,
    PRIMARY KEY (supplier_id, flag),
    CHECK (NOT verified OR verified_at IS NOT NULL)
);
