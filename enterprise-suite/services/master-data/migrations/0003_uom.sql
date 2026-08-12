-- Units of measure and item conversions.
--
-- Standard units ship with the product and are seeded per tenant on
-- provisioning; tenant units (a "ROLL" of 25 m, a "CASE" of 24) are created at
-- runtime. Conversions within a dimension are derived from to_base and never
-- stored; only cross-dimension item conversions need rows.

CREATE TABLE mdm_uoms (
    tenant_id    TEXT        NOT NULL,
    code         TEXT        NOT NULL CHECK (code ~ '^[A-Z0-9_]{1,16}$'),
    name         TEXT        NOT NULL CHECK (length(btrim(name)) > 0),
    symbol       TEXT        NOT NULL,
    dimension    TEXT        NOT NULL
        CHECK (dimension IN ('count', 'mass', 'length', 'area', 'volume', 'time',
                             'temperature', 'energy')),
    to_base      NUMERIC(24, 12) NOT NULL CHECK (to_base > 0),
    -- Non-zero only for affine scales (°C, °F), which cannot take part in
    -- ratio arithmetic.
    offset_value NUMERIC(24, 12) NOT NULL DEFAULT 0,
    precision    SMALLINT    NOT NULL DEFAULT 6 CHECK (precision BETWEEN 0 AND 10),
    is_standard  BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, code),
    CHECK (offset_value = 0 OR dimension = 'temperature')
);
CREATE INDEX mdm_uoms_tenant_dimension_idx ON mdm_uoms (tenant_id, dimension);

-- Directed conversions dimensional maths cannot derive: how many `to` units
-- one `from` unit represents. product_code '*' applies to the whole catalog;
-- a product-specific row shadows it for that product.
CREATE TABLE mdm_uom_conversions (
    tenant_id    TEXT        NOT NULL,
    product_code TEXT        NOT NULL DEFAULT '*',
    from_code    TEXT        NOT NULL,
    to_code      TEXT        NOT NULL,
    factor       NUMERIC(24, 12) NOT NULL CHECK (factor > 0),
    note         TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, product_code, from_code, to_code),
    CHECK (from_code <> to_code),
    FOREIGN KEY (tenant_id, from_code) REFERENCES mdm_uoms (tenant_id, code) ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, to_code) REFERENCES mdm_uoms (tenant_id, code) ON DELETE RESTRICT
);
CREATE INDEX mdm_uom_conversions_product_idx ON mdm_uom_conversions (tenant_id, product_code);
