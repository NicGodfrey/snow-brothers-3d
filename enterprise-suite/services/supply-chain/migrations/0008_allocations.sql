-- Hard reservations of supply against committed demand (ATP's demand side).

CREATE TABLE allocation (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT           NOT NULL,
    sku             TEXT           NOT NULL,
    location        TEXT           NOT NULL,
    qty             NUMERIC(14, 3) NOT NULL CHECK (qty > 0),
    need_date       DATE           NOT NULL,
    demand_ref_type TEXT           NOT NULL DEFAULT 'SALES_ORDER'
        CHECK (demand_ref_type IN ('SALES_ORDER', 'TRANSFER_ORDER', 'MANUAL')),
    demand_ref      TEXT           NOT NULL,
    status          TEXT           NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'CANCELLED', 'FULFILLED')),
    version         INTEGER        NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX ix_allocation_item ON allocation (tenant_id, sku, location, status, need_date);
CREATE INDEX ix_allocation_demand_ref ON allocation (tenant_id, demand_ref_type, demand_ref);
