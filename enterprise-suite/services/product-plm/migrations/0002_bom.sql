-- Product PLM: bills of material with revisioning and date effectivity.

CREATE TABLE plm_boms (
    id          TEXT        PRIMARY KEY,
    tenant_id   TEXT        NOT NULL,
    product_id  TEXT        NOT NULL REFERENCES plm_products (id) ON DELETE CASCADE,
    version     INTEGER     NOT NULL DEFAULT 1,
    created_at  TIMESTAMPTZ NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL,
    -- One BOM per product.
    UNIQUE (tenant_id, product_id)
);

CREATE TABLE plm_bom_revisions (
    id              TEXT        PRIMARY KEY,
    tenant_id       TEXT        NOT NULL,
    bom_id          TEXT        NOT NULL REFERENCES plm_boms (id) ON DELETE CASCADE,
    code            TEXT        NOT NULL CHECK (code ~ '^[A-Z]+$'),
    status          TEXT        NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'released', 'obsolete')),
    effective_from  TIMESTAMPTZ,
    effective_to    TIMESTAMPTZ,
    notes           TEXT,
    eco_id          TEXT,       -- FK added in 0003 after plm_ecos exists
    released_at     TIMESTAMPTZ,
    released_by     TEXT,
    UNIQUE (bom_id, code),
    -- Released/obsolete revisions must carry a window start; drafts must not.
    CHECK ((status = 'draft') = (effective_from IS NULL)),
    CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to > effective_from),
    CHECK (status <> 'released' OR released_at IS NOT NULL)
);

-- At most one draft per BOM.
CREATE UNIQUE INDEX plm_bom_revisions_single_draft_uq
    ON plm_bom_revisions (bom_id)
    WHERE status = 'draft';

-- Released windows never overlap per BOM (the reason for btree_gist).
ALTER TABLE plm_bom_revisions ADD CONSTRAINT plm_bom_revisions_no_overlap
    EXCLUDE USING gist (
        bom_id WITH =,
        tstzrange(effective_from, COALESCE(effective_to, 'infinity'::timestamptz)) WITH &&
    )
    WHERE (status = 'released');

CREATE TABLE plm_bom_lines (
    id                    TEXT    PRIMARY KEY,
    tenant_id             TEXT    NOT NULL,
    revision_id           TEXT    NOT NULL REFERENCES plm_bom_revisions (id) ON DELETE CASCADE,
    component_product_id  TEXT    NOT NULL REFERENCES plm_products (id) ON DELETE RESTRICT,
    component_variant_id  TEXT    REFERENCES plm_product_variants (id) ON DELETE RESTRICT,
    quantity              NUMERIC(20, 6) NOT NULL CHECK (quantity > 0),
    uom                   TEXT    NOT NULL,
    scrap_factor          NUMERIC(5, 4) NOT NULL DEFAULT 0 CHECK (scrap_factor >= 0 AND scrap_factor < 0.9),
    reference_designators TEXT[]  NOT NULL DEFAULT '{}',
    position              INTEGER NOT NULL,
    notes                 TEXT,
    FOREIGN KEY (tenant_id, uom) REFERENCES plm_uoms (tenant_id, code)
);

-- A component (or a pinned variant of it) appears at most once per revision.
CREATE UNIQUE INDEX plm_bom_lines_component_uq
    ON plm_bom_lines (revision_id, component_product_id, COALESCE(component_variant_id, ''));
CREATE INDEX plm_bom_lines_component_idx ON plm_bom_lines (tenant_id, component_product_id);
