-- Finished-goods receipts from work orders into inventory.

CREATE TABLE mes_production_receipt (
    id             TEXT PRIMARY KEY,
    tenant_id      TEXT NOT NULL,
    work_order_id  TEXT NOT NULL REFERENCES mes_work_order (id),
    sku            TEXT NOT NULL,
    qty_good       NUMERIC(14, 6) NOT NULL CHECK (qty_good > 0),
    uom            TEXT NOT NULL,
    warehouse_code TEXT NOT NULL,
    lot_number     TEXT,
    posted_by      TEXT NOT NULL,
    note           TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    version        INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX ix_mes_production_receipt_wo
    ON mes_production_receipt (tenant_id, work_order_id);
CREATE INDEX ix_mes_production_receipt_sku
    ON mes_production_receipt (tenant_id, sku);

COMMENT ON TABLE mes_production_receipt IS
    'Cumulative receipts per work order must not exceed quantity_completed (domain-enforced)';
