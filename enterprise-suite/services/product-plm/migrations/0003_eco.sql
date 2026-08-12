-- Product PLM: engineering change orders.

CREATE TABLE plm_ecos (
    id                  TEXT        PRIMARY KEY,
    tenant_id           TEXT        NOT NULL,
    number              TEXT        NOT NULL CHECK (number ~ '^ECO-[0-9]{5,}$'),
    title               TEXT        NOT NULL,
    description         TEXT,
    reason              TEXT        NOT NULL CHECK (reason IN (
        'design_fix', 'cost_reduction', 'quality', 'compliance', 'obsolescence', 'customer_request')),
    priority            TEXT        NOT NULL DEFAULT 'medium'
        CHECK (priority IN ('low', 'medium', 'high', 'critical')),
    status              TEXT        NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'implemented', 'cancelled')),
    required_approvals  SMALLINT    NOT NULL DEFAULT 1 CHECK (required_approvals BETWEEN 1 AND 10),
    submitted_at        TIMESTAMPTZ,
    submitted_by        TEXT,
    implemented_at      TIMESTAMPTZ,
    implemented_by      TEXT,
    cancelled_reason    TEXT,
    version             INTEGER     NOT NULL DEFAULT 1,
    created_at          TIMESTAMPTZ NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL,
    UNIQUE (tenant_id, number),
    CHECK (status NOT IN ('submitted', 'approved', 'implemented') OR submitted_at IS NOT NULL),
    CHECK (status <> 'implemented' OR implemented_at IS NOT NULL),
    CHECK (status <> 'cancelled' OR cancelled_reason IS NOT NULL)
);
CREATE INDEX plm_ecos_tenant_status_idx ON plm_ecos (tenant_id, status);

-- Per-tenant sequence for minting ECO numbers.
CREATE TABLE plm_eco_sequences (
    tenant_id  TEXT   PRIMARY KEY,
    next_value BIGINT NOT NULL DEFAULT 1
);

CREATE TABLE plm_eco_items (
    id           TEXT    PRIMARY KEY,
    tenant_id    TEXT    NOT NULL,
    eco_id       TEXT    NOT NULL REFERENCES plm_ecos (id) ON DELETE CASCADE,
    product_id   TEXT    NOT NULL REFERENCES plm_products (id) ON DELETE RESTRICT,
    change_kind  TEXT    NOT NULL CHECK (change_kind IN (
        'bom_release', 'lifecycle_transition', 'attribute_update', 'variant_discontinue')),
    -- Kind-specific payload, mirroring the EcoChange union:
    --   bom_release:          {"bomRevisionId", "effectiveFrom", "effectiveTo"?}
    --   lifecycle_transition: {"to", "reason"?}
    --   attribute_update:     {"values": {...}}
    --   variant_discontinue:  {"variantId"}
    change_payload JSONB NOT NULL,
    description  TEXT,
    position     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX plm_eco_items_eco_idx ON plm_eco_items (eco_id, position);
CREATE INDEX plm_eco_items_product_idx ON plm_eco_items (tenant_id, product_id);

CREATE TABLE plm_eco_approvals (
    eco_id       TEXT        NOT NULL REFERENCES plm_ecos (id) ON DELETE CASCADE,
    tenant_id    TEXT        NOT NULL,
    approver_id  TEXT        NOT NULL,
    decision     TEXT        NOT NULL CHECK (decision IN ('approved', 'rejected')),
    comment      TEXT,
    decided_at   TIMESTAMPTZ NOT NULL,
    -- One vote per approver per ECO.
    PRIMARY KEY (eco_id, approver_id),
    CHECK (decision <> 'rejected' OR comment IS NOT NULL)
);

-- Now that plm_ecos exists, wire the release authorization reference.
ALTER TABLE plm_bom_revisions
    ADD CONSTRAINT plm_bom_revisions_eco_fk
    FOREIGN KEY (eco_id) REFERENCES plm_ecos (id) ON DELETE RESTRICT;
