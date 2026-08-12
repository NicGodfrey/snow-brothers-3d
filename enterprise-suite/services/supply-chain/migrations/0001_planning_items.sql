-- Planning item master: per-SKU MRP parameters and single-level BOM.
-- Multi-tenant: every table is partitioned logically by tenant_id.

CREATE TABLE planning_item (
    id                       TEXT PRIMARY KEY,
    tenant_id                TEXT        NOT NULL,
    sku                      TEXT        NOT NULL,
    description              TEXT        NOT NULL,
    uom                      TEXT        NOT NULL DEFAULT 'EA'
        CHECK (uom IN ('EA', 'KG', 'L', 'M', 'BOX')),
    procurement_type         TEXT        NOT NULL
        CHECK (procurement_type IN ('MAKE', 'BUY')),
    lead_time_days           INTEGER     NOT NULL CHECK (lead_time_days BETWEEN 0 AND 365),
    -- Discriminated union serialized as JSONB:
    -- {"type":"LOT_FOR_LOT"} | {"type":"FIXED_ORDER_QTY","fixedQty":n}
    -- | {"type":"MIN_MAX","minQty":n,"multiple":n,"maxQty":n}
    -- | {"type":"PERIOD_ORDER_QTY","periods":n}
    lot_sizing               JSONB       NOT NULL DEFAULT '{"type":"LOT_FOR_LOT"}',
    safety_stock_policy_id   TEXT,
    preferred_supplier_id    TEXT,
    standard_cost_minor      BIGINT,
    currency                 CHAR(3),
    active                   BOOLEAN     NOT NULL DEFAULT TRUE,
    version                  INTEGER     NOT NULL DEFAULT 1,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT planning_item_cost_currency
        CHECK ((standard_cost_minor IS NULL) = (currency IS NULL))
);

CREATE UNIQUE INDEX ux_planning_item_tenant_sku ON planning_item (tenant_id, sku);
CREATE INDEX ix_planning_item_supplier ON planning_item (tenant_id, preferred_supplier_id)
    WHERE preferred_supplier_id IS NOT NULL;

CREATE TABLE planning_item_bom_line (
    item_id        TEXT           NOT NULL REFERENCES planning_item (id) ON DELETE CASCADE,
    tenant_id      TEXT           NOT NULL,
    component_sku  TEXT           NOT NULL,
    qty_per        NUMERIC(14, 3) NOT NULL CHECK (qty_per > 0),
    scrap_pct      NUMERIC(5, 4)  NOT NULL DEFAULT 0 CHECK (scrap_pct BETWEEN 0 AND 0.5),
    PRIMARY KEY (item_id, component_sku)
);

CREATE INDEX ix_bom_line_component ON planning_item_bom_line (tenant_id, component_sku);
