-- Product PLM: units of measure, categories, attributes, products, variants.
-- Postgres dialect. Every table is tenant-scoped; uniqueness is always
-- (tenant_id, natural key) so tenants never collide.

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE plm_uoms (
    tenant_id      TEXT        NOT NULL,
    code           TEXT        NOT NULL,
    name           TEXT        NOT NULL,
    dimension      TEXT        NOT NULL
        CHECK (dimension IN ('count', 'mass', 'length', 'area', 'volume', 'time')),
    to_base        NUMERIC(20, 10) NOT NULL CHECK (to_base > 0),
    precision      SMALLINT    NOT NULL DEFAULT 6 CHECK (precision BETWEEN 0 AND 10),
    is_standard    BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, code)
);

CREATE TABLE plm_categories (
    id             TEXT        PRIMARY KEY,
    tenant_id      TEXT        NOT NULL,
    code           TEXT        NOT NULL,
    name           TEXT        NOT NULL,
    parent_id      TEXT        REFERENCES plm_categories (id) ON DELETE RESTRICT,
    path           TEXT        NOT NULL,
    sort_order     INTEGER     NOT NULL DEFAULT 0,
    is_active      BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL,
    updated_at     TIMESTAMPTZ NOT NULL,
    UNIQUE (tenant_id, code)
);
CREATE INDEX plm_categories_tenant_parent_idx ON plm_categories (tenant_id, parent_id);
CREATE INDEX plm_categories_tenant_path_idx ON plm_categories (tenant_id, path text_pattern_ops);

CREATE TABLE plm_attribute_definitions (
    id             TEXT        PRIMARY KEY,
    tenant_id      TEXT        NOT NULL,
    code           TEXT        NOT NULL CHECK (code ~ '^[a-z][a-z0-9_]{0,47}$'),
    name           TEXT        NOT NULL,
    type           TEXT        NOT NULL
        CHECK (type IN ('text', 'number', 'boolean', 'select', 'multiselect', 'date')),
    -- [{"code": "...", "label": "..."}]; required for select/multiselect.
    options        JSONB,
    min_value      NUMERIC,
    max_value      NUMERIC,
    pattern        TEXT,
    uom_code       TEXT,
    description    TEXT,
    created_at     TIMESTAMPTZ NOT NULL,
    updated_at     TIMESTAMPTZ NOT NULL,
    UNIQUE (tenant_id, code),
    CHECK (type NOT IN ('select', 'multiselect') OR jsonb_array_length(options) > 0),
    CHECK (min_value IS NULL OR max_value IS NULL OR min_value <= max_value)
);

CREATE TABLE plm_attribute_sets (
    id             TEXT        PRIMARY KEY,
    tenant_id      TEXT        NOT NULL,
    name           TEXT        NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL,
    updated_at     TIMESTAMPTZ NOT NULL,
    UNIQUE (tenant_id, name)
);

CREATE TABLE plm_attribute_set_members (
    attribute_set_id  TEXT     NOT NULL REFERENCES plm_attribute_sets (id) ON DELETE CASCADE,
    tenant_id         TEXT     NOT NULL,
    attribute_code    TEXT     NOT NULL,
    required          BOOLEAN  NOT NULL DEFAULT FALSE,
    is_variant_axis   BOOLEAN  NOT NULL DEFAULT FALSE,
    position          INTEGER  NOT NULL DEFAULT 0,
    PRIMARY KEY (attribute_set_id, attribute_code),
    FOREIGN KEY (tenant_id, attribute_code)
        REFERENCES plm_attribute_definitions (tenant_id, code) ON DELETE RESTRICT,
    -- Axes must be required; select-only is enforced at the application layer
    -- because it needs the definition row.
    CHECK (NOT is_variant_axis OR required)
);

CREATE TABLE plm_products (
    id                TEXT        PRIMARY KEY,
    tenant_id         TEXT        NOT NULL,
    code              TEXT        NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9-]{1,63}$'),
    name              TEXT        NOT NULL,
    description       TEXT,
    type              TEXT        NOT NULL
        CHECK (type IN ('manufactured', 'purchased', 'phantom', 'service')),
    lifecycle         TEXT        NOT NULL DEFAULT 'design'
        CHECK (lifecycle IN ('design', 'pilot', 'active', 'end_of_life')),
    base_uom          TEXT        NOT NULL,
    sku               TEXT,
    category_id       TEXT        REFERENCES plm_categories (id) ON DELETE SET NULL,
    attribute_set_id  TEXT        REFERENCES plm_attribute_sets (id) ON DELETE RESTRICT,
    -- Validated attribute values, keyed by attribute code.
    attributes        JSONB       NOT NULL DEFAULT '{}',
    -- Standard cost in integer minor units plus ISO currency.
    std_cost_minor    BIGINT,
    std_cost_currency CHAR(3),
    std_cost_source   TEXT CHECK (std_cost_source IN ('manual', 'rollup')),
    eol_at            TIMESTAMPTZ,
    eol_reason        TEXT,
    version           INTEGER     NOT NULL DEFAULT 1,
    created_at        TIMESTAMPTZ NOT NULL,
    updated_at        TIMESTAMPTZ NOT NULL,
    UNIQUE (tenant_id, code),
    FOREIGN KEY (tenant_id, base_uom) REFERENCES plm_uoms (tenant_id, code),
    CHECK ((std_cost_minor IS NULL) = (std_cost_currency IS NULL)),
    CHECK (lifecycle <> 'end_of_life' OR eol_reason IS NOT NULL)
);
CREATE UNIQUE INDEX plm_products_tenant_sku_uq ON plm_products (tenant_id, sku) WHERE sku IS NOT NULL;
CREATE INDEX plm_products_tenant_lifecycle_idx ON plm_products (tenant_id, lifecycle);
CREATE INDEX plm_products_tenant_category_idx ON plm_products (tenant_id, category_id);

CREATE TABLE plm_product_variants (
    id                TEXT        PRIMARY KEY,
    tenant_id         TEXT        NOT NULL,
    product_id        TEXT        NOT NULL REFERENCES plm_products (id) ON DELETE CASCADE,
    sku               TEXT        NOT NULL,
    -- {"color": "red", "deck_width": "8_25"} — the axis combination.
    axis_values       JSONB       NOT NULL,
    -- Canonical sorted "color=red|deck_width=8_25" key for uniqueness.
    axis_key          TEXT        NOT NULL,
    attributes        JSONB       NOT NULL DEFAULT '{}',
    status            TEXT        NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'discontinued')),
    std_cost_minor    BIGINT,
    std_cost_currency CHAR(3),
    created_at        TIMESTAMPTZ NOT NULL,
    UNIQUE (tenant_id, sku),
    UNIQUE (product_id, axis_key),
    CHECK ((std_cost_minor IS NULL) = (std_cost_currency IS NULL))
);
CREATE INDEX plm_product_variants_product_idx ON plm_product_variants (product_id, status);
