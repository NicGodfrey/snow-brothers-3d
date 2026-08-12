-- Posted (immutable) material movement documents between inventory and WIP.

CREATE TABLE mes_material_issue (
    id             TEXT PRIMARY KEY,
    tenant_id      TEXT NOT NULL,
    work_order_id  TEXT NOT NULL REFERENCES mes_work_order (id),
    direction      TEXT NOT NULL CHECK (direction IN ('ISSUE', 'RETURN')),
    warehouse_code TEXT NOT NULL,
    posted_by      TEXT NOT NULL,
    note           TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    version        INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX ix_mes_material_issue_wo ON mes_material_issue (tenant_id, work_order_id);

CREATE TABLE mes_material_issue_line (
    id                TEXT PRIMARY KEY,
    tenant_id         TEXT NOT NULL,
    material_issue_id TEXT NOT NULL REFERENCES mes_material_issue (id) ON DELETE CASCADE,
    line_no           INTEGER NOT NULL CHECK (line_no >= 1),
    component_sku     TEXT NOT NULL,
    qty               NUMERIC(14, 6) NOT NULL CHECK (qty > 0),
    uom               TEXT NOT NULL,
    lot_number        TEXT,
    bin_code          TEXT,
    unplanned         BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE UNIQUE INDEX ux_mes_material_issue_line_no
    ON mes_material_issue_line (tenant_id, material_issue_id, line_no);
CREATE INDEX ix_mes_material_issue_line_sku
    ON mes_material_issue_line (tenant_id, component_sku);

COMMENT ON TABLE mes_material_issue IS
    'Posted documents are never updated; corrections are posted as RETURN documents';
