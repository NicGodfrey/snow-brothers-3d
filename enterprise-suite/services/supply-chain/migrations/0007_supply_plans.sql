-- Supply plans: one per (run, sku, location), with the full MRP grid,
-- generated planned orders and exception messages.

CREATE TABLE supply_plan (
    id            TEXT PRIMARY KEY,
    tenant_id     TEXT           NOT NULL,
    run_id        TEXT           NOT NULL REFERENCES planning_run (id) ON DELETE CASCADE,
    sku           TEXT           NOT NULL,
    location      TEXT           NOT NULL,
    horizon_start DATE           NOT NULL,
    week_count    INTEGER        NOT NULL CHECK (week_count BETWEEN 1 AND 104),
    safety_stock  NUMERIC(14, 3) NOT NULL DEFAULT 0,
    -- {"totalGrossRequirement":n,"totalPlannedQty":n,"orderCount":n,
    --  "exceptionCount":n,"endingOnHand":n}
    stats         JSONB          NOT NULL,
    version       INTEGER        NOT NULL DEFAULT 1,
    created_at    TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ux_supply_plan_run_item ON supply_plan (run_id, sku, location);
-- "Latest plan for an item" queries order by created_at, then id.
CREATE INDEX ix_supply_plan_item ON supply_plan (tenant_id, sku, location, created_at DESC, id DESC);

CREATE TABLE supply_plan_row (
    plan_id           TEXT           NOT NULL REFERENCES supply_plan (id) ON DELETE CASCADE,
    week_start        DATE           NOT NULL,
    gross_requirement NUMERIC(14, 3) NOT NULL DEFAULT 0,
    scheduled_receipt NUMERIC(14, 3) NOT NULL DEFAULT 0,
    planned_receipt   NUMERIC(14, 3) NOT NULL DEFAULT 0,
    projected_on_hand NUMERIC(14, 3) NOT NULL DEFAULT 0,
    net_requirement   NUMERIC(14, 3) NOT NULL DEFAULT 0,
    PRIMARY KEY (plan_id, week_start)
);

CREATE TABLE planned_order (
    order_id       TEXT PRIMARY KEY,
    plan_id        TEXT           NOT NULL REFERENCES supply_plan (id) ON DELETE CASCADE,
    tenant_id      TEXT           NOT NULL,
    order_type     TEXT           NOT NULL CHECK (order_type IN ('PURCHASE', 'PRODUCTION')),
    sku            TEXT           NOT NULL,
    qty            NUMERIC(14, 3) NOT NULL CHECK (qty > 0),
    due_date       DATE           NOT NULL,
    release_date   DATE           NOT NULL,
    status         TEXT           NOT NULL DEFAULT 'PLANNED'
        CHECK (status IN ('PLANNED', 'FIRMED', 'RELEASED', 'CANCELLED')),
    supplier_id    TEXT,
    est_cost_minor BIGINT,
    currency       CHAR(3),
    past_due       BOOLEAN        NOT NULL DEFAULT FALSE,
    CONSTRAINT planned_order_cost_currency
        CHECK ((est_cost_minor IS NULL) = (currency IS NULL)),
    CONSTRAINT planned_order_dates CHECK (release_date <= due_date)
);

CREATE INDEX ix_planned_order_plan ON planned_order (plan_id, status);
CREATE INDEX ix_planned_order_supplier ON planned_order (tenant_id, supplier_id, due_date)
    WHERE supplier_id IS NOT NULL AND status <> 'CANCELLED';

CREATE TABLE mrp_exception (
    plan_id    TEXT    NOT NULL REFERENCES supply_plan (id) ON DELETE CASCADE,
    seq        INTEGER NOT NULL,
    code       TEXT    NOT NULL CHECK (code IN (
        'RELEASE_PAST_DUE', 'BELOW_SAFETY_STOCK', 'SHORTAGE', 'EXPEDITE_RECEIPT',
        'EXCESS_RECEIPT', 'LOT_MAX_EXCEEDED', 'SUPPLIER_CAPACITY_OVERLOAD')),
    severity   TEXT    NOT NULL CHECK (severity IN ('WARNING', 'ERROR')),
    week_start DATE,
    message    TEXT    NOT NULL,
    PRIMARY KEY (plan_id, seq)
);
