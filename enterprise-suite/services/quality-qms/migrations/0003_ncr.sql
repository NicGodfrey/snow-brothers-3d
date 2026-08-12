-- quality-qms 0003: non-conformance reports, containment actions

CREATE TABLE quality.ncr (
    id                  TEXT        PRIMARY KEY,
    tenant_id           TEXT        NOT NULL,
    ncr_number          TEXT        NOT NULL,
    title               TEXT        NOT NULL,
    description         TEXT        NOT NULL,
    source              TEXT        NOT NULL CHECK (
        source IN ('inspection', 'production', 'customer-complaint', 'supplier', 'audit', 'internal')
    ),
    severity            TEXT        NOT NULL CHECK (severity IN ('critical', 'major', 'minor')),
    status              TEXT        NOT NULL DEFAULT 'draft' CHECK (
        status IN ('draft', 'open', 'containment', 'disposition', 'closed', 'cancelled')
    ),
    defect_code         TEXT,
    quantity_affected   NUMERIC CHECK (quantity_affected IS NULL OR quantity_affected > 0),
    uom                 TEXT,
    material_code       TEXT,
    -- linkage fields (nullable FKs where the target lives in this service)
    inspection_lot_id   TEXT REFERENCES quality.inspection_lot (id),
    supplier_id         TEXT,
    purchase_order_ref  TEXT,
    work_order_ref      TEXT,
    customer_ref        TEXT,
    audit_id            TEXT,        -- FK added in 0006 after quality.audit exists
    capa_id             TEXT,        -- FK added in 0004 after quality.capa exists
    -- disposition
    disposition_type          TEXT CHECK (
        disposition_type IS NULL OR disposition_type IN
        ('use-as-is', 'rework', 'repair', 'scrap', 'return-to-supplier', 'regrade')
    ),
    disposition_justification TEXT,
    disposition_requires_approval BOOLEAN,
    disposition_decided_by    TEXT,
    disposition_decided_at    TIMESTAMPTZ,
    disposition_approved_by   TEXT,
    disposition_approved_at   TIMESTAMPTZ,
    -- closure / cancellation
    closed_by           TEXT,
    closed_at           TIMESTAMPTZ,
    closure_note        TEXT,
    cancelled_by        TEXT,
    cancelled_at        TIMESTAMPTZ,
    cancellation_reason TEXT,
    created_at          TIMESTAMPTZ NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL,
    version             INTEGER     NOT NULL DEFAULT 1,
    CONSTRAINT ncr_number_uq UNIQUE (tenant_id, ncr_number),
    CONSTRAINT supplier_source_needs_supplier CHECK (
        source <> 'supplier' OR supplier_id IS NOT NULL
    ),
    CONSTRAINT approval_after_decision CHECK (
        disposition_approved_by IS NULL OR disposition_decided_by IS NOT NULL
    ),
    -- four-eyes rule: approver must differ from decider
    CONSTRAINT approver_differs_from_decider CHECK (
        disposition_approved_by IS NULL OR disposition_approved_by <> disposition_decided_by
    )
);

CREATE INDEX ncr_status_ix    ON quality.ncr (tenant_id, status);
CREATE INDEX ncr_supplier_ix  ON quality.ncr (tenant_id, supplier_id) WHERE supplier_id IS NOT NULL;
CREATE INDEX ncr_lot_ix       ON quality.ncr (tenant_id, inspection_lot_id) WHERE inspection_lot_id IS NOT NULL;

CREATE TABLE quality.ncr_containment_action (
    id              TEXT        PRIMARY KEY,
    tenant_id       TEXT        NOT NULL,
    ncr_id          TEXT        NOT NULL REFERENCES quality.ncr (id) ON DELETE CASCADE,
    description     TEXT        NOT NULL,
    owner_user_id   TEXT        NOT NULL,
    due_at          TIMESTAMPTZ NOT NULL,
    status          TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
    completed_at    TIMESTAMPTZ,
    completion_note TEXT,
    CONSTRAINT done_actions_have_completed_at CHECK (
        status <> 'done' OR completed_at IS NOT NULL
    )
);

CREATE INDEX ncr_containment_action_ncr_ix ON quality.ncr_containment_action (ncr_id);
