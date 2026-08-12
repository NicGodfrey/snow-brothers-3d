-- Lightweight supplier capacity commitments per week. A NULL sku means the
-- calendar applies supplier-wide; an item-specific calendar takes precedence.

CREATE TABLE supplier_capacity_calendar (
    id                      TEXT PRIMARY KEY,
    tenant_id               TEXT           NOT NULL,
    supplier_id             TEXT           NOT NULL,
    sku                     TEXT,
    name                    TEXT           NOT NULL,
    default_weekly_capacity NUMERIC(14, 3) NOT NULL DEFAULT 0 CHECK (default_weekly_capacity >= 0),
    version                 INTEGER        NOT NULL DEFAULT 1,
    created_at              TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ux_capacity_calendar_scope
    ON supplier_capacity_calendar (tenant_id, supplier_id, COALESCE(sku, '*'));

CREATE TABLE supplier_capacity_week (
    calendar_id  TEXT           NOT NULL REFERENCES supplier_capacity_calendar (id) ON DELETE CASCADE,
    week_start   DATE           NOT NULL, -- always a Monday
    capacity_qty NUMERIC(14, 3) NOT NULL CHECK (capacity_qty >= 0),
    PRIMARY KEY (calendar_id, week_start)
);
