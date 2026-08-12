-- quality-qms 0002: inspection lots, characteristic snapshots, results

CREATE TABLE quality.inspection_lot (
    id                  TEXT        PRIMARY KEY,
    tenant_id           TEXT        NOT NULL,
    lot_number          TEXT        NOT NULL,
    plan_id             TEXT        NOT NULL REFERENCES quality.inspection_plan (id),
    plan_code           TEXT        NOT NULL,
    plan_revision       INTEGER     NOT NULL,
    origin              TEXT        NOT NULL CHECK (
        origin IN ('goods-receipt', 'in-process', 'final', 'customer-return', 'stock-audit')
    ),
    material_code       TEXT        NOT NULL,
    quantity            NUMERIC     NOT NULL CHECK (quantity > 0),
    uom                 TEXT        NOT NULL,
    status              TEXT        NOT NULL DEFAULT 'created' CHECK (
        status IN ('created', 'in-progress', 'completed', 'decided', 'cancelled')
    ),
    -- sampling outcome frozen at creation
    sample_size         INTEGER     NOT NULL CHECK (sample_size >= 1),
    acceptance_number   INTEGER     NOT NULL DEFAULT 0,
    rejection_number    INTEGER     NOT NULL DEFAULT 1,
    sampling_description TEXT       NOT NULL,
    -- linkage fields towards procurement / production / sales
    supplier_id         TEXT,
    purchase_order_ref  TEXT,
    work_order_ref      TEXT,
    customer_ref        TEXT,
    batch_number        TEXT,
    -- usage decision
    decision            TEXT CHECK (
        decision IS NULL OR decision IN ('accept', 'reject', 'accept-with-deviation', 'partial')
    ),
    accepted_quantity   NUMERIC,
    rejected_quantity   NUMERIC,
    decision_note       TEXT,
    decided_by          TEXT,
    decided_at          TIMESTAMPTZ,
    cancellation_reason TEXT,
    created_at          TIMESTAMPTZ NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL,
    version             INTEGER     NOT NULL DEFAULT 1,
    CONSTRAINT inspection_lot_number_uq UNIQUE (tenant_id, lot_number),
    CONSTRAINT goods_receipt_needs_supplier CHECK (
        origin <> 'goods-receipt' OR supplier_id IS NOT NULL
    ),
    CONSTRAINT decided_lot_has_quantities CHECK (
        decision IS NULL OR (accepted_quantity IS NOT NULL AND rejected_quantity IS NOT NULL)
    )
);

CREATE INDEX inspection_lot_status_ix   ON quality.inspection_lot (tenant_id, status);
CREATE INDEX inspection_lot_supplier_ix ON quality.inspection_lot (tenant_id, supplier_id)
    WHERE supplier_id IS NOT NULL;
CREATE INDEX inspection_lot_material_ix ON quality.inspection_lot (tenant_id, material_code);

-- Snapshot of the plan characteristic as it looked when the lot was created.
CREATE TABLE quality.inspection_lot_characteristic (
    id                   TEXT    PRIMARY KEY,
    tenant_id            TEXT    NOT NULL,
    lot_id               TEXT    NOT NULL REFERENCES quality.inspection_lot (id) ON DELETE CASCADE,
    code                 TEXT    NOT NULL,
    name                 TEXT    NOT NULL,
    char_type            TEXT    NOT NULL CHECK (char_type IN ('quantitative', 'attribute')),
    criticality          TEXT    NOT NULL CHECK (criticality IN ('critical', 'major', 'minor')),
    method               TEXT,
    unit                 TEXT,
    target_value         NUMERIC,
    lower_limit          NUMERIC,
    upper_limit          NUMERIC,
    decimals             INTEGER,
    sample_size_override INTEGER,
    CONSTRAINT lot_characteristic_code_uq UNIQUE (lot_id, code)
);

CREATE TABLE quality.inspection_result (
    id                 TEXT        PRIMARY KEY,
    tenant_id          TEXT        NOT NULL,
    lot_id             TEXT        NOT NULL REFERENCES quality.inspection_lot (id) ON DELETE CASCADE,
    characteristic_id  TEXT        NOT NULL REFERENCES quality.inspection_lot_characteristic (id),
    evaluation         TEXT        NOT NULL CHECK (evaluation IN ('pass', 'fail')),
    -- quantitative payload
    readings           JSONB,       -- array of numbers
    stat_mean          NUMERIC,
    stat_std_dev       NUMERIC,
    stat_min           NUMERIC,
    stat_max           NUMERIC,
    stat_cp            NUMERIC,
    stat_cpk           NUMERIC,
    out_of_spec_count  INTEGER,
    -- attribute payload
    inspected_count    INTEGER CHECK (inspected_count IS NULL OR inspected_count >= 1),
    defective_count    INTEGER CHECK (defective_count IS NULL OR defective_count >= 0),
    note               TEXT,
    recorded_by        TEXT        NOT NULL,
    recorded_at        TIMESTAMPTZ NOT NULL,
    CONSTRAINT one_result_per_characteristic UNIQUE (lot_id, characteristic_id),
    CONSTRAINT defective_within_inspected CHECK (
        defective_count IS NULL OR inspected_count IS NULL OR defective_count <= inspected_count
    )
);

CREATE INDEX inspection_result_lot_ix ON quality.inspection_result (lot_id);

COMMENT ON TABLE quality.inspection_lot_characteristic IS
    'Frozen copy of plan characteristics; plan revisions never affect in-flight lots';
