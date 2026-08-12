-- Projections of external state consumed by planning:
--   inventory_record   on-hand stock owned by the Inventory context
--   scheduled_receipt  open POs / work orders / inbound transfers

CREATE TABLE inventory_record (
    tenant_id   TEXT           NOT NULL,
    sku         TEXT           NOT NULL,
    location    TEXT           NOT NULL,
    on_hand_qty NUMERIC(14, 3) NOT NULL CHECK (on_hand_qty >= 0),
    as_of       TIMESTAMPTZ    NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, sku, location)
);

CREATE TABLE scheduled_receipt (
    id          TEXT PRIMARY KEY,
    tenant_id   TEXT           NOT NULL,
    sku         TEXT           NOT NULL,
    location    TEXT           NOT NULL,
    due_date    DATE           NOT NULL,
    qty         NUMERIC(14, 3) NOT NULL CHECK (qty > 0),
    source_type TEXT           NOT NULL
        CHECK (source_type IN ('PURCHASE_ORDER', 'WORK_ORDER', 'TRANSFER_ORDER')),
    source_ref  TEXT           NOT NULL,
    created_at  TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX ix_receipt_item ON scheduled_receipt (tenant_id, sku, location, due_date);
CREATE INDEX ix_receipt_source ON scheduled_receipt (tenant_id, source_type, source_ref);
